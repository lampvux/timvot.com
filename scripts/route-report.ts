/**
 * What the build produced, and whether it is worse than last time.
 *
 *   npx tsx scripts/route-report.ts                 # read .next, compare to baseline
 *   npx tsx scripts/route-report.ts --update        # write the baseline
 *   npx tsx scripts/route-report.ts --markdown      # a table for a step summary
 *   npx tsx scripts/route-report.ts --json=out.json
 *
 * CLAUDE.md asks a human to run `npm run build` and read the route table
 * before calling a change done: a route that moved from prerendered to dynamic,
 * or a First Load JS that jumped, is a regression to explain rather than a
 * detail to discover in production. This reads the same facts out of the build
 * manifests and compares them to a committed baseline, which is the same check
 * done the same way every time.
 *
 * Three things are measured, because three different mistakes show up in them:
 *
 *   rendering mode  A route that stops being prerendered stops being served
 *                   from the CDN, and starts spending Active CPU on every
 *                   visit. One `await cookies()` in a shared layout does this
 *                   to every route at once.
 *   client bundle   The total JavaScript under `.next/static/chunks`. The
 *                   icon barrel put ~1500 glyphs in here; a client boundary on
 *                   a container puts the whole card component in for every
 *                   card on the page.
 *   prerendered     How many pages the build actually emitted. Static
 *                   generation retains roughly 15–25 MB per page, and the
 *                   worker ceiling is what decides whether the build survives.
 *
 * This version of Next does not print a First Load JS column, so the bundle
 * number is measured from the emitted chunks rather than parsed out of the log.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const NEXT = join(ROOT, ".next");
const BASELINE = join(ROOT, "perf", "route-baseline.json");

/* ----------------------------------------------------------------- options */

interface Options {
  update: boolean;
  markdown: boolean;
  json: string | null;
  /** Fractional growth tolerated before the bundle is a regression. */
  tolerance: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  return {
    update: args.includes("--update"),
    markdown: args.includes("--markdown"),
    json: value("json") ?? null,
    tolerance: Number(value("tolerance") ?? "0.05"),
  };
}

/* ------------------------------------------------------------- the reading */

type Mode = "static" | "partial" | "dynamic";

interface RouteFact {
  route: string;
  mode: Mode;
}

interface Report {
  /** Route pattern → rendering mode. */
  modes: Record<string, Mode>;
  /** Bytes of JavaScript the browser can be asked to download. */
  clientBundleBytes: number;
  /** Largest single chunk, which is what a cold visit actually blocks on. */
  largestChunkBytes: number;
  /** Prerendered page count, including every locale. */
  prerenderedPages: number;
  /** Dynamic route patterns, which are the ones that cost per request. */
  dynamicRoutes: number;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function directoryBytes(dir: string, match: RegExp): { total: number; largest: number } {
  let total = 0;
  let largest = 0;

  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const absolute = join(current, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!match.test(entry)) continue;
      total += stats.size;
      if (stats.size > largest) largest = stats.size;
    }
  };

  if (existsSync(dir)) walk(dir);
  return { total, largest };
}

function collect(): Report {
  if (!existsSync(NEXT)) {
    throw new Error(
      "No .next directory. Run `npm run build` before scripts/route-report.ts.",
    );
  }

  const prerender = readJson<{
    routes: Record<string, { renderingMode?: string; routeType?: string }>;
    dynamicRoutes: Record<string, unknown>;
  }>(join(NEXT, "prerender-manifest.json"));

  const appRoutes = readJson<Record<string, string>>(
    join(NEXT, "app-path-routes-manifest.json"),
  );

  /**
   * Rendering mode per route *pattern*, not per generated path.
   *
   * The manifest lists every prerendered path — `/vi/rackets/yonex/astrox-99-pro`
   * and 200 siblings — and comparing those to a baseline would fail every time
   * the catalogue changed, which says nothing about the code. The pattern is
   * the thing a code change moves.
   */
  const modes: Record<string, Mode> = {};

  const patternOf = (path: string): string => {
    // `/vi/rackets/yonex/astrox-99-pro` → `/[locale]/rackets/[brand]/[model]`
    for (const pattern of Object.values(appRoutes)) {
      const regex = new RegExp(
        "^" +
          pattern
            .replace(/\[\[?\.\.\.[^\]]+\]\]?/g, ".*")
            .replace(/\[[^\]]+\]/g, "[^/]+") +
          "$",
      );
      const localised = pattern.replace("[locale]", "(?:vi|en)");
      const localisedRegex = new RegExp(
        "^" +
          localised
            .replace(/\[\[?\.\.\.[^\]]+\]\]?/g, ".*")
            .replace(/\[[^\]]+\]/g, "[^/]+") +
          "$",
      );
      if (regex.test(path) || localisedRegex.test(path)) return pattern;
    }
    return path;
  };

  const record = (pattern: string, mode: Mode) => {
    // Worst mode wins: one dynamic variant of a pattern is the fact worth
    // knowing, not the seven prerendered ones beside it.
    const rank: Record<Mode, number> = { static: 0, partial: 1, dynamic: 2 };
    if (!modes[pattern] || rank[mode] > rank[modes[pattern]]) modes[pattern] = mode;
  };

  for (const [path, entry] of Object.entries(prerender.routes)) {
    if (path.startsWith("/_")) continue;
    const mode: Mode =
      entry.renderingMode === "PARTIALLY_STATIC" ? "partial" : "static";
    record(patternOf(path), mode);
  }

  const prerenderedPages = Object.keys(prerender.routes).filter(
    (path) => !path.startsWith("/_"),
  ).length;

  // Anything the app declares and the prerender manifest never mentions is
  // served on demand.
  for (const pattern of Object.values(appRoutes)) {
    if (!modes[pattern]) record(pattern, "dynamic");
  }

  const chunks = directoryBytes(join(NEXT, "static"), /\.js$/);

  return {
    modes,
    clientBundleBytes: chunks.total,
    largestChunkBytes: chunks.largest,
    prerenderedPages,
    dynamicRoutes: Object.keys(prerender.dynamicRoutes ?? {}).length,
  };
}

/* ---------------------------------------------------------- the comparison */

interface Finding {
  severity: "regression" | "note";
  message: string;
}

function compare(current: Report, baseline: Report, tolerance: number): Finding[] {
  const findings: Finding[] = [];

  const rank: Record<Mode, number> = { static: 0, partial: 1, dynamic: 2 };

  for (const [route, mode] of Object.entries(current.modes)) {
    const was = baseline.modes[route];
    if (!was) {
      findings.push({ severity: "note", message: `new route ${route} (${mode})` });
      continue;
    }
    if (rank[mode] > rank[was]) {
      findings.push({
        severity: "regression",
        message:
          `${route} moved from ${was} to ${mode}. It is no longer served ` +
          `from the CDN for free — check for a cookies(), headers() or ` +
          `searchParams read that moved up the tree.`,
      });
    }
    if (rank[mode] < rank[was]) {
      findings.push({
        severity: "note",
        message: `${route} improved from ${was} to ${mode} — update the baseline.`,
      });
    }
  }

  for (const route of Object.keys(baseline.modes)) {
    if (!(route in current.modes)) {
      findings.push({ severity: "note", message: `route ${route} is gone` });
    }
  }

  const grew = (now: number, before: number) => (now - before) / (before || 1);

  const bundleGrowth = grew(current.clientBundleBytes, baseline.clientBundleBytes);
  if (bundleGrowth > tolerance) {
    findings.push({
      severity: "regression",
      message:
        `the client bundle grew ${(bundleGrowth * 100).toFixed(1)}% ` +
        `(${kb(baseline.clientBundleBytes)} → ${kb(current.clientBundleBytes)}). ` +
        `An icon barrel import or a "use client" on a container is the usual ` +
        `cause; both multiply by the number of cards on a page.`,
    });
  }

  const chunkGrowth = grew(current.largestChunkBytes, baseline.largestChunkBytes);
  if (chunkGrowth > tolerance) {
    findings.push({
      severity: "regression",
      message:
        `the largest single chunk grew ${(chunkGrowth * 100).toFixed(1)}% ` +
        `(${kb(baseline.largestChunkBytes)} → ${kb(current.largestChunkBytes)}). ` +
        `That is what a cold visit blocks on.`,
    });
  }

  return findings;
}

/* ------------------------------------------------------------- the output */

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

function render(current: Report, baseline: Report | null, markdown: boolean): string {
  const rows: Array<[string, string, string]> = [
    [
      "Client bundle",
      kb(current.clientBundleBytes),
      baseline ? kb(baseline.clientBundleBytes) : "—",
    ],
    [
      "Largest chunk",
      kb(current.largestChunkBytes),
      baseline ? kb(baseline.largestChunkBytes) : "—",
    ],
    [
      "Prerendered pages",
      String(current.prerenderedPages),
      baseline ? String(baseline.prerenderedPages) : "—",
    ],
    [
      "Dynamic route patterns",
      String(current.dynamicRoutes),
      baseline ? String(baseline.dynamicRoutes) : "—",
    ],
  ];

  const byMode = { static: 0, partial: 0, dynamic: 0 };
  for (const mode of Object.values(current.modes)) byMode[mode]++;
  rows.push([
    "Routes (static / partial / dynamic)",
    `${byMode.static} / ${byMode.partial} / ${byMode.dynamic}`,
    baseline
      ? (() => {
          const was = { static: 0, partial: 0, dynamic: 0 };
          for (const mode of Object.values(baseline.modes)) was[mode]++;
          return `${was.static} / ${was.partial} / ${was.dynamic}`;
        })()
      : "—",
  ]);

  if (markdown) {
    return [
      "### Route report",
      "",
      "| | this build | baseline |",
      "|---|---:|---:|",
      ...rows.map(([label, now, before]) => `| ${label} | ${now} | ${before} |`),
    ].join("\n");
  }

  const width = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(
      ([label, now, before]) =>
        `  ${label.padEnd(width)}  ${now.padStart(10)}  ${before.padStart(10)}`,
    )
    .join("\n");
}

/* --------------------------------------------------------------- the main */

function main(): void {
  const options = parseArgs();
  const current = collect();

  if (options.json) {
    mkdirSync(dirname(join(ROOT, options.json)), { recursive: true });
    writeFileSync(join(ROOT, options.json), JSON.stringify(current, null, 2));
  }

  if (options.update) {
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Wrote ${relative(ROOT, BASELINE).split(sep).join("/")}`);
    console.log(render(current, null, options.markdown));
    return;
  }

  if (!existsSync(BASELINE)) {
    console.log(render(current, null, options.markdown));
    console.log(
      "\nNo baseline yet. Run `npx tsx scripts/route-report.ts --update` and " +
        "commit perf/route-baseline.json.",
    );
    return;
  }

  const baseline = readJson<Report>(BASELINE);
  const findings = compare(current, baseline, options.tolerance);

  console.log(render(current, baseline, options.markdown));

  const notes = findings.filter((finding) => finding.severity === "note");
  const regressions = findings.filter((finding) => finding.severity === "regression");

  if (notes.length) {
    console.log(options.markdown ? "\n**Notes**\n" : "\nNotes:");
    for (const note of notes) console.log(`  - ${note.message}`);
  }

  if (regressions.length) {
    console.log(options.markdown ? "\n**Regressions**\n" : "\nRegressions:");
    for (const regression of regressions) console.log(`  - ${regression.message}`);
    console.log(
      "\nIf the change is intended, run `npx tsx scripts/route-report.ts --update` " +
        "and commit the new baseline with an explanation.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nNo regression against the baseline.");
}

main();
