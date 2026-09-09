/**
 * Guided source-project -> target-project Supabase migration helper.
 *
 * This follows Supabase's logical backup/restore procedure for the database,
 * then copies the Storage object bytes separately. Run one phase at a time:
 *
 *   npm run supabase:migrate -- preflight
 *   npm run supabase:migrate -- export --dir=backups/supabase-migration-2026-09-08
 *   npm run supabase:migrate -- restore --dir=backups/supabase-migration-2026-09-08 --confirm-target=TARGET_REF
 *   npm run supabase:migrate -- storage --confirm-target=TARGET_REF
 *   npm run supabase:migrate -- verify
 *
 * Credentials are loaded only from .env.migration (or the real environment),
 * never from the application's .env. See docs/supabase-instance-migration.md.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { loadEnv } from "./scraper/env";

const ARTIFACT_NAMES = [
  "roles.sql",
  "schema.sql",
  "data.sql",
  "history_schema.sql",
  "history_data.sql",
] as const;

type Action = "preflight" | "export" | "restore" | "storage" | "verify" | "help";

interface Options {
  action: Action;
  dir: string | null;
  confirmTarget: string | null;
  allowNonemptyTarget: boolean;
  allowArtifactEdits: boolean;
  historyOnly: boolean;
  buckets: string[];
  concurrency: number;
  skipUrlRewrite: boolean;
}

interface ArtifactManifest {
  generatedAt: string;
  sourceProjectRef: string | null;
  sourceDatabase: string;
  artifacts: Record<string, { bytes: number; sha256: string }>;
}

interface StorageFile {
  path: string;
  metadata: Record<string, unknown> | null;
}

interface StorageBucketShape {
  id: string;
  name: string;
  public: boolean;
  file_size_limit?: number | null;
  allowed_mime_types?: string[] | null;
}

function usage(): string {
  return `
Shuttlecraft Supabase project migration

Usage:
  npm run supabase:migrate -- preflight
  npm run supabase:migrate -- export [--dir=<backup-directory>]
  npm run supabase:migrate -- restore --dir=<backup-directory> --confirm-target=<project-ref>
  npm run supabase:migrate -- storage --confirm-target=<project-ref> [--bucket=a,b] [--concurrency=4]
  npm run supabase:migrate -- verify [--bucket=a,b]

Safety options:
  --allow-nonempty-target   Permit restore into a target that already has user data.
                            Use only to resume after inspecting a failed attempt.
  --allow-artifact-edits    Accept reviewed edits to exported SQL after a restore error.
  --history-only            Restore only Supabase CLI migration history after the main
                            database restore has already succeeded.
  --skip-url-rewrite       Do not rewrite persisted Shuttlecraft Storage URLs.

Configuration:
  Copy .env.migration.example to .env.migration and fill in all six values.
  The detailed runbook is docs/supabase-instance-migration.md.
`;
}

export function parseOptions(argv: string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const separator = arg.indexOf("=");
    if (separator === -1) flags.set(arg.slice(2), true);
    else flags.set(arg.slice(2, separator), arg.slice(separator + 1));
  }

  const rawAction = positional[0] ?? "help";
  const allowed = new Set<Action>([
    "preflight",
    "export",
    "restore",
    "storage",
    "verify",
    "help",
  ]);
  if (!allowed.has(rawAction as Action)) {
    throw new Error(`Unknown phase '${rawAction}'.\n${usage()}`);
  }

  const concurrencyValue = flags.get("concurrency");
  const concurrency = concurrencyValue === undefined || concurrencyValue === true
    ? Number(process.env.MIGRATION_STORAGE_CONCURRENCY ?? 4)
    : Number(concurrencyValue);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    throw new Error("--concurrency must be an integer from 1 to 20.");
  }

  const bucketValue = flags.get("bucket");
  const buckets = typeof bucketValue === "string"
    ? bucketValue.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  return {
    action: rawAction as Action,
    dir: typeof flags.get("dir") === "string" ? String(flags.get("dir")) : null,
    confirmTarget:
      typeof flags.get("confirm-target") === "string"
        ? String(flags.get("confirm-target"))
        : null,
    allowNonemptyTarget: flags.has("allow-nonempty-target"),
    allowArtifactEdits: flags.has("allow-artifact-edits"),
    historyOnly: flags.has("history-only"),
    buckets,
    concurrency,
    skipUrlRewrite: flags.has("skip-url-rewrite"),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.migration.example to .env.migration and fill it in.`,
    );
  }
  return value;
}

function optionalEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function requiredDatabaseUrl(name: string): string {
  const value = requiredEnv(name);
  const parsed = new URL(value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${name} must be a postgres:// or postgresql:// URL.`);
  }

  if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543") {
    parsed.port = "5432";
    console.warn(`${name}: using Supabase session-pooler port 5432 instead of transaction port 6543.`);
    return parsed.toString();
  }
  return value;
}

function normalizedApiUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Expected an HTTP(S) Supabase URL, received '${value}'.`);
  }
  return parsed.origin;
}

export function projectRefFromApiUrl(value: string): string | null {
  try {
    const host = new URL(value).hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.(?:co|net)$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function projectRefFromDatabaseUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const directMatch = parsed.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.(?:co|net)$/i);
    if (directMatch) return directMatch[1];

    const username = decodeURIComponent(parsed.username);
    const poolerMatch = username.match(/^postgres\.([a-z0-9-]+)$/i);
    return poolerMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

function projectRef(apiUrl: string | null, databaseUrl: string | null): string | null {
  return (apiUrl && projectRefFromApiUrl(apiUrl)) ||
    (databaseUrl && projectRefFromDatabaseUrl(databaseUrl)) ||
    null;
}

export function safeDatabaseLabel(value: string): string {
  try {
    const parsed = new URL(value);
    const database = parsed.pathname.replace(/^\//, "") || "postgres";
    return `${parsed.protocol}//${decodeURIComponent(parsed.username) || "postgres"}@${parsed.hostname}:${parsed.port || "5432"}/${database}`;
  } catch {
    return "<invalid database URL>";
  }
}

function validateProjectPair(): { sourceRef: string | null; targetRef: string | null } {
  const sourceApiUrl = optionalEnv("MIGRATION_SOURCE_URL");
  const sourceDatabaseUrl = optionalEnv("MIGRATION_SOURCE_DB_URL");
  const targetApiUrl = optionalEnv("MIGRATION_TARGET_URL");
  const targetDatabaseUrl = optionalEnv("MIGRATION_TARGET_DB_URL");
  const sourceApiRef = sourceApiUrl && projectRefFromApiUrl(sourceApiUrl);
  const sourceDatabaseRef = sourceDatabaseUrl && projectRefFromDatabaseUrl(sourceDatabaseUrl);
  const targetApiRef = targetApiUrl && projectRefFromApiUrl(targetApiUrl);
  const targetDatabaseRef = targetDatabaseUrl && projectRefFromDatabaseUrl(targetDatabaseUrl);

  if (sourceApiRef && sourceDatabaseRef && sourceApiRef !== sourceDatabaseRef) {
    throw new Error(
      `Source API project '${sourceApiRef}' does not match source database project '${sourceDatabaseRef}'.`,
    );
  }
  if (targetApiRef && targetDatabaseRef && targetApiRef !== targetDatabaseRef) {
    throw new Error(
      `Target API project '${targetApiRef}' does not match target database project '${targetDatabaseRef}'.`,
    );
  }

  const sourceRef = projectRef(sourceApiUrl, sourceDatabaseUrl);
  const targetRef = projectRef(targetApiUrl, targetDatabaseUrl);

  if (sourceRef && targetRef && sourceRef === targetRef) {
    throw new Error(
      `Source and target both resolve to project '${sourceRef}'. Refusing to continue.`,
    );
  }
  return { sourceRef, targetRef };
}

function confirmTarget(options: Options, targetRef: string | null): string {
  if (!targetRef) {
    throw new Error(
      "Could not derive the target project ref from MIGRATION_TARGET_URL or MIGRATION_TARGET_DB_URL.",
    );
  }
  if (options.confirmTarget !== targetRef) {
    throw new Error(
      `Target confirmation missing or incorrect. Re-run with --confirm-target=${targetRef}`,
    );
  }
  return targetRef;
}

function executable(name: string): string {
  return name;
}

/**
 * Invoke the project-pinned CLI through Node instead of the npm/npx shell shim.
 * On Windows, spawning npx.cmd with shell:false can fail with EINVAL; enabling
 * a shell would make database-URL quoting both fragile and less safe.
 */
function supabaseCli(): { command: string; args: string[] } {
  const entrypoint = resolve(
    process.cwd(),
    "node_modules",
    "supabase",
    "dist",
    "supabase.js",
  );
  if (!existsSync(entrypoint)) {
    throw new Error(
      "The project-pinned Supabase CLI is missing. Run `npm install` and try again.",
    );
  }
  return { command: process.execPath, args: [entrypoint] };
}

function commandOutput(command: string, args: string[]): string {
  const result = spawnSync(executable(command), args, {
    encoding: "utf8",
    env: process.env,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr, result.stdout]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(`${command} is unavailable or failed${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout.trim() || result.stderr.trim();
}

function reportTool(label: string, check: () => string, failures: string[]): void {
  try {
    console.log(`${label.padEnd(7)} ${check()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(message);
    console.error(`${label.padEnd(7)} unavailable`);
  }
}

function runCommand(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable(command), args, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: "inherit",
    });
    child.on("error", (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} failed (exit ${code ?? signal ?? "unknown"}).`));
    });
  });
}

async function withDatabase<T>(url: string, task: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  try {
    return await task(client);
  } finally {
    await client.end();
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function tableNames(client: Client, schema: string): Promise<string[]> {
  const result = await client.query<{ tablename: string }>(
    `select tablename
       from pg_catalog.pg_tables
      where schemaname = $1
      order by tablename`,
    [schema],
  );
  return result.rows.map((row) => row.tablename);
}

async function countTable(client: Client, schema: string, table: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function criticalCounts(url: string): Promise<Record<string, number>> {
  return withDatabase(url, async (client) => {
    const counts: Record<string, number> = {};
    const publicNames = await tableNames(client, "public");
    for (const name of publicNames) {
      counts[`public.${name}`] = await countTable(client, "public", name);
    }

    for (const [schema, table] of [
      ["auth", "users"],
      ["auth", "identities"],
      ["storage", "buckets"],
      ["storage", "objects"],
    ] as const) {
      const exists = await client.query<{ exists: boolean }>(
        "select to_regclass($1) is not null as exists",
        [`${schema}.${table}`],
      );
      if (exists.rows[0]?.exists) counts[`${schema}.${table}`] = await countTable(client, schema, table);
    }
    return counts;
  });
}

function printCounts(label: string, counts: Record<string, number>): void {
  console.log(label);
  for (const [name, count] of Object.entries(counts)) console.log(`  ${name}: ${count}`);
  if (Object.keys(counts).length === 0) console.log("  (none)");
}

async function checkStorageCredentials(url: string, key: string, label: string): Promise<void> {
  const client = storageClient(url, key);
  const { data, error } = await client.storage.listBuckets();
  if (error) throw new Error(`${label} Storage credentials failed: ${error.message}`);
  console.log(`${label} Storage API: OK (${data.length} bucket(s))`);
}

async function preflight(): Promise<void> {
  const sourceDbUrl = requiredDatabaseUrl("MIGRATION_SOURCE_DB_URL");
  const targetDbUrl = requiredDatabaseUrl("MIGRATION_TARGET_DB_URL");
  const sourceUrl = normalizedApiUrl(requiredEnv("MIGRATION_SOURCE_URL"));
  const targetUrl = normalizedApiUrl(requiredEnv("MIGRATION_TARGET_URL"));
  const sourceKey = requiredEnv("MIGRATION_SOURCE_SERVICE_ROLE_KEY");
  const targetKey = requiredEnv("MIGRATION_TARGET_SERVICE_ROLE_KEY");
  const { sourceRef, targetRef } = validateProjectPair();
  if (!sourceRef || !targetRef) {
    throw new Error(
      "Could not derive both hosted project refs. Recheck the Supabase API and database URLs.",
    );
  }

  console.log("Supabase migration preflight\n");
  console.log(`Source: ${sourceRef ?? "unknown ref"} (${safeDatabaseLabel(sourceDbUrl)})`);
  console.log(`Target: ${targetRef ?? "unknown ref"} (${safeDatabaseLabel(targetDbUrl)})`);
  console.log(`Node:   ${process.version}`);

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) throw new Error("The Supabase CLI requires Node.js 20 or newer.");

  const toolFailures: string[] = [];
  const cli = supabaseCli();
  reportTool("CLI:", () => commandOutput(cli.command, [...cli.args, "--version"]), toolFailures);
  let dockerReady = false;
  reportTool("Docker:", () => {
    const clientVersion = commandOutput("docker", ["--version"]);
    const serverVersion = commandOutput("docker", ["info", "--format", "{{.ServerVersion}}"]);
    dockerReady = true;
    return `${clientVersion}; server ${serverVersion}`;
  }, toolFailures);
  try {
    console.log(`${"psql:".padEnd(7)} ${commandOutput("psql", ["--version"])}`);
  } catch (error) {
    if (dockerReady) console.log(`${"psql:".padEnd(7)} Docker client fallback`);
    else toolFailures.push(error instanceof Error ? error.message : String(error));
  }
  if (toolFailures.length > 0) {
    throw new Error(
      `Migration prerequisites are not ready:\n  - ${toolFailures.join("\n  - ")}`,
    );
  }

  const sourceInfo = await withDatabase(sourceDbUrl, async (client) => {
    const version = await client.query<{ server_version: string }>("show server_version");
    const extensions = await client.query<{ extname: string; extversion: string }>(
      "select extname, extversion from pg_extension order by extname",
    );
    return { version: version.rows[0]?.server_version ?? "unknown", extensions: extensions.rows };
  });
  const targetInfo = await withDatabase(targetDbUrl, async (client) => {
    const version = await client.query<{ server_version: string }>("show server_version");
    const extensions = await client.query<{ extname: string; extversion: string }>(
      "select extname, extversion from pg_extension order by extname",
    );
    return { version: version.rows[0]?.server_version ?? "unknown", extensions: extensions.rows };
  });

  console.log(`Source PostgreSQL: ${sourceInfo.version}`);
  console.log(`Target PostgreSQL: ${targetInfo.version}`);
  console.log(
    `Source extensions: ${sourceInfo.extensions.map((item) => `${item.extname}@${item.extversion}`).join(", ")}`,
  );
  const targetExtensionNames = new Set(targetInfo.extensions.map((item) => item.extname));
  const missingExtensions = sourceInfo.extensions.filter(
    (item) => !targetExtensionNames.has(item.extname),
  );
  if (missingExtensions.length > 0) {
    console.warn(
      `Target is missing source extension(s): ${missingExtensions.map((item) => item.extname).join(", ")}`,
    );
  }

  const targetCounts = await criticalCounts(targetDbUrl);
  printCounts("Target rows before restore:", targetCounts);
  if (Object.values(targetCounts).some((count) => count > 0)) {
    console.warn("WARNING: The target already contains rows. A normal restore will refuse it.");
  }

  await checkStorageCredentials(sourceUrl, sourceKey, "Source");
  await checkStorageCredentials(targetUrl, targetKey, "Target");

  console.log("\nPreflight passed. Review the extension list, then begin the write freeze and export.");
}

function defaultExportDirectory(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(process.cwd(), "backups", `supabase-migration-${stamp}`);
}

function requireArtifactDirectory(options: Options): string {
  if (!options.dir) throw new Error("This phase requires --dir=<backup-directory>.");
  return resolve(process.cwd(), options.dir);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function supabaseDump(sourceDbUrl: string, args: string[]): Promise<void> {
  const cli = supabaseCli();
  await runCommand(cli.command, [
    ...cli.args,
    "db",
    "dump",
    "--db-url",
    sourceDbUrl,
    ...args,
  ]);
}

function sanitizeManagedRoleSettings(path: string): void {
  const original = readFileSync(path, "utf8");
  const sanitized = original.replace(
    /^GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";\r?$/gm,
    "-- Omitted: managed Supabase targets do not permit this platform-owned parameter grant.",
  );
  if (sanitized !== original) {
    writeFileSync(path, sanitized, "utf8");
    console.log("Removed a platform-owned log_min_messages grant from roles.sql.");
  }
}

function normalizeManagedExtensionSchemas(path: string): void {
  const original = readFileSync(path, "utf8");
  let sanitized = original
    .replace(
      /CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";/g,
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";',
    )
    .replace(/"public"\."(gin|gist)_trgm_ops"/g, '"extensions"."$1_trgm_ops"');
  const pgTrgmFunctions = [
    "gin_extract_query_trgm",
    "gin_extract_value_trgm",
    "gin_trgm_consistent",
    "gin_trgm_triconsistent",
    "gtrgm_compress",
    "gtrgm_consistent",
    "gtrgm_decompress",
    "gtrgm_distance",
    "gtrgm_in",
    "gtrgm_options",
    "gtrgm_out",
    "gtrgm_penalty",
    "gtrgm_picksplit",
    "gtrgm_same",
    "gtrgm_union",
    "set_limit",
    "show_limit",
    "show_trgm",
    "similarity",
    "similarity_dist",
    "similarity_op",
    "strict_word_similarity",
    "strict_word_similarity_commutator_op",
    "strict_word_similarity_dist_commutator_op",
    "strict_word_similarity_dist_op",
    "strict_word_similarity_op",
    "word_similarity",
    "word_similarity_commutator_op",
    "word_similarity_dist_commutator_op",
    "word_similarity_dist_op",
    "word_similarity_op",
  ];
  for (const functionName of pgTrgmFunctions) {
    sanitized = sanitized.replaceAll(
      `FUNCTION "public"."${functionName}"`,
      `FUNCTION "extensions"."${functionName}"`,
    );
  }
  sanitized = sanitized.replaceAll('"public"."gtrgm"', '"extensions"."gtrgm"');
  if (sanitized !== original) {
    writeFileSync(path, sanitized, "utf8");
    console.log("Normalized pg_trgm objects to the managed extensions schema.");
  }
}

async function exportDatabase(options: Options): Promise<void> {
  const sourceDbUrl = requiredDatabaseUrl("MIGRATION_SOURCE_DB_URL");
  const { sourceRef } = validateProjectPair();
  const directory = options.dir ? resolve(process.cwd(), options.dir) : defaultExportDirectory();
  mkdirSync(directory, { recursive: true });

  const existing = ARTIFACT_NAMES.filter((name) => existsSync(resolve(directory, name)));
  if (existing.length > 0 || existsSync(resolve(directory, "manifest.json"))) {
    throw new Error(
      `Refusing to overwrite migration artifacts in ${directory}. Choose a new --dir.`,
    );
  }

  console.log(`Exporting ${sourceRef ?? "source project"} to ${directory}\n`);
  await supabaseDump(sourceDbUrl, ["--file", resolve(directory, "roles.sql"), "--role-only"]);
  sanitizeManagedRoleSettings(resolve(directory, "roles.sql"));
  await supabaseDump(sourceDbUrl, ["--file", resolve(directory, "schema.sql")]);
  normalizeManagedExtensionSchemas(resolve(directory, "schema.sql"));
  await supabaseDump(sourceDbUrl, [
    "--file",
    resolve(directory, "data.sql"),
    "--use-copy",
    "--data-only",
    "--exclude",
    "storage.buckets_vectors",
    "--exclude",
    "storage.vector_indexes",
  ]);
  const hasMigrationHistory = await withDatabase(sourceDbUrl, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      "select to_regnamespace('supabase_migrations') is not null as exists",
    );
    return result.rows[0]?.exists === true;
  });
  if (hasMigrationHistory) {
    await supabaseDump(sourceDbUrl, [
      "--file",
      resolve(directory, "history_schema.sql"),
      "--schema",
      "supabase_migrations",
    ]);
    await supabaseDump(sourceDbUrl, [
      "--file",
      resolve(directory, "history_data.sql"),
      "--use-copy",
      "--data-only",
      "--schema",
      "supabase_migrations",
    ]);
  } else {
    console.log("Source has no supabase_migrations schema; recording empty history artifacts.");
    writeFileSync(
      resolve(directory, "history_schema.sql"),
      "-- Source project has no supabase_migrations schema.\n",
      "utf8",
    );
    writeFileSync(
      resolve(directory, "history_data.sql"),
      "-- Source project has no Supabase CLI migration history data.\n",
      "utf8",
    );
  }

  const artifacts: ArtifactManifest["artifacts"] = {};
  for (const name of ARTIFACT_NAMES) {
    const path = resolve(directory, name);
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`Export did not create a usable ${name}.`);
    }
    artifacts[name] = { bytes: statSync(path).size, sha256: sha256(path) };
  }

  const manifest: ArtifactManifest = {
    generatedAt: new Date().toISOString(),
    sourceProjectRef: sourceRef,
    sourceDatabase: safeDatabaseLabel(sourceDbUrl),
    artifacts,
  };
  writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log("\nExport complete and checksummed.");
  console.log(`Next: npm run supabase:migrate -- restore --dir="${directory}" --confirm-target=TARGET_REF`);
}

function loadAndVerifyManifest(directory: string, allowArtifactEdits: boolean): ArtifactManifest {
  const manifestPath = resolve(directory, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}.`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ArtifactManifest;

  for (const name of ARTIFACT_NAMES) {
    const path = resolve(directory, name);
    const expected = manifest.artifacts?.[name];
    if (!existsSync(path) || !expected) throw new Error(`Migration artifact ${name} is missing.`);
    const actualBytes = statSync(path).size;
    const actualHash = sha256(path);
    if (actualBytes !== expected.bytes || actualHash !== expected.sha256) {
      if (!allowArtifactEdits) {
        throw new Error(
          `${name} no longer matches manifest.json. If this was an intentional, reviewed ` +
            "Supabase troubleshooting edit, re-run with --allow-artifact-edits.",
        );
      }
      console.warn(`WARNING: accepting reviewed changes to ${name}.`);
    }
  }
  return manifest;
}

function psqlEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("MIGRATION_TARGET_DB_URL must be a postgres:// or postgresql:// URL.");
  }
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username || "postgres"),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "") || "postgres"),
    PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
  };
}

async function runPsql(databaseUrl: string, args: string[]): Promise<void> {
  const environment = psqlEnvironment(databaseUrl);
  try {
    commandOutput("psql", ["--version"]);
    await runCommand(
      "psql",
      ["--no-psqlrc", "--variable=ON_ERROR_STOP=1", ...args],
      environment,
    );
    return;
  } catch (error) {
    const unavailable = error instanceof Error && /unavailable|ENOENT/i.test(error.message);
    if (!unavailable) throw error;
  }

  const filePaths = args
    .map((value, index) => args[index - 1] === "--file" ? resolve(value) : null)
    .filter((value): value is string => value !== null);
  if (filePaths.length === 0) {
    throw new Error("Docker psql fallback requires at least one --file argument.");
  }
  const artifactDirectory = dirname(filePaths[0]);
  if (filePaths.some((path) => dirname(path) !== artifactDirectory)) {
    throw new Error("Docker psql fallback requires all SQL files to share one directory.");
  }
  const containerArgs = args.map((value, index) =>
    args[index - 1] === "--file" ? `/migration/${basename(value)}` : value
  );

  console.log("Native psql is unavailable; using postgres:17-alpine through Docker.");
  await runCommand(
    "docker",
    [
      "run",
      "--rm",
      "--env", "PGHOST",
      "--env", "PGPORT",
      "--env", "PGUSER",
      "--env", "PGPASSWORD",
      "--env", "PGDATABASE",
      "--env", "PGSSLMODE",
      "--mount", `type=bind,source=${artifactDirectory},target=/migration,readonly`,
      "postgres:17-alpine",
      "psql",
      "--no-psqlrc",
      "--variable=ON_ERROR_STOP=1",
      ...containerArgs,
    ],
    environment,
  );
}

async function restoreDatabase(options: Options): Promise<void> {
  const targetDbUrl = requiredDatabaseUrl("MIGRATION_TARGET_DB_URL");
  const { sourceRef, targetRef } = validateProjectPair();
  const confirmedRef = confirmTarget(options, targetRef);
  const directory = requireArtifactDirectory(options);
  const manifest = loadAndVerifyManifest(directory, options.allowArtifactEdits);

  if (manifest.sourceProjectRef && sourceRef && manifest.sourceProjectRef !== sourceRef) {
    throw new Error(
      `The artifacts came from ${manifest.sourceProjectRef}, but the configured source is ${sourceRef}.`,
    );
  }

  if (!options.historyOnly) {
    const targetCounts = await criticalCounts(targetDbUrl);
    const populated = Object.entries(targetCounts).filter(([, count]) => count > 0);
    if (populated.length > 0 && !options.allowNonemptyTarget) {
      throw new Error(
        `Target ${confirmedRef} is not empty (${populated.map(([name, count]) => `${name}=${count}`).join(", ")}). ` +
          "Use a fresh project. --allow-nonempty-target is only for a deliberately inspected retry.",
      );
    }

    console.log(`Restoring ${basename(directory)} into target ${confirmedRef}.`);
    console.log("The main restore runs in one transaction and stops on the first SQL error.\n");

    await runPsql(targetDbUrl, [
      "--single-transaction",
      "--file",
      resolve(directory, "roles.sql"),
      "--file",
      resolve(directory, "schema.sql"),
      "--command",
      "SET session_replication_role = replica",
      "--file",
      resolve(directory, "data.sql"),
    ]);
  }

  console.log("\nRestoring Supabase CLI migration history...");
  await runPsql(targetDbUrl, [
    "--single-transaction",
    "--file",
    resolve(directory, "history_schema.sql"),
    "--file",
    resolve(directory, "history_data.sql"),
  ]);

  console.log(
    options.historyOnly
      ? "\nMigration history restore complete."
      : "\nDatabase restore complete. Configure dashboard settings, then run the storage phase.",
  );
}

function storageClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function storageError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function retry<T>(label: string, operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const delay = 500 * 2 ** (attempt - 1);
        console.warn(`  ${label} failed (attempt ${attempt}/${attempts}); retrying in ${delay}ms.`);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
      }
    }
  }
  throw lastError;
}

async function listAllStorageFiles(
  client: SupabaseClient,
  bucket: string,
  prefix = "",
): Promise<StorageFile[]> {
  const files: StorageFile[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`List ${bucket}/${prefix}: ${error.message}`);

    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.metadata === null) files.push(...await listAllStorageFiles(client, bucket, path));
      else files.push({ path, metadata: (item.metadata as Record<string, unknown>) ?? null });
    }
    if (!data || data.length < pageSize) break;
  }
  return files;
}

async function listStorageFilesFromDatabase(
  databaseUrl: string,
  bucket: string,
): Promise<StorageFile[]> {
  return withDatabase(databaseUrl, async (client) => {
    const result = await client.query<{ path: string; metadata: Record<string, unknown> | null }>(
      `select name as path, metadata
         from storage.objects
        where bucket_id = $1
        order by name`,
      [bucket],
    );
    return result.rows;
  });
}

function uploadMetadata(file: StorageFile): {
  upsert: true;
  contentType?: string;
  cacheControl?: string;
} {
  const metadata = file.metadata ?? {};
  const mimetype = metadata.mimetype;
  const cacheControl = metadata.cacheControl ?? metadata.cache_control;
  return {
    upsert: true,
    ...(typeof mimetype === "string" ? { contentType: mimetype } : {}),
    ...(typeof cacheControl === "string" || typeof cacheControl === "number"
      ? { cacheControl: String(cacheControl) }
      : {}),
  };
}

async function transferStorageFile(
  source: SupabaseClient,
  target: SupabaseClient,
  bucket: string,
  file: StorageFile,
): Promise<void> {
  const body = await retry(`download ${bucket}/${file.path}`, async () => {
    const { data, error } = await source.storage.from(bucket).download(file.path);
    if (error) throw new Error(error.message);
    return data;
  });

  await retry(`upload ${bucket}/${file.path}`, async () => {
    const { error } = await target.storage.from(bucket).upload(
      file.path,
      body,
      uploadMetadata(file),
    );
    if (error) throw new Error(error.message);
  });
}

async function runConcurrent<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<Array<{ value: T; error: string }>> {
  const failures: Array<{ value: T; error: string }> = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      try {
        await operation(values[index]);
      } catch (error) {
        failures.push({ value: values[index], error: storageError(error) });
      }
    }
  });
  await Promise.all(workers);
  return failures;
}

async function ensureTargetBucket(
  target: SupabaseClient,
  sourceBucket: StorageBucketShape,
  existingNames: Set<string>,
): Promise<void> {
  const options = {
    public: sourceBucket.public,
    fileSizeLimit: sourceBucket.file_size_limit ?? undefined,
    allowedMimeTypes: sourceBucket.allowed_mime_types ?? undefined,
  };
  const result = existingNames.has(sourceBucket.name)
    ? await target.storage.updateBucket(sourceBucket.name, options)
    : await target.storage.createBucket(sourceBucket.name, options);
  if (result.error) throw new Error(`Prepare bucket ${sourceBucket.name}: ${result.error.message}`);
  existingNames.add(sourceBucket.name);
}

async function rewriteShuttlecraftStorageUrls(sourceUrl: string, targetUrl: string, targetDbUrl: string): Promise<void> {
  const sourcePrefix = `${sourceUrl}/storage/v1/object/public/`;
  const targetPrefix = `${targetUrl}/storage/v1/object/public/`;
  if (sourcePrefix === targetPrefix) return;

  await withDatabase(targetDbUrl, async (client) => {
    const imageTable = await client.query<{ exists: boolean }>(
      "select to_regclass('public.racket_images') is not null as exists",
    );
    const racketTable = await client.query<{ exists: boolean }>(
      "select to_regclass('public.rackets') is not null as exists",
    );
    let updated = 0;

    await client.query("begin");
    try {
      if (imageTable.rows[0]?.exists) {
        const result = await client.query(
          `update public.racket_images
              set public_url = case when public_url like $1 then replace(public_url, $2, $3) else public_url end,
                  thumb_url = case when thumb_url like $1 then replace(thumb_url, $2, $3) else thumb_url end
            where public_url like $1 or thumb_url like $1`,
          [`${sourcePrefix}%`, sourcePrefix, targetPrefix],
        );
        updated += result.rowCount ?? 0;
      }
      if (racketTable.rows[0]?.exists) {
        const result = await client.query(
          `update public.rackets
              set hero_image_url = case when hero_image_url like $1 then replace(hero_image_url, $2, $3) else hero_image_url end,
                  hero_thumb_url = case when hero_thumb_url like $1 then replace(hero_thumb_url, $2, $3) else hero_thumb_url end
            where hero_image_url like $1 or hero_thumb_url like $1`,
          [`${sourcePrefix}%`, sourcePrefix, targetPrefix],
        );
        updated += result.rowCount ?? 0;
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    console.log(`Rewrote persisted Storage URLs in ${updated} Shuttlecraft row(s).`);
  });
}

async function migrateStorage(options: Options): Promise<void> {
  const sourceUrl = normalizedApiUrl(requiredEnv("MIGRATION_SOURCE_URL"));
  const targetUrl = normalizedApiUrl(requiredEnv("MIGRATION_TARGET_URL"));
  const sourceKey = requiredEnv("MIGRATION_SOURCE_SERVICE_ROLE_KEY");
  const targetKey = requiredEnv("MIGRATION_TARGET_SERVICE_ROLE_KEY");
  const sourceDbUrl = requiredDatabaseUrl("MIGRATION_SOURCE_DB_URL");
  const targetDbUrl = requiredDatabaseUrl("MIGRATION_TARGET_DB_URL");
  const { targetRef } = validateProjectPair();
  confirmTarget(options, targetRef);

  const source = storageClient(sourceUrl, sourceKey);
  const target = storageClient(targetUrl, targetKey);
  const sourceResult = await source.storage.listBuckets();
  if (sourceResult.error) throw new Error(`List source buckets: ${sourceResult.error.message}`);
  const targetResult = await target.storage.listBuckets();
  if (targetResult.error) throw new Error(`List target buckets: ${targetResult.error.message}`);

  let buckets = sourceResult.data as StorageBucketShape[];
  if (options.buckets.length > 0) {
    const requested = new Set(options.buckets);
    buckets = buckets.filter((bucket) => requested.has(bucket.name));
    const found = new Set(buckets.map((bucket) => bucket.name));
    const missing = options.buckets.filter((name) => !found.has(name));
    if (missing.length > 0) throw new Error(`Source bucket(s) not found: ${missing.join(", ")}`);
  }
  const targetNames = new Set(targetResult.data.map((bucket) => bucket.name));
  const allFailures: Array<{ bucket: string; path: string; error: string }> = [];

  console.log(`Migrating ${buckets.length} Storage bucket(s) with concurrency ${options.concurrency}.`);
  console.log("Existing target paths are overwritten; the phase is safe to re-run after a failure.\n");

  for (const bucket of buckets) {
    await ensureTargetBucket(target, bucket, targetNames);
    // The Storage REST list endpoint recursively walks pseudo-folders and can
    // time out on large/deep buckets. The metadata table is authoritative and
    // lets us enumerate every object in one indexed database query.
    const files = await listStorageFilesFromDatabase(sourceDbUrl, bucket.name);
    console.log(`${bucket.name}: ${files.length} object(s)`);

    let completed = 0;
    const failures = await runConcurrent(files, options.concurrency, async (file) => {
      await transferStorageFile(source, target, bucket.name, file);
      completed += 1;
      if (completed % 25 === 0 || completed === files.length) {
        console.log(`  ${bucket.name}: ${completed}/${files.length} copied`);
      }
    });
    allFailures.push(...failures.map(({ value, error }) => ({
      bucket: bucket.name,
      path: value.path,
      error,
    })));
  }

  if (allFailures.length > 0) {
    const directory = resolve(process.cwd(), "backups");
    mkdirSync(directory, { recursive: true });
    const report = resolve(
      directory,
      `supabase-storage-failures-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    writeFileSync(report, JSON.stringify(allFailures, null, 2) + "\n", "utf8");
    throw new Error(`${allFailures.length} Storage object(s) failed. Details: ${report}`);
  }

  if (!options.skipUrlRewrite) {
    await rewriteShuttlecraftStorageUrls(sourceUrl, targetUrl, targetDbUrl);
  }
  console.log("\nStorage migration complete. Run the verify phase before cutover.");
}

function metadataSize(file: StorageFile): number | null {
  const value = file.metadata?.size;
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : null;
}

function compareCounts(
  source: Record<string, number>,
  target: Record<string, number>,
): string[] {
  const differences: string[] = [];
  const names = new Set([...Object.keys(source), ...Object.keys(target)]);
  for (const name of [...names].sort()) {
    if (source[name] !== target[name]) {
      differences.push(`${name}: source=${source[name] ?? "missing"}, target=${target[name] ?? "missing"}`);
    }
  }
  return differences;
}

async function staleStorageUrlCount(targetDbUrl: string, sourceUrl: string): Promise<number> {
  return withDatabase(targetDbUrl, async (client) => {
    const sourcePrefix = `${sourceUrl}/storage/v1/object/public/%`;
    const result = await client.query<{ count: string }>(
      `select
         (case when to_regclass('public.racket_images') is null then 0 else
           (select count(*) from public.racket_images
             where public_url like $1 or thumb_url like $1)
          end)
         +
         (case when to_regclass('public.rackets') is null then 0 else
           (select count(*) from public.rackets
             where hero_image_url like $1 or hero_thumb_url like $1)
          end)::bigint as count`,
      [sourcePrefix],
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function verifyStorage(
  source: SupabaseClient,
  target: SupabaseClient,
  selectedBuckets: string[],
): Promise<string[]> {
  const sourceBucketsResult = await source.storage.listBuckets();
  if (sourceBucketsResult.error) throw new Error(sourceBucketsResult.error.message);
  const targetBucketsResult = await target.storage.listBuckets();
  if (targetBucketsResult.error) throw new Error(targetBucketsResult.error.message);

  const targetBuckets = new Map(targetBucketsResult.data.map((bucket) => [bucket.name, bucket]));
  const requested = new Set(selectedBuckets);
  const sourceBuckets = sourceBucketsResult.data.filter(
    (bucket) => requested.size === 0 || requested.has(bucket.name),
  );
  const differences: string[] = [];

  for (const bucket of sourceBuckets) {
    if (!targetBuckets.has(bucket.name)) {
      differences.push(`storage bucket ${bucket.name}: missing on target`);
      continue;
    }

    const [sourceFiles, targetFiles] = await Promise.all([
      listAllStorageFiles(source, bucket.name),
      listAllStorageFiles(target, bucket.name),
    ]);
    const sourceMap = new Map(sourceFiles.map((file) => [file.path, metadataSize(file)]));
    const targetMap = new Map(targetFiles.map((file) => [file.path, metadataSize(file)]));
    for (const [path, size] of sourceMap) {
      if (!targetMap.has(path)) differences.push(`${bucket.name}/${path}: missing on target`);
      else if (size !== null && targetMap.get(path) !== null && size !== targetMap.get(path)) {
        differences.push(`${bucket.name}/${path}: source=${size} bytes, target=${targetMap.get(path)} bytes`);
      }
    }
    for (const path of targetMap.keys()) {
      if (!sourceMap.has(path)) differences.push(`${bucket.name}/${path}: extra on target`);
    }
    console.log(`  ${bucket.name}: source=${sourceFiles.length}, target=${targetFiles.length}`);
  }
  return differences;
}

async function verifyMigration(options: Options): Promise<void> {
  const sourceDbUrl = requiredDatabaseUrl("MIGRATION_SOURCE_DB_URL");
  const targetDbUrl = requiredDatabaseUrl("MIGRATION_TARGET_DB_URL");
  const sourceUrl = normalizedApiUrl(requiredEnv("MIGRATION_SOURCE_URL"));
  const targetUrl = normalizedApiUrl(requiredEnv("MIGRATION_TARGET_URL"));
  const sourceKey = requiredEnv("MIGRATION_SOURCE_SERVICE_ROLE_KEY");
  const targetKey = requiredEnv("MIGRATION_TARGET_SERVICE_ROLE_KEY");
  validateProjectPair();

  console.log("Comparing database row counts...");
  const [sourceCounts, targetCounts] = await Promise.all([
    criticalCounts(sourceDbUrl),
    criticalCounts(targetDbUrl),
  ]);
  const differences = compareCounts(sourceCounts, targetCounts);
  printCounts("Source:", sourceCounts);
  printCounts("Target:", targetCounts);

  console.log("\nComparing Storage object paths and sizes...");
  const storageDifferences = await verifyStorage(
    storageClient(sourceUrl, sourceKey),
    storageClient(targetUrl, targetKey),
    options.buckets,
  );
  differences.push(...storageDifferences);

  const staleUrls = await staleStorageUrlCount(targetDbUrl, sourceUrl);
  if (staleUrls > 0) differences.push(`${staleUrls} target row(s) still point at the source Storage URL`);

  if (differences.length > 0) {
    console.error("\nVerification failed:");
    for (const difference of differences.slice(0, 100)) console.error(`  - ${difference}`);
    if (differences.length > 100) console.error(`  ...and ${differences.length - 100} more`);
    throw new Error(`${differences.length} migration difference(s) found.`);
  }
  console.log("\nVerification passed: critical row counts and Storage inventories match.");
}

async function main(): Promise<void> {
  loadEnv([".env.migration"]);
  const options = parseOptions(process.argv.slice(2));

  switch (options.action) {
    case "preflight":
      await preflight();
      break;
    case "export":
      await exportDatabase(options);
      break;
    case "restore":
      await restoreDatabase(options);
      break;
    case "storage":
      await migrateStorage(options);
      break;
    case "verify":
      await verifyMigration(options);
      break;
    case "help":
      console.log(usage());
      break;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`\nMigration stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
