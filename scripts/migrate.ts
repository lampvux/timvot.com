/**
 * Applies the SQL in supabase/migrations to the linked Supabase project.
 *
 *   npx tsx scripts/migrate.ts                  # apply everything pending
 *   npx tsx scripts/migrate.ts --dry-run        # list what would run
 *   npx tsx scripts/migrate.ts --file=supabase/scraped-catalogue.sql
 *
 * Why this exists rather than `supabase db push`: that needs an interactive
 * login and a database password prompt, which a non-interactive agent session
 * cannot answer. This runs the same SQL over the Management API, which takes a
 * personal access token and nothing else.
 *
 * Credentials, in the order they are tried:
 *
 *   SUPABASE_ACCESS_TOKEN   a personal access token (sbp_…), from
 *                           Dashboard → Account → Access Tokens. Can run DDL.
 *   SUPABASE_DB_URL         a direct postgres:// connection string, from
 *                           Dashboard → Settings → Database. Needs the `pg`
 *                           package installed.
 *
 * A service-role key is deliberately NOT accepted here. It authenticates
 * against PostgREST, which executes no DDL — it can insert catalogue rows
 * (that is what `npm run scrape:sync` uses it for) but it cannot create a
 * table. Passing one to a migration runner would fail confusingly.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { loadEnv } from "./scraper/env";

const MIGRATIONS_DIR = "supabase/migrations";
const TRACKING_TABLE = "schema_migrations";

interface Options {
  dryRun: boolean;
  file: string | null;
  projectRef: string | null;
}

function parseArgs(): Options {
  const flags: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      flags[key] = value === undefined ? true : value;
    }
  }
  return {
    dryRun: Boolean(flags["dry-run"]),
    file: typeof flags.file === "string" ? flags.file : null,
    projectRef: typeof flags.project === "string" ? flags.project : null,
  };
}

/** The project ref is the first label of the Supabase URL host. */
function resolveProjectRef(explicit: string | null): string | null {
  if (explicit) return explicit;
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

/** Runs SQL and returns the rows the statement produced. */
type SqlRunner = (sql: string) => Promise<unknown[]>;

/**
 * Management API transport. This is the same endpoint the dashboard SQL editor
 * uses, so it can create types, tables, policies and indexes.
 */
function managementApiRunner(projectRef: string, token: string): SqlRunner {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  return async (sql: string) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });

    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.message || parsed.error || text;
      } catch {
        /* keep the raw body */
      }
      throw new Error(`Management API HTTP ${res.status}: ${detail}`);
    }

    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
}

/** Direct Postgres transport, used when a connection string is available. */
async function postgresRunner(connectionString: string): Promise<SqlRunner> {
  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch {
    throw new Error(
      "SUPABASE_DB_URL is set but the `pg` package is not installed. " +
        "Run `npm i -D pg`, or use SUPABASE_ACCESS_TOKEN instead.",
    );
  }

  const client = new pg.default.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const runner: SqlRunner = async (sql: string) => {
    const result = await client.query(sql);
    return Array.isArray(result) ? [] : (result.rows ?? []);
  };
  // Attach so main() can close it.
  (runner as SqlRunner & { close: () => Promise<void> }).close = () => client.end();
  return runner;
}

/**
 * Pick the connection string to migrate over.
 *
 * `DIRECT_URL` is preferred over `DATABASE_URL` deliberately. Supabase hands
 * out two: `DATABASE_URL` points at pgbouncer on 6543 in transaction pooling
 * mode, which multiplexes statements across backends and does not keep a
 * session — session-scoped DDL, advisory locks and `$$`-quoted DO blocks all
 * misbehave there. `DIRECT_URL` is the session-mode connection on 5432, which
 * is what migrations want. Running the app through the pooler and migrations
 * through the direct URL is exactly why the pair exists.
 */
function resolveConnectionString(): { url: string; source: string } | null {
  const candidates: [name: string, value: string | undefined][] = [
    ["SUPABASE_DB_URL", process.env.SUPABASE_DB_URL],
    ["DIRECT_URL", process.env.DIRECT_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
  ];

  for (const [name, value] of candidates) {
    if (!value) continue;
    if (/pgbouncer=true|:6543\b/.test(value)) {
      // Usable only if it is all we have, and worth saying out loud.
      const better = candidates.find(
        ([, v]) => v && !/pgbouncer=true|:6543\b/.test(v),
      );
      if (better) continue;
      console.warn(
        `⚠️  ${name} is a transaction-mode pooler connection. DDL may fail on it; ` +
          `set DIRECT_URL to the session-mode string (port 5432) if it does.\n`,
      );
    }
    return { url: value, source: name };
  }
  return null;
}

async function resolveRunner(
  projectRef: string | null,
): Promise<{ run: SqlRunner; label: string; close?: () => Promise<void> }> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const connection = resolveConnectionString();

  // A direct session connection is the better transport when we have one: it
  // reports Postgres errors verbatim and runs each migration in a real
  // transaction rather than one HTTP call per statement batch.
  if (connection) {
    const run = await postgresRunner(connection.url);
    return {
      run,
      label: `direct Postgres session (${connection.source})`,
      close: (run as SqlRunner & { close?: () => Promise<void> }).close,
    };
  }

  if (token) {
    if (!projectRef) {
      throw new Error(
        "SUPABASE_ACCESS_TOKEN is set but the project ref is unknown. " +
          "Pass --project=<ref> or set SUPABASE_PROJECT_REF.",
      );
    }
    return { run: managementApiRunner(projectRef, token), label: `Management API (project ${projectRef})` };
  }

  throw new Error(
    "No credential that can run DDL was found.\n\n" +
      "  Set one of these in .env (or the environment):\n\n" +
      "    DIRECT_URL=postgresql://…       Dashboard → Settings → Database (session mode, 5432)\n" +
      "    SUPABASE_ACCESS_TOKEN=sbp_...   Dashboard → Account → Access Tokens\n\n" +
      "  A service-role key will not work here: it authenticates against PostgREST,\n" +
      "  which cannot execute DDL. It is only used by `npm run scrape:sync`.",
  );
}

function listMigrations(): { name: string; path: string }[] {
  const dir = resolve(process.cwd(), MIGRATIONS_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort() // filenames are timestamp-prefixed, so lexical order is apply order
    .map((name) => ({ name, path: resolve(dir, name) }));
}

async function ensureTrackingTable(run: SqlRunner): Promise<void> {
  await run(`
    create table if not exists ${TRACKING_TABLE} (
      name        text primary key,
      applied_at  timestamptz not null default now()
    );
  `);
}

async function appliedMigrations(run: SqlRunner): Promise<Set<string>> {
  const rows = (await run(`select name from ${TRACKING_TABLE};`)) as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

async function main() {
  loadEnv();
  const options = parseArgs();
  const projectRef = resolveProjectRef(options.projectRef);

  console.log("=================================================");
  console.log("🛠  Shuttlecraft database migrations");
  console.log("=================================================");
  console.log(`Project     : ${projectRef ?? "unknown"}`);
  console.log(`Mode        : ${options.dryRun ? "dry run" : "apply"}`);
  console.log("=================================================\n");

  // A one-off file (the scraped catalogue) is applied as-is, untracked.
  if (options.file) {
    const path = resolve(process.cwd(), options.file);
    const sql = readFileSync(path, "utf8");
    const kb = Math.round(Buffer.byteLength(sql, "utf8") / 1024);
    console.log(`📄 ${basename(path)} — ${kb} KB`);

    if (options.dryRun) {
      console.log("   (dry run — not executed)");
      return;
    }

    const { run, label, close } = await resolveRunner(projectRef);
    console.log(`   via ${label}\n`);
    try {
      await run(sql);
      console.log(`✅ Applied ${basename(path)}`);
    } finally {
      await close?.();
    }
    return;
  }

  const migrations = listMigrations();
  if (migrations.length === 0) {
    console.log("No migrations found in " + MIGRATIONS_DIR);
    return;
  }

  if (options.dryRun) {
    // Without a credential we cannot know what is already applied, so report
    // the full set rather than pretending to know which are pending.
    console.log("Migrations on disk, in apply order:");
    for (const m of migrations) {
      const kb = Math.round(Buffer.byteLength(readFileSync(m.path, "utf8"), "utf8") / 1024);
      console.log(`  ${m.name}  (${kb} KB)`);
    }
    console.log("\n(dry run — nothing executed)");
    return;
  }

  const { run, label, close } = await resolveRunner(projectRef);
  console.log(`Connected via ${label}\n`);

  try {
    await ensureTrackingTable(run);
    const done = await appliedMigrations(run);

    const pending = migrations.filter((m) => !done.has(m.name));
    if (pending.length === 0) {
      console.log(`✅ Up to date — all ${migrations.length} migrations already applied.`);
      return;
    }

    console.log(`${pending.length} pending migration(s):\n`);

    for (const migration of pending) {
      const sql = readFileSync(migration.path, "utf8");
      process.stdout.write(`  ▸ ${migration.name} … `);

      try {
        // Each migration runs as one transaction: a half-applied schema change
        // is far worse than one that failed cleanly.
        await run(`begin;\n${sql}\ncommit;`);
        await run(
          `insert into ${TRACKING_TABLE} (name) values ('${migration.name.replace(/'/g, "''")}') ` +
            `on conflict (name) do nothing;`,
        );
        console.log("applied");
      } catch (err) {
        console.log("FAILED");
        // Best effort: the transaction may already be aborted server-side.
        try {
          await run("rollback;");
        } catch {
          /* nothing to roll back */
        }
        throw new Error(
          `${migration.name} failed and was rolled back.\n  ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    console.log(`\n✅ Applied ${pending.length} migration(s).`);
  } finally {
    await close?.();
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
