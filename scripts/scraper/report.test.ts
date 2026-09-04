/**
 * The report is what a skipped shop costs us now, so the report is what gets
 * tested: which shop is named, what reason is printed next to it, and whether
 * the run as a whole is allowed to go red.
 *
 *   npm run test:scraper
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

import {
  annotateSkippedSites,
  renderConsoleSummary,
  renderRunSummary,
  runVerdict,
  siteReason,
  siteStatus,
  writeStepSummary,
} from "./report";
import type { ScraperResult, ScraperSource } from "./types";

const TOTALS = { offers: 5281, variants: 3265, rackets: 3010, colourwaysFilled: 12 };

function scraped(source: ScraperSource, itemsCount = 1200): ScraperResult {
  return {
    source,
    success: true,
    itemsCount,
    products: [],
    durationMs: 42_000,
    pagesFetched: 41,
  };
}

function failed(source: ScraperSource, error: string, extra: Partial<ScraperResult> = {}): ScraperResult {
  return {
    source,
    success: false,
    itemsCount: 0,
    products: [],
    error,
    durationMs: 9_000,
    ...extra,
  };
}

describe("siteStatus", () => {
  it("separates a shop that failed from one that answered with nothing", () => {
    assert.equal(siteStatus(scraped("vnb")), "scraped");
    assert.equal(siteStatus({ ...scraped("vnb"), itemsCount: 0 }), "empty");
    assert.equal(siteStatus(failed("hvshop", "HTTP 403")), "skipped");
  });
});

describe("siteReason", () => {
  it("names a timeout as a timeout, not as an error the shop reported", () => {
    const reason = siteReason(failed("fbshop", "Did not finish within its budget", { timedOut: true }));
    assert.match(reason, /^timed out — /);
  });

  it("says how much was read before a shop stopped, so partial work is visible", () => {
    const reason = siteReason(failed("vnb", "socket hang up", { itemsCount: 314 }));
    assert.match(reason, /314 rackets read before it stopped/);
  });

  it("falls back to a reason rather than printing undefined", () => {
    assert.equal(siteReason(failed("shopee", undefined as unknown as string)), "no reason given");
  });

  it("explains a walk that completed but matched nothing", () => {
    assert.match(siteReason({ ...scraped("vnb"), itemsCount: 0 }), /matched no rackets/);
  });
});

describe("runVerdict", () => {
  it("does not fail the run when one shop of four is skipped", () => {
    const verdict = runVerdict([
      scraped("vnb"),
      scraped("fbshop"),
      scraped("qvbadminton"),
      failed("hvshop", "Store API returned HTTP 403"),
    ]);
    assert.equal(verdict.failed, false);
    assert.equal(verdict.reason, null);
  });

  it("fails when every shop failed, because that is the run's fault", () => {
    const verdict = runVerdict([failed("vnb", "DNS"), failed("hvshop", "HTTP 403")]);
    assert.equal(verdict.failed, true);
    assert.match(String(verdict.reason), /Every source failed \(vnb, hvshop\)/);
  });

  it("fails when no source was selected at all", () => {
    const verdict = runVerdict([]);
    assert.equal(verdict.failed, true);
    assert.match(String(verdict.reason), /--site/);
  });

  it("passes a clean run", () => {
    assert.equal(runVerdict([scraped("vnb"), scraped("fbshop")]).failed, false);
  });

  it("still goes red on a single failure under --fail-on-site-error", () => {
    const results = [scraped("vnb"), failed("hvshop", "HTTP 403")];
    assert.equal(runVerdict(results, { strict: true }).failed, true);
    assert.equal(runVerdict(results, { strict: false }).failed, false);
  });

  it("treats a shop that answered with zero rackets as walked, not as failed", () => {
    // The verifier is what flags an empty walk; it is not grounds for failing
    // the run and skipping the sync for the shops that did return rackets.
    assert.equal(runVerdict([{ ...scraped("vnb"), itemsCount: 0 }]).failed, false);
  });
});

describe("renderRunSummary", () => {
  const results = [
    scraped("vnb", 1204),
    { ...scraped("fbshop", 812), notes: ["43 listings publish no price."] },
    failed("hvshop", "Store API returned HTTP 403 on page 1"),
  ];
  const markdown = renderRunSummary(results, TOTALS);

  it("counts the shops that were walked in the heading", () => {
    assert.match(markdown, /2 of 3 shops walked/);
  });

  it("gives every shop a row, skipped ones included", () => {
    for (const source of ["vnb", "fbshop", "hvshop"]) {
      assert.match(markdown, new RegExp(`\\| \`${source}\` \\|`));
    }
  });

  it("names the skipped shop and its reason below the table", () => {
    assert.match(markdown, /Skipped 1 shop\(s\):/);
    assert.match(markdown, /- `hvshop` — Store API returned HTTP 403 on page 1/);
  });

  it("says that a skipped shop keeps its offers", () => {
    assert.match(markdown, /nothing is retired for a seller this run did not manage to walk/);
  });

  it("reports the catalogue totals the run actually wrote", () => {
    assert.match(markdown, /5,281 offers · 3,265 variants · 3,010 racket models/);
  });

  it("says nothing about skipping when every shop answered", () => {
    const clean = renderRunSummary([scraped("vnb"), scraped("fbshop")], TOTALS);
    assert.doesNotMatch(clean, /Skipped/);
    assert.match(clean, /2 of 2 shops walked/);
  });

  it("keeps an error containing a pipe or a newline inside its own cell", () => {
    const nasty = renderRunSummary(
      [failed("vnb", "curl: (7)\nFailed | connect to host\n  after 3 tries")],
      TOTALS,
    );
    const row = nasty.split("\n").find((line) => line.startsWith("| `vnb`"));
    assert.ok(row, "expected a row for vnb");
    // One line, five columns, and the pipe inside the shop's own error escaped
    // so it reads as text rather than opening a sixth column.
    assert.match(row, /Failed \\\| connect/);
    // Five cells between six borders, and the reason flattened into the last.
    const columns = row.replace(/\\\|/g, "~").split("|");
    assert.equal(columns.length, 7, row);
    assert.match(columns[5], /curl: \(7\) Failed ~ connect to host after 3 tries/);
  });

  it("truncates an error long enough to break the table layout", () => {
    const long = renderRunSummary([failed("vnb", "x".repeat(500))], TOTALS);
    const row = long.split("\n").find((line) => line.startsWith("| `vnb`"))!;
    assert.ok(row.length < 300, `row was ${row.length} chars`);
    assert.match(row, /…/);
  });
});

describe("renderConsoleSummary", () => {
  it("prints one line per shop and a reason for the ones that did not answer", () => {
    const text = renderConsoleSummary([scraped("vnb", 1204), failed("hvshop", "HTTP 403")]);
    assert.match(text, /vnb\s+1204 products\s+✅ scraped/);
    assert.match(text, /hvshop\s+0 products\s+⏭️ skipped/);
    assert.match(text, /HTTP 403/);
  });
});

describe("writeStepSummary", () => {
  const dir = mkdtempSync(join(tmpdir(), "scrape-report-"));
  const original = process.env.GITHUB_STEP_SUMMARY;

  beforeEach(() => {
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  after(() => {
    if (original === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = original;
  });

  it("is a no-op off CI", () => {
    assert.equal(writeStepSummary("### nothing to file here"), false);
  });

  it("appends rather than replacing what an earlier step filed", () => {
    const file = join(dir, "summary.md");
    writeFileSync(file, "### an earlier step\n", "utf8");
    process.env.GITHUB_STEP_SUMMARY = file;

    assert.equal(writeStepSummary("### the scrape"), true);
    const contents = readFileSync(file, "utf8");
    assert.match(contents, /an earlier step/);
    assert.match(contents, /the scrape/);
  });

  it("survives an unwritable summary path instead of losing the run", () => {
    process.env.GITHUB_STEP_SUMMARY = join(dir, "no", "such", "directory", "summary.md");
    assert.equal(writeStepSummary("### the scrape"), false);
  });
});

describe("annotateSkippedSites", () => {
  const original = process.env.GITHUB_ACTIONS;

  after(() => {
    if (original === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = original;
  });

  it("emits nothing outside Actions", () => {
    delete process.env.GITHUB_ACTIONS;
    assert.deepEqual(annotateSkippedSites([failed("hvshop", "HTTP 403")]), []);
  });

  it("annotates one warning per skipped shop, and none for the healthy ones", () => {
    process.env.GITHUB_ACTIONS = "true";
    const lines = annotateSkippedSites([
      scraped("vnb"),
      failed("hvshop", "HTTP 403"),
      failed("fbshop", "socket hang up"),
    ]);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^::warning title=Shop skipped: hvshop::HTTP 403/);
    assert.match(lines[1], /fbshop/);
    // A single-line workflow command: a newline would end it early and print
    // the rest of the reason as plain log output.
    for (const line of lines) assert.ok(!line.includes("\n"));
  });
});
