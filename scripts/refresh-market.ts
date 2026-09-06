/**
 * Recompute `racket_scores` from the catalogue.
 *
 *   npx tsx scripts/refresh-market.ts              # write
 *   npx tsx scripts/refresh-market.ts --dry-run    # report, write nothing
 *   npx tsx scripts/refresh-market.ts --verbose
 *
 * Court Score is the one value the `racket_market` view cannot compute. The
 * formula is `src/lib/court-score.ts` — 50% deterministic spec profile, 50%
 * verified-review player score, weighted 3x/2x/1x by tier — and it is published
 * on /methodology as the thing that cannot be bought. Writing a second copy of
 * it in SQL would mean two definitions that can drift, and the one people can
 * read would not be the one that ranks the catalogue.
 *
 * So the score is computed here, in TypeScript, by importing that module, and
 * only the *result* is stored. A coefficient change still happens in one file;
 * this script is what carries it to the database.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY: `racket_scores` is admin-write, and this is
 * a script rather than a person. Run it after `scrape:sync` (reviews and the
 * catalogue both move) — see the `scrape:refresh` chain in package.json.
 */

import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./scraper/env";
import { courtScore } from "../src/lib/court-score";
import { POPULAR_BRAND_SLUGS } from "../src/lib/catalog-ranking";
import { mapRacket, mapReview, RACKET_SELECT } from "../src/lib/data/mappers";
import type { Racket, Review } from "../src/lib/types";

const PAGE = 1000;
const CHUNK = 500;

interface Options {
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(): Options {
  const flags = new Set(process.argv.slice(2));
  return {
    dryRun: flags.has("--dry-run"),
    verbose: flags.has("--verbose"),
  };
}

/** Same paging contract as the repository's `selectAll`: PostgREST truncates at
 *  `db-max-rows` and says nothing, and five of these tables are past it. */
async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function main() {
  loadEnv();
  const options = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
        "racket_scores is admin-write, and an anon key cannot write it.",
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("Reading catalogue…");
  const racketRows = await selectAll((from, to) =>
    supabase.from("rackets").select(RACKET_SELECT).order("id").range(from, to),
  );
  const reviewRows = await selectAll((from, to) =>
    supabase
      .from("reviews")
      .select("*")
      .eq("status", "published")
      .order("id")
      .range(from, to),
  );

  const rackets: Racket[] = racketRows.map((r) => mapRacket(r as never));
  const reviews: Review[] = reviewRows.map((r) => mapReview(r as never));

  // Group once. Scanning the review table per racket is the exact shape the
  // repository's index exists to avoid, and it would be no cheaper here.
  const reviewsByRacket = new Map<string, Review[]>();
  for (const review of reviews) {
    const list = reviewsByRacket.get(review.racketId);
    if (list) list.push(review);
    else reviewsByRacket.set(review.racketId, [review]);
  }

  const popularRank = new Map<string, number>(
    POPULAR_BRAND_SLUGS.map((slug) => [slug, 0]),
  );

  const rows = rackets.map((racket) => {
    const racketReviews = reviewsByRacket.get(racket.id) ?? [];
    const score = courtScore(racket, racketReviews);
    return {
      racket_id: racket.id,
      court_score: score.total,
      spec_score: score.specScore,
      review_count: racketReviews.length,
      popular_rank: popularRank.get(racket.brandSlug) ?? 1,
      computed_at: new Date().toISOString(),
    };
  });

  const scored = rows.filter((r) => r.court_score !== null).length;
  console.log(
    `${rackets.length} rackets · ${reviews.length} published reviews · ` +
      `${scored} with a Court Score, ${rackets.length - scored} spec profile only`,
  );

  if (options.verbose) {
    const top = [...rows]
      .filter((r) => r.court_score !== null)
      .sort((a, b) => (b.court_score ?? 0) - (a.court_score ?? 0))
      .slice(0, 10);
    for (const row of top)
      console.log(`  ${String(row.court_score).padStart(3)}  ${row.racket_id}`);
  }

  if (options.dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  console.log(`Writing ${rows.length} rows to racket_scores…`);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("racket_scores")
      .upsert(chunk, { onConflict: "racket_id" });
    if (error) {
      // A missing table means the migration has not been applied. That is a
      // real failure for this script, but not for the app: the repository
      // falls back to the snapshot when the view is absent.
      console.error(`racket_scores upsert failed: ${error.message}`);
      if (/does not exist|schema cache/i.test(error.message)) {
        console.error(
          "Apply supabase/migrations/20260906000000_catalogue_pagination.sql first " +
            "(npm run migrate).",
        );
      }
      process.exitCode = 1;
      return;
    }
    if (options.verbose)
      console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
