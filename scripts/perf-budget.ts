/**
 * Turn a benchmark run into a verdict.
 *
 *   npm run benchmark -- --json=perf/latest.json
 *   npx tsx scripts/perf-budget.ts --run=perf/latest.json
 *   npx tsx scripts/perf-budget.ts --run=perf/latest.json --update   # new baseline
 *   npx tsx scripts/perf-budget.ts --run=perf/latest.json --markdown
 *
 * `scripts/benchmark.ts` measures beautifully and asserts nothing: it prints a
 * table into a log, and whether the number is better or worse than last week
 * is left to whoever remembers last week. This is the missing half.
 *
 * Two rules the repo's own notes insist on, and which a naive comparison gets
 * wrong:
 *
 * **Subtract the round trip before comparing an SQL row.** `baseline:round trip`
 * is the latency to the database region, and from a laptop it is most of every
 * `sql` number. Comparing raw totals across two machines measures where the
 * developer is sitting, not what the query costs.
 *
 * **Budget per scenario group, not per scenario.** Individual scenarios move
 * with the data; a group moving is a change in how the app reads. `catalogue:`
 * is the group with the ~9.3 s → ~5 ms history, and the one worth a ceiling
 * that does not move.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const BASELINE = join(ROOT, "perf", "benchmark-baseline.json");

/** The scenario that measures the network rather than the database. */
const ROUND_TRIP = "baseline:round trip";

/* ------------------------------------------------------------ the shapes */

type Layer = "sql" | "postgrest" | "js";

interface Result {
  name: string;
  layer: Layer;
  variant: "today" | "proposed" | "n/a";
  ms: number[];
  rows: number;
  bytes: number;
  note?: string;
  skipped?: string;
}

interface Run {
  at: string;
  results: Result[];
}

/** One group's cost, with the network taken out of the SQL half. */
interface GroupSummary {
  /** Median of medians across the group's `today` scenarios, in ms. */
  ms: number;
  /** Bytes the group moves. */
  bytes: number;
  scenarios: number;
}

type Summary = Record<string, GroupSummary>;

interface Baseline {
  at: string;
  roundTripMs: number;
  groups: Summary;
}

/* ------------------------------------------------------------- the options */

interface Options {
  run: string;
  update: boolean;
  markdown: boolean;
  /** Fractional growth tolerated before a group is a regression. */
  tolerance: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const run = value("run");
  if (!run) {
    console.error(
      "Usage: npx tsx scripts/perf-budget.ts --run=<benchmark --json output>\n" +
        "Produce one with: npm run benchmark -- --json=perf/latest.json",
    );
    process.exit(2);
  }

  return {
    run,
    update: args.includes("--update"),
    markdown: args.includes("--markdown"),
    // Generous on purpose. A CI runner's variance is real, and a budget that
    // cries wolf is a budget somebody deletes.
    tolerance: Number(value("tolerance") ?? "0.35"),
  };
}

/* ----------------------------------------------------------- the reduction */

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const groupOf = (name: string): string => name.split(":")[0];

function roundTripOf(results: Result[]): number {
  const row = results.find((result) => result.name === ROUND_TRIP && !result.skipped);
  return row ? median(row.ms) : 0;
}

/**
 * Summarise a run, with the round trip removed from every `sql` measurement.
 *
 * `postgrest` keeps its round trip: the gap between it and `sql` is transport
 * and JSON shaping, and removing the same constant from both would hide the
 * one number that gap exists to show. `js` never had one.
 */
function summarise(run: Run): { summary: Summary; roundTripMs: number } {
  const roundTripMs = roundTripOf(run.results);
  const groups: Record<string, { ms: number[]; bytes: number; scenarios: number }> = {};

  for (const result of run.results) {
    if (result.skipped) continue;
    if (result.name === ROUND_TRIP) continue;
    // `proposed` rows exist to argue for a change, not to describe today.
    if (result.variant === "proposed") continue;

    const group = groupOf(result.name);
    groups[group] ??= { ms: [], bytes: 0, scenarios: 0 };

    const raw = median(result.ms);
    const adjusted =
      result.layer === "sql" ? Math.max(0, raw - roundTripMs) : raw;

    groups[group].ms.push(adjusted);
    groups[group].bytes += result.bytes;
    groups[group].scenarios += 1;
  }

  const summary: Summary = {};
  for (const [name, group] of Object.entries(groups)) {
    summary[name] = {
      ms: Math.round(median(group.ms) * 100) / 100,
      bytes: group.bytes,
      scenarios: group.scenarios,
    };
  }

  return { summary, roundTripMs };
}

/* ---------------------------------------------------------- the comparison */

interface Finding {
  severity: "regression" | "note";
  message: string;
}

function compare(
  current: Summary,
  baseline: Baseline,
  tolerance: number,
): Finding[] {
  const findings: Finding[] = [];

  for (const [name, group] of Object.entries(current)) {
    const was = baseline.groups[name];
    if (!was) {
      findings.push({
        severity: "note",
        message: `new scenario group "${name}" (${group.ms} ms, ${kb(group.bytes)})`,
      });
      continue;
    }

    const growth = (group.ms - was.ms) / (was.ms || 1);
    if (growth > tolerance) {
      findings.push({
        severity: "regression",
        message:
          `${name} takes ${group.ms} ms, up from ${was.ms} ms ` +
          `(+${(growth * 100).toFixed(0)}%). Round-trip latency is already ` +
          `subtracted from the SQL half, so this is the query and the shaping.`,
      });
    }

    const byteGrowth = (group.bytes - was.bytes) / (was.bytes || 1);
    if (byteGrowth > tolerance) {
      findings.push({
        severity: "regression",
        message:
          `${name} moves ${kb(group.bytes)}, up from ${kb(was.bytes)} ` +
          `(+${(byteGrowth * 100).toFixed(0)}%). A read that fetches the ` +
          `table rather than the rows a page needs is what this looks like.`,
      });
    }

    if (growth < -tolerance) {
      findings.push({
        severity: "note",
        message: `${name} improved to ${group.ms} ms from ${was.ms} ms — update the baseline.`,
      });
    }
  }

  for (const name of Object.keys(baseline.groups)) {
    if (!(name in current)) {
      findings.push({
        severity: "note",
        message: `scenario group "${name}" was not measured in this run`,
      });
    }
  }

  return findings;
}

/* -------------------------------------------------------------- the output */

const kb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;

function render(
  current: Summary,
  baseline: Baseline | null,
  roundTripMs: number,
  markdown: boolean,
): string {
  const names = [...new Set([...Object.keys(current), ...Object.keys(baseline?.groups ?? {})])].sort();

  const rows = names.map((name) => {
    const now = current[name];
    const was = baseline?.groups[name];
    return [
      name,
      now ? `${now.ms} ms` : "—",
      was ? `${was.ms} ms` : "—",
      now ? kb(now.bytes) : "—",
      was ? kb(was.bytes) : "—",
    ];
  });

  if (markdown) {
    return [
      "### Benchmark budget",
      "",
      `Round trip to the database region: **${roundTripMs.toFixed(1)} ms**, ` +
        `subtracted from every \`sql\` measurement below.`,
      "",
      "| group | now | baseline | bytes now | bytes baseline |",
      "|---|---:|---:|---:|---:|",
      ...rows.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
  }

  const width = Math.max(...names.map((name) => name.length), 8);
  return [
    `  round trip: ${roundTripMs.toFixed(1)} ms (subtracted from every sql row)`,
    "",
    ...rows.map(
      ([name, now, was, bytesNow, bytesWas]) =>
        `  ${name.padEnd(width)}  ${now.padStart(10)}  ${was.padStart(10)}  ` +
        `${bytesNow.padStart(9)}  ${bytesWas.padStart(9)}`,
    ),
  ].join("\n");
}

/* ---------------------------------------------------------------- the main */

function main(): void {
  const options = parseArgs();

  const runPath = join(ROOT, options.run);
  if (!existsSync(runPath)) {
    console.error(
      `${options.run} does not exist. Produce it with:\n` +
        `  npm run benchmark -- --json=${options.run}`,
    );
    process.exit(2);
  }

  const run = JSON.parse(readFileSync(runPath, "utf8")) as Run;
  const { summary, roundTripMs } = summarise(run);

  if (Object.keys(summary).length === 0) {
    console.error(
      "The run measured nothing. Every scenario was skipped, which usually " +
        "means the benchmark had no database to talk to.",
    );
    process.exit(2);
  }

  if (options.update) {
    const baseline: Baseline = { at: run.at, roundTripMs, groups: summary };
    mkdirSync(dirname(BASELINE), { recursive: true });
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log("Wrote perf/benchmark-baseline.json");
    console.log(render(summary, null, roundTripMs, options.markdown));
    return;
  }

  if (!existsSync(BASELINE)) {
    console.log(render(summary, null, roundTripMs, options.markdown));
    console.log(
      "\nNo baseline yet. Run this with --update and commit " +
        "perf/benchmark-baseline.json.",
    );
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  const findings = compare(summary, baseline, options.tolerance);

  console.log(render(summary, baseline, roundTripMs, options.markdown));

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
      `\nTolerance is ${(options.tolerance * 100).toFixed(0)}%. If the change ` +
        `is intended, rerun with --update and commit the new baseline with an ` +
        `explanation of what got slower and why that is acceptable.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nNo regression against the baseline.");
}

main();
