/**
 * What a run says about itself when nobody is watching it.
 *
 * The scrape walks four independent shops. Any one of them can be down, behind
 * a new WAF rule, or mid-theme-change on any given night, and for a long time
 * that meant the whole nightly job went red: the run exited non-zero, so the
 * image crawl, the ownership audit and the backup that followed it never ran,
 * and three healthy shops went unsynced because a fourth had a bad day.
 *
 * So a shop that fails is now a *line in the report* rather than a failed run.
 * That trade only holds if the report is impossible to miss, which is what this
 * module is for: a per-shop status table, a named list of what was skipped and
 * why, GitHub annotations that surface on the run itself, and one honest
 * verdict for the exit code.
 *
 * The renderers are pure so the shape of the report is testable without a
 * network, a browser or a database — see `report.test.ts`.
 */

import { appendFileSync } from "node:fs";

import type { ScraperResult } from "./types";

export interface RunTotals {
  offers: number;
  variants: number;
  rackets: number;
  colourwaysFilled: number;
}

/**
 * `skipped` is deliberately not called `failed`: from the catalogue's point of
 * view a shop that did not answer is one whose offers keep whatever they last
 * published, which is the same thing as not having been asked.
 */
export type SiteStatus = "scraped" | "empty" | "skipped";

const STATUS_LABEL: Record<SiteStatus, string> = {
  scraped: "✅ scraped",
  empty: "⚠️ no rackets",
  skipped: "⏭️ skipped",
};

export function siteStatus(result: ScraperResult): SiteStatus {
  if (!result.success) return "skipped";
  return result.itemsCount > 0 ? "scraped" : "empty";
}

/** Everything the shop reported that is worth a line next to its row. */
export function siteReason(result: ScraperResult): string {
  if (!result.success) {
    const prefix = result.timedOut ? "timed out — " : "";
    const partial =
      result.itemsCount > 0 ? ` (${result.itemsCount} rackets read before it stopped)` : "";
    return `${prefix}${result.error ?? "no reason given"}${partial}`;
  }
  if (result.itemsCount === 0) return "the walk completed but matched no rackets";
  return (result.notes ?? []).join(" ");
}

export interface RunVerdict {
  failed: boolean;
  reason: string | null;
}

/**
 * The one place that decides whether the *run* failed, as opposed to a shop.
 *
 * A run fails when it produced nothing usable — no sources selected, or every
 * source down — because that is a fault in the run rather than in one shop, and
 * because the steps downstream have nothing to work with either way. A run that
 * walked at least one shop succeeded, and says which ones it skipped.
 *
 * `strict` restores the old all-or-nothing behaviour for anyone who wants a
 * scheduled run to go red the moment a shop stops answering.
 */
export function runVerdict(
  results: ScraperResult[],
  options: { strict?: boolean } = {},
): RunVerdict {
  if (results.length === 0) {
    return { failed: true, reason: "No sources were selected — check the --site flag." };
  }

  const skipped = results.filter((r) => siteStatus(r) === "skipped");
  if (skipped.length === 0) return { failed: false, reason: null };

  const names = skipped.map((r) => r.source).join(", ");

  if (skipped.length === results.length) {
    return {
      failed: true,
      reason: `Every source failed (${names}) — nothing was scraped, so this is the run's fault, not a shop's.`,
    };
  }

  if (options.strict) {
    return {
      failed: true,
      reason: `${skipped.length} of ${results.length} sources failed (${names}) and --fail-on-site-error is set.`,
    };
  }

  return { failed: false, reason: null };
}

/** One table cell: no pipes, no newlines, no essays. */
function cell(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const int = (value: number) => value.toLocaleString("en-US");

/**
 * The markdown GitHub renders on the run's own page. Written even when every
 * shop succeeded — a report that only appears on bad nights is a report nobody
 * knows how to read on a bad night.
 */
export function renderRunSummary(results: ScraperResult[], totals: RunTotals): string {
  const walked = results.filter((r) => siteStatus(r) !== "skipped");
  const skipped = results.filter((r) => siteStatus(r) === "skipped");

  const lines: string[] = [];
  lines.push(`### Multi-site scrape — ${walked.length} of ${results.length} shops walked`);
  lines.push("");
  lines.push("| Shop | Status | Rackets | Pages | Detail |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const result of results) {
    const seconds = `${(result.durationMs / 1000).toFixed(0)}s`;
    lines.push(
      `| \`${result.source}\` | ${STATUS_LABEL[siteStatus(result)]} | ` +
        `${int(result.itemsCount)} | ${result.pagesFetched ?? "—"} (${seconds}) | ` +
        `${cell(siteReason(result)) || "—"} |`,
    );
  }

  lines.push("");
  lines.push(
    `**Catalogue written:** ${int(totals.offers)} offers · ${int(totals.variants)} variants · ` +
      `${int(totals.rackets)} racket models`,
  );

  if (skipped.length > 0) {
    lines.push("");
    lines.push(`**Skipped ${skipped.length} shop(s):** ${skipped.map((r) => `\`${r.source}\``).join(", ")}`);
    lines.push("");
    for (const result of skipped) {
      lines.push(`- \`${result.source}\` — ${cell(siteReason(result))}`);
    }
    lines.push("");
    lines.push(
      "A skipped shop keeps the offers it last published: nothing is retired for a seller " +
        "this run did not manage to walk. The rest of the pipeline ran normally.",
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Append the summary to the file GitHub renders on the run page. A no-op off
 * CI, and never fatal — a report that cannot be filed is not a reason to lose
 * a scrape that already succeeded.
 */
export function writeStepSummary(markdown: string): boolean {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return false;
  try {
    appendFileSync(target, `${markdown}\n`, "utf8");
    return true;
  } catch (err) {
    console.warn(
      `⚠️  Could not write the step summary: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * GitHub's workflow-command annotations, so a skipped shop is visible on the
 * run without opening the log. Returns the lines it emitted for tests; emits
 * nothing outside Actions, where the console report is already the report.
 */
export function annotateSkippedSites(results: ScraperResult[]): string[] {
  if (!process.env.GITHUB_ACTIONS) return [];

  const lines = results
    .filter((r) => siteStatus(r) === "skipped")
    .map(
      (r) =>
        `::warning title=Shop skipped: ${r.source}::${cell(siteReason(r), 400)} ` +
        `— the other shops were scraped and synced.`,
    );

  for (const line of lines) console.log(line);
  return lines;
}

/** The per-shop table the console prints, in the same order as the markdown. */
export function renderConsoleSummary(results: ScraperResult[]): string {
  return results
    .map((result) => {
      const status = siteStatus(result);
      const reason = siteReason(result);
      return (
        `  ${result.source.padEnd(12)} ${String(result.itemsCount).padStart(5)} products   ` +
        `${STATUS_LABEL[status]}` +
        (status === "scraped" && !reason ? "" : `\n  ${"".padEnd(12)}       ${reason}`)
      );
    })
    .join("\n");
}
