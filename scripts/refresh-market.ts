/**
 * Recompute `racket_scores` and `deal_watch` from the catalogue.
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
 * `deal_watch` is the same arrangement for a different reason. A price drop is
 * "below its own recent median and still falling", and both halves of that are
 * measured over the last third of whatever the scraper has observed — a
 * definition that lives in `src/lib/price-window.ts`. Answering it per request
 * meant reading every price point there is: 3,3 MB across 35 paged round trips,
 * growing by ~3.265 rows every night, to render three rows on the homepage. The
 * whole table gets read exactly once here instead, on the schedule the data
 * actually moves on.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY: both tables are admin-write, and this is
 * a script rather than a person. Run it after `scrape:sync` (reviews, prices
 * and the catalogue all move) — see the `scrape:refresh` chain in package.json.
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./scraper/env";
import { courtScore } from "../src/lib/court-score";
import { POPULAR_BRAND_SLUGS } from "../src/lib/catalog-ranking";
import {
  DEAL_WINDOW_POINTS,
  isPriceDrop,
  variantPriceFromPoints,
} from "../src/lib/price-window";
import {
  mapPricePoint,
  mapRacket,
  mapReview,
  RACKET_SELECT,
} from "../src/lib/data/mappers";
import type { PricePoint, Racket, Review } from "../src/lib/types";

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

  await refreshDealWatch(supabase, rackets, options);

  console.log("Done.");
}

/* ----------------------------------------------------------- deal_watch */

/** One row as `deal_watch` stores it. */
interface DealRow {
  variant_id: string;
  racket_id: string;
  latest: number;
  delta_30: number;
  median_30: number;
  delta_90: number;
  recent_points: { d: string; p: number }[];
  computed_at: string;
}

async function refreshDealWatch(
  supabase: SupabaseClient,
  rackets: Racket[],
  options: Options,
): Promise<void> {
  console.log("Reading price history…");

  const pointRows = await selectAll((from, to) =>
    supabase
      .from("price_points")
      .select("*")
      // `observed_on` is what the series is ordered by and is not unique;
      // `id` breaks the ties so the page boundaries are stable. Paging an
      // order that is not total silently duplicates and drops rows.
      .order("observed_on")
      .order("id")
      .range(from, to),
  );

  const points: PricePoint[] = pointRows.map((row) => mapPricePoint(row as never));

  // Which racket each variant belongs to. `RACKET_SELECT` already brought the
  // variants along, so this needs no second read.
  const racketByVariant = new Map<string, string>();
  for (const racket of rackets)
    for (const variant of racket.variants) racketByVariant.set(variant.id, racket.id);

  // Group once rather than scanning the price table per variant — the same
  // shape the repository's index exists to avoid, and no cheaper here.
  const byVariant = new Map<string, PricePoint[]>();
  for (const point of points) {
    const list = byVariant.get(point.variantId);
    if (list) list.push(point);
    else byVariant.set(point.variantId, [point]);
  }
  // Supabase already ordered by `observed_on`, but `variantPriceFromPoints`
  // reads the last element as "latest" and cannot check.
  for (const series of byVariant.values())
    series.sort((a, b) => a.observedOn.localeCompare(b.observedOn));

  const computedAt = new Date().toISOString();
  const drops: DealRow[] = [];

  for (const [variantId, series] of byVariant) {
    const racketId = racketByVariant.get(variantId);
    // A price point for a variant that is no longer in the catalogue. The
    // foreign key would reject it, and it is not a deal anyone can buy.
    if (!racketId) continue;

    const price = variantPriceFromPoints(variantId, series);
    if (!price || !isPriceDrop(price)) continue;

    drops.push({
      variant_id: variantId,
      racket_id: racketId,
      latest: price.latest,
      delta_30: price.delta30,
      median_30: price.median30,
      delta_90: price.delta90,
      recent_points: price.points
        .slice(-DEAL_WINDOW_POINTS)
        .map((point) => ({ d: point.observedOn, p: point.price })),
      computed_at: computedAt,
    });
  }

  // Only the --verbose listing below reads this order. What a page sees is
  // decided by `deal_watch_delta_idx` at read time, which orders by the same
  // key — see `bySteepestDrop`, the one definition of "steepest first".
  drops.sort((a, b) => a.delta_30 - b.delta_30);

  console.log(
    `${points.length} price points · ${byVariant.size} variants with history · ` +
      `${drops.length} below their own median and still falling`,
  );

  if (options.verbose) {
    for (const row of drops.slice(0, 10))
      console.log(
        `  ${String(row.delta_30).padStart(9)}  ${row.variant_id}`,
      );
  }

  if (options.dryRun) {
    console.log("--dry-run: deal_watch not written.");
    return;
  }

  console.log(`Writing ${drops.length} rows to deal_watch…`);
  for (let i = 0; i < drops.length; i += CHUNK) {
    const chunk = drops.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("deal_watch")
      .upsert(chunk, { onConflict: "variant_id" });
    if (error) {
      console.error(`deal_watch upsert failed: ${error.message}`);
      if (/does not exist|schema cache/i.test(error.message)) {
        console.error(
          "Apply supabase/migrations/20260912000000_deal_watch.sql first " +
            "(npm run migrate).",
        );
      }
      process.exitCode = 1;
      return;
    }
    if (options.verbose)
      console.log(`  ${Math.min(i + CHUNK, drops.length)}/${drops.length}`);
  }

  // Yesterday's deals that stopped being deals. Every row written above
  // carries this run's timestamp, so anything older is a variant that no
  // longer qualifies — deleting by age needs no id list and therefore no
  // bound on how many there are.
  const { error: staleError } = await supabase
    .from("deal_watch")
    .delete()
    .lt("computed_at", computedAt);
  if (staleError) {
    console.error(`deal_watch cleanup failed: ${staleError.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
