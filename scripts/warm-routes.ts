/**
 * Request every public route once, so the first real visitor is not the one
 * who fills the cache.
 *
 *   npx tsx scripts/warm-routes.ts --base=https://example.com
 *   npx tsx scripts/warm-routes.ts --base=… --details=20 --markdown
 *   npx tsx scripts/warm-routes.ts --base=… --strict     # fail on a bad status
 *
 * Why this exists. `use cache` without a remote handler stores entries in the
 * instance's memory, and the cache key includes the build ID — so every deploy
 * empties it, and so does every new serverless instance. That is not a rare
 * path: the production spot check measured `/vi/sellers/vnb` at **0,89 s warm
 * and 18,57 s cold**, and a p75 promise is decided by exactly those outliers.
 * A handful of requests after the deploy, off the visitor's critical path,
 * converts the worst number in the baseline into nothing.
 *
 * It is also the cold-path measurement itself. Run it against a fresh
 * deployment and the table it prints *is* the cold TTFB per route, which is
 * the number the plan's exit criteria are written against — warm numbers
 * cannot prove them.
 *
 * Best-effort by design: warming is an optimisation, and a deploy that is
 * otherwise healthy must not fail because one route was slow. `--strict` opts
 * into failing, for a CI job whose whole purpose is the check.
 */

import { loadEnv } from "./scraper/env";

/** Route templates, locale-prefixed at run time. `localePrefix` is "always",
 *  so every one of these exists under both `/vi` and `/en`. */
const PUBLIC_ROUTES = [
  "",
  "/rackets",
  "/deals",
  "/compare",
  "/finder",
  "/strings",
  "/sellers",
  "/guides",
  "/methodology",
  "/sign-in",
  "/sign-up",
] as const;

const LOCALES = ["vi", "en"] as const;

/** How many requests are in flight at once. Small on purpose: this is warming
 *  a cache, not load-testing, and Hobby rations Active CPU. */
const CONCURRENCY = 4;

const REQUEST_TIMEOUT_MS = 30_000;

interface Options {
  base: string;
  details: number;
  markdown: boolean;
  strict: boolean;
}

function parseArgs(): Options | null {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const base =
    value("base") ??
    process.env.WARM_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);

  if (!base) {
    console.error(
      "Needs a base URL: --base=https://… , or WARM_BASE_URL / " +
        "NEXT_PUBLIC_SITE_URL in the environment.",
    );
    return null;
  }

  const details = Number(value("details") ?? 10);
  return {
    base: base.replace(/\/+$/, ""),
    details: Number.isFinite(details) && details >= 0 ? Math.floor(details) : 10,
    markdown: args.includes("--markdown"),
    strict: args.includes("--strict"),
  };
}

interface Result {
  path: string;
  status: number | null;
  ms: number;
  error?: string;
}

async function warm(base: string, path: string): Promise<Result> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${base}${path}`, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Warming has to fill the same cache entry a visitor would hit, so it
        // asks for the same thing a browser does. A HEAD would skip the body
        // and, with it, the streamed dynamic holes that are the slow part.
        accept: "text/html,application/xhtml+xml",
        "user-agent": "shuttlecraft-warm/1.0 (+scripts/warm-routes.ts)",
        "accept-language": path.startsWith("/en") ? "en" : "vi",
      },
    });
    // Drain the body. The point is the streamed content, which does not
    // finish arriving until it is read.
    await response.text();
    return { path, status: response.status, ms: Date.now() - started };
  } catch (error) {
    return {
      path,
      status: null,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : "unknown error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Run `tasks` with a bounded number in flight, preserving input order. */
async function pooled<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * The detail pages worth warming: the ones `generateStaticParams` would have
 * prerendered if the builder had the memory for it, in the same order. Those
 * are the pages a visitor is most likely to open, and — past the build's
 * ~70-racket ceiling — the ones that have no prerendered shell to serve.
 *
 * Read-only, and optional: no database, no detail warming, everything else
 * still runs.
 */
async function detailPaths(limit: number): Promise<string[]> {
  if (limit === 0) return [];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("  (no Supabase keys — skipping detail pages)");
    return [];
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("racket_market")
    .select("id,brand_slug")
    .order("court_score", { ascending: false, nullsFirst: false })
    .order("spec_score", { ascending: false })
    .order("id")
    .limit(limit);

  if (error || !data) {
    console.log(`  (racket_market unavailable — skipping detail pages)`);
    return [];
  }

  // `racket_market` exposes the brand slug but not the racket's own slug, so
  // the paths come from the rackets table keyed on the ids the view ranked.
  const ids = (data as { id: string; brand_slug: string }[]).map((r) => r.id);
  const brandById = new Map(
    (data as { id: string; brand_slug: string }[]).map((r) => [r.id, r.brand_slug]),
  );

  const { data: rows, error: slugError } = await supabase
    .from("rackets")
    .select("id,slug")
    .in("id", ids);
  if (slugError || !rows) return [];

  const bySlug = new Map((rows as { id: string; slug: string }[]).map((r) => [r.id, r.slug]));

  return ids
    .map((id) => {
      const brand = brandById.get(id);
      const slug = bySlug.get(id);
      return brand && slug ? `/rackets/${brand}/${slug}` : null;
    })
    .filter((p): p is string => p !== null);
}

async function main() {
  loadEnv();
  const options = parseArgs();
  if (!options) {
    process.exitCode = 1;
    return;
  }

  console.log(`Warming ${options.base}`);

  const details = await detailPaths(options.details);

  const paths: string[] = [];
  for (const locale of LOCALES) {
    for (const route of PUBLIC_ROUTES) paths.push(`/${locale}${route}`);
  }
  // Detail pages in the default locale only. The other locale shares every
  // cached read behind them; only the rendered shell differs, and warming both
  // doubles the requests for a fraction of the benefit.
  for (const path of details) paths.push(`/vi${path}`);

  const results = await pooled(
    paths.map((path) => () => warm(options.base, path)),
    CONCURRENCY,
  );

  const failed = results.filter((r) => r.status === null || r.status >= 400);
  const slow = [...results].sort((a, b) => b.ms - a.ms);

  if (options.markdown) {
    console.log("\n| Route | Status | Cold |");
    console.log("| --- | ---: | ---: |");
    for (const r of slow)
      console.log(`| \`${r.path}\` | ${r.status ?? "—"} | ${(r.ms / 1000).toFixed(2)} s |`);
  } else {
    console.log("\nSlowest first:");
    for (const r of slow.slice(0, 15))
      console.log(
        `  ${String((r.ms / 1000).toFixed(2)).padStart(6)} s  ` +
          `${String(r.status ?? "ERR").padStart(3)}  ${r.path}` +
          (r.error ? `  (${r.error})` : ""),
      );
  }

  const total = results.reduce((sum, r) => sum + r.ms, 0);
  console.log(
    `\n${results.length} routes warmed · slowest ${(slow[0]?.ms ?? 0) / 1000}s · ` +
      `${(total / results.length / 1000).toFixed(2)}s mean · ${failed.length} failed`,
  );

  if (failed.length > 0) {
    for (const r of failed)
      console.error(`  ${r.status ?? "ERR"}  ${r.path}${r.error ? `  ${r.error}` : ""}`);
    // Best-effort unless asked otherwise: a healthy deploy must not be undone
    // by a slow warm-up request.
    if (options.strict) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  // Same rule: only --strict turns a warm failure into a failed job, and that
  // flag is checked before this point, so reaching here is a bug in the script
  // rather than a slow route.
  process.exitCode = 1;
});
