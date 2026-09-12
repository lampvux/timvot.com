/**
 * Check the live catalogue against the font subsets the app loads.
 *
 * `src/lib/font-subsets.test.ts` runs this check over the message files and
 * the seed, which is eighteen rackets. Production is three thousand, and the
 * names come from Vietnamese retailers and manufacturer pages rather than from
 * this repository — so the subset decision has to be verified against what the
 * scraper actually wrote, not against what was committed.
 *
 *   npx tsx scripts/audit-font-glyphs.ts
 *
 * Read-only. Needs NEXT_PUBLIC_SUPABASE_URL and an anon/publishable key.
 */

import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./scraper/env";
import { LATIN_EXT, isCovered, uncoveredCodepoints } from "../src/lib/font-subsets";

const PAGE = 1000;

/** Every column whose text reaches a rendered page. */
const TEXT_COLUMNS: { table: string; columns: string[] }[] = [
  { table: "brands", columns: ["name", "country"] },
  { table: "rackets", columns: ["name", "summary_en", "summary_vi"] },
  { table: "sellers", columns: ["name", "city", "about_en", "about_vi"] },
  { table: "guides", columns: ["title_en", "title_vi", "excerpt_en", "excerpt_vi"] },
  { table: "racket_variants", columns: ["colourway"] },
  { table: "strings", columns: ["name"] },
];

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Needs NEXT_PUBLIC_SUPABASE_URL and a publishable/anon key.");
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // codepoint -> a sample of where it was found
  const missing = new Map<number, { table: string; sample: string }>();
  let scanned = 0;

  for (const { table, columns } of TEXT_COLUMNS) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(columns.join(","))
        .range(from, from + PAGE - 1);

      if (error) {
        console.warn(`  ${table}: skipped (${error.message})`);
        break;
      }
      if (!data || data.length === 0) break;

      for (const row of data as unknown as Record<string, string | null>[]) {
        for (const column of columns) {
          const value = row[column];
          if (!value) continue;
          scanned += value.length;
          for (const codepoint of uncoveredCodepoints(value)) {
            if (!missing.has(codepoint))
              missing.set(codepoint, { table: `${table}.${column}`, sample: value });
          }
        }
      }

      if (data.length < PAGE) break;
    }
    console.log(`  ${table}: scanned`);
  }

  console.log(`\n${scanned.toLocaleString()} characters checked.`);

  if (missing.size === 0) {
    console.log(
      "Every glyph in the live catalogue is covered by the latin + vietnamese " +
        "subsets. Dropping latin-ext is safe.",
    );
    return;
  }

  // Two different problems wear the same symptom. A codepoint `latin-ext`
  // would have covered is a font decision to reverse. One it would not have
  // covered renders as a box today and did before this change too — no subset
  // fixes it, and reloading one would only hide the question.
  const report = (
    label: string,
    rows: [number, { table: string; sample: string }][],
  ) => {
    console.error(`\n${label}\n`);
    for (const [codepoint, where] of rows) {
      const hex = codepoint.toString(16).toUpperCase().padStart(4, "0");
      console.error(
        `  U+${hex}  ${String.fromCodePoint(codepoint)}  ${where.table}\n` +
          `           in: ${where.sample.slice(0, 80)}`,
      );
    }
  };

  const reversible = [...missing].filter(([c]) => isCovered(c, LATIN_EXT));
  const preexisting = [...missing].filter(([c]) => !isCovered(c, LATIN_EXT));

  if (reversible.length > 0) {
    report(
      `${reversible.length} codepoint(s) latin-ext would cover — dropping it was not safe:`,
      reversible,
    );
    console.error(
      "\nPut latin-ext back in src/app/fonts.ts and src/lib/font-subsets.ts.",
    );
    process.exitCode = 1;
  }

  if (preexisting.length > 0) {
    report(
      `${preexisting.length} codepoint(s) outside every Latin subset — already rendering as boxes:`,
      preexisting,
    );
    console.error(
      "\nNo font subset fixes these; they were never covered by one. This is " +
        "scraped text to correct at the source — see `titleNoise` and " +
        "`titleTransform` in the provider that wrote it.",
    );
  }

  if (reversible.length === 0) {
    console.log("\nNothing here is fixed by latin-ext, so dropping it is safe.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
