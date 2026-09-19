import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

/**
 * A server secret must not be reachable from the browser.
 *
 * Two separate checks, because the two failures look nothing alike.
 *
 * The *source* check is the one that catches a mistake while it is still
 * cheap: a `"use client"` module that reads `SUPABASE_SERVICE_ROLE_KEY`, or a
 * node-only scraper imported into the app. Next inlines `process.env.X` at
 * build time for anything that reaches the client bundle, so this is not a
 * theoretical reachability argument — it is a literal string substitution.
 *
 * The *bundle* check is the one that catches the mistake that survives review:
 * a variable renamed to `NEXT_PUBLIC_…`, which makes the inlining correct,
 * intentional and catastrophic. It greps the built assets for the actual
 * values, so it cannot be fooled by the name.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const SRC = join(ROOT, "src");

/** Environment variables that must never reach a browser. */
const SERVER_ONLY_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_URL",
  "DIRECT_URL",
  "REVALIDATE_SECRET",
  "VERCEL_TOKEN",
  "GITHUB_TOKEN",
];

interface SourceFile {
  path: string;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(entry)) continue;
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) walk(absolute, out);
    else if (/\.tsx?$/.test(entry)) out.push(absolute);
  }
  return out;
}

const appFiles: SourceFile[] = walk(SRC).map((absolute) => ({
  path: relative(ROOT, absolute).split(sep).join("/"),
  text: readFileSync(absolute, "utf8"),
}));

const isClient = (file: SourceFile) => /^\s*["']use client["']/m.test(file.text);

/**
 * A `"use server"` module is a boundary, not an import.
 *
 * A Client Component that imports a Server Action gets a reference the runtime
 * turns into a POST — the module's code never reaches the browser, and that is
 * the whole point of the directive. Walking through one would report every
 * sign-in form as leaking the Supabase server client, which is both wrong and
 * the kind of false positive that gets a security test deleted.
 */
const isServerAction = (file: SourceFile) => /^\s*["']use server["']/m.test(file.text);

/** Resolve a relative or `@/`-aliased import to a repo-relative path. */
function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(ROOT, dirname(from), specifier);
  else return null;

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return relative(ROOT, candidate).split(sep).join("/");
  }
  return null;
}

const byPath = new Map(appFiles.map((file) => [file.path, file]));

const importsOf = (file: SourceFile): string[] =>
  [...file.text.matchAll(/from\s*["']([^"']+)["']/g)]
    .map((match) => resolveImport(file.path, match[1]))
    .filter((path): path is string => Boolean(path));

/** Everything a Client Component can pull in, transitively. */
function clientReachable(): Set<string> {
  const seen = new Set<string>();
  const queue = appFiles.filter(isClient).map((file) => file.path);

  while (queue.length) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;

    const file = byPath.get(path);

    // Stop before the boundary, and do not count the action module itself:
    // neither it nor anything it imports reaches the browser.
    if (file && isServerAction(file)) continue;

    seen.add(path);
    if (!file) continue;

    for (const next of importsOf(file)) if (!seen.has(next)) queue.push(next);
  }

  return seen;
}

/* ---------------------------------------------------------- the source side */

test("no Client Component reads a server-only environment variable", () => {
  const offenders: string[] = [];

  for (const file of appFiles.filter(isClient)) {
    for (const name of SERVER_ONLY_ENV) {
      if (file.text.includes(name)) offenders.push(`${file.path} → ${name}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join("; ")}. Next inlines process.env into the client ` +
      `bundle, so this is not a reachability argument — it is a literal ` +
      `string substitution that publishes the key.`,
  );
});

test("no module a Client Component can reach names a server-only variable", () => {
  // The transitive form: a shared helper imported by both a page and a
  // "use client" leaf is a client module too.
  const reachable = clientReachable();
  const offenders: string[] = [];

  for (const path of reachable) {
    const file = byPath.get(path);
    if (!file) continue;
    for (const name of SERVER_ONLY_ENV) {
      if (file.text.includes(name)) offenders.push(`${path} → ${name}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join("; ")} is reachable from a Client Component and names a ` +
      `server-only secret.`,
  );
});

test("the read path is not reachable from the browser", () => {
  const reachable = clientReachable();

  for (const forbidden of [
    "src/lib/data/repository.ts",
    "src/lib/data/catalog-page.ts",
    "src/lib/supabase/server.ts",
  ]) {
    assert.ok(
      !reachable.has(forbidden),
      `${forbidden} is reachable from a Client Component. It reads the ` +
        `catalogue with a cookie-free server client; in the browser that is ` +
        `either a build error or the whole catalogue in the bundle.`,
    );
  }
});

test("the app never imports a node-only script", () => {
  // `scripts/` is tsx, runs outside the Next build, and holds the
  // service-role paths. CLAUDE.md states the boundary; nothing enforced it.
  const offenders = appFiles
    .filter((file) =>
      /from\s*["'](?:\.\.\/)*(?:\.\.\/)*scripts\/|from\s*["']@\/\.\.\/scripts\//.test(
        file.text,
      ),
    )
    .map((file) => file.path);

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} imports from scripts/. Those modules are node-only ` +
      `and several of them hold a service-role client.`,
  );
});

test("the service-role key is only ever read outside src/", () => {
  const offenders = appFiles
    .filter((file) => file.text.includes("SUPABASE_SERVICE_ROLE_KEY"))
    .map((file) => file.path);

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} reads the service-role key. It bypasses every ` +
      `RLS policy in the schema, so it belongs to the scrapers and the ` +
      `migration scripts, never to a request the app serves.`,
  );
});

test("only the publishable Supabase keys carry the NEXT_PUBLIC_ prefix", () => {
  // The rename that makes a leak correct-by-construction.
  const published = new Set<string>();

  for (const file of appFiles) {
    for (const match of file.text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
      published.add(match[0]);
    }
  }

  for (const name of published) {
    assert.ok(
      !/SERVICE_ROLE|SECRET|ACCESS_TOKEN|PRIVATE|_KEY_ID|DB_URL|DIRECT_URL/.test(name),
      `${name} is exposed to the browser by its prefix. A NEXT_PUBLIC_ name ` +
        `is inlined into every bundle by design; nothing secret may wear one.`,
    );
  }
});

/* ---------------------------------------------------------- the bundle side */

/**
 * Grep the built client assets for the *values*, not the names.
 *
 * Skipped when there is no build to read: this runs in CI after `next build`,
 * and a developer running `npm test` on a clean checkout should not be told
 * their machine is insecure because `.next` is absent.
 */
function clientAssets(): string[] {
  const staticDir = join(ROOT, ".next", "static");
  if (!existsSync(staticDir)) return [];

  const out: string[] = [];
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      if (statSync(absolute).isDirectory()) collect(absolute);
      else if (/\.(js|mjs|css|json|txt)$/.test(entry)) out.push(absolute);
    }
  };
  collect(staticDir);
  return out;
}

test("no server secret's value appears in a client asset", (t) => {
  const assets = clientAssets();
  if (assets.length === 0) {
    t.skip("no .next/static to scan — run after `next build`.");
    return;
  }

  // Only values long enough to be a real credential; a short or placeholder
  // value would match half the bundle by coincidence.
  const secrets = SERVER_ONLY_ENV.map((name) => [name, process.env[name]] as const)
    .filter((entry): entry is [string, string] => Boolean(entry[1]) && entry[1]!.length >= 16);

  if (secrets.length === 0) {
    t.skip("no server secrets are set in this environment.");
    return;
  }

  const found: string[] = [];

  for (const asset of assets) {
    const text = readFileSync(asset, "utf8");
    for (const [name] of secrets) {
      const value = process.env[name]!;
      if (text.includes(value)) {
        found.push(`${name} in ${relative(ROOT, asset).split(sep).join("/")}`);
      }
    }
  }

  assert.deepEqual(
    found,
    [],
    `${found.join("; ")}. The value of a server secret is in a file the ` +
      `browser downloads. Rotate it, then find the NEXT_PUBLIC_ rename or the ` +
      `client import that put it there.`,
  );
});

test("a service-role JWT shape does not appear in a client asset", (t) => {
  const assets = clientAssets();
  if (assets.length === 0) {
    t.skip("no .next/static to scan — run after `next build`.");
    return;
  }

  // Independent of whether the secret is set in this environment: a Supabase
  // service-role JWT carries its role in the payload, and the payload is
  // base64url of JSON containing "service_role".
  const found: string[] = [];

  for (const asset of assets) {
    const text = readFileSync(asset, "utf8");

    for (const jwt of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g)) {
      const payload = jwt[0].split(".")[1];
      let decoded = "";
      try {
        decoded = Buffer.from(payload, "base64url").toString("utf8");
      } catch {
        continue;
      }
      if (decoded.includes("service_role")) {
        found.push(relative(ROOT, asset).split(sep).join("/"));
      }
    }
  }

  assert.deepEqual(
    found,
    [],
    `a service-role JWT is embedded in ${found.join(", ")}. That key bypasses ` +
      `every RLS policy in the schema. Rotate it now.`,
  );
});

/* ------------------------------------------------------------ the env files */

test("no .env file is committed", () => {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");

  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const leaked = tracked.filter(
    (path) => /(^|\/)\.env/.test(path) && !/\.example$/.test(path),
  );

  assert.deepEqual(
    leaked,
    [],
    `${leaked.join(", ")} is tracked by git. Only .env*.example files belong ` +
      `in the repository.`,
  );
});

test("every example env file is a template, not a copy", () => {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");

  const examples = execFileSync("git", ["ls-files", "*.example"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const path of examples) {
    const text = readFileSync(join(ROOT, path), "utf8");

    for (const [, name, value] of text.matchAll(/^([A-Z0-9_]+)\s*=\s*(.*)$/gm)) {
      const trimmed = value.trim().replace(/^["']|["']$/g, "");
      if (!trimmed) continue;

      // A real Supabase key is a JWT; a real connection string has credentials.
      assert.ok(
        !trimmed.startsWith("eyJ"),
        `${path} has what looks like a real JWT in ${name}.`,
      );
      assert.ok(
        !/^postgres(ql)?:\/\/[^:]+:[^@]+@/.test(trimmed) ||
          /password|<|your|example|xxx/i.test(trimmed),
        `${path} has what looks like a real connection string in ${name}.`,
      );
    }
  }
});
