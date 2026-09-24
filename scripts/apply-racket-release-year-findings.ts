/** Apply a researched findings JSON file to the racket release-year review CSV. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodeCsv, readReview } from "./racket-release-years";

interface Finding {
  slug: string;
  release_year: number;
  source_url: string;
  notes: string;
}

const [findingsArg = "data/racket-release-year-findings.json", reviewArg = "data/racket-release-years.csv"] = process.argv.slice(2);
const findingsPath = resolve(findingsArg);
const reviewPath = resolve(reviewArg);
const findings = JSON.parse(readFileSync(findingsPath, "utf8")) as Finding[];
const review = readReview(readFileSync(reviewPath, "utf8"));
const bySlug = new Map(review.map(row => [row.slug, row]));
const seen = new Set<string>();
let applied = 0;
let unchanged = 0;

for (const finding of findings) {
  if (seen.has(finding.slug)) throw new Error(`Duplicate finding: ${finding.slug}`);
  seen.add(finding.slug);
  const row = bySlug.get(finding.slug);
  if (!row) throw new Error(`Unknown racket slug: ${finding.slug}`);
  if (!Number.isInteger(finding.release_year) || finding.release_year < 1900 || finding.release_year > new Date().getFullYear()) {
    throw new Error(`${finding.slug}: invalid release year ${finding.release_year}`);
  }
  if (!finding.source_url || !finding.notes) throw new Error(`${finding.slug}: missing evidence`);
  if (row.status === "verified") {
    const matches = row.release_year === String(finding.release_year)
      && row.source_url === finding.source_url
      && row.notes === finding.notes;
    if (!matches) throw new Error(`${finding.slug}: verified row conflicts with finding`);
    unchanged += 1;
    continue;
  }
  if (row.status !== "unreviewed") throw new Error(`${finding.slug}: expected unreviewed, found ${row.status}`);
  row.release_year = String(finding.release_year);
  row.status = "verified";
  row.source_url = finding.source_url;
  row.notes = finding.notes;
  applied += 1;
}

readReview(encodeCsv(review));
writeFileSync(reviewPath, encodeCsv(review), "utf8");
console.log(`Applied ${applied} verified findings to ${reviewPath}; ${unchanged} already matched`);
