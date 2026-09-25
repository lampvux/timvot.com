import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStaticClient } from "@/lib/supabase/server";
import { EVEN_BAND_MAX_MM, EVEN_BAND_MIN_MM } from "@/lib/types";
import type {
  BalanceType,
  CatalogFilters,
  CatalogRacket,
  ShaftFlex,
  SortKey,
  WeightClass,
} from "@/lib/types";
import { mapRacket } from "./mappers";
import { RACKET_SELECT, RACKET_SELECT_NO_THUMBS, isMissingColumnError } from "./mappers";
import { TAG } from "./tags";

/**
 * The catalogue page, fetched as a page.
 *
 * The listing used to be paginated in the browser's sense of the word: read
 * every table in full, enrich 3.076 rackets, filter the array, and slice 24
 * items out of the result. Against production that measured ~9.3 seconds and
 * 7.4 MB on the wire to render 24 cards (`npx tsx scripts/benchmark.ts`), and
 * the price table it drags along grows by ~3.265 rows every time the scraper
 * runs — so the cost went up on the scraper's schedule.
 *
 * This module asks Postgres the question instead. `racket_market` (see
 * `supabase/migrations/20260906000000_catalogue_pagination.sql`) resolves every
 * filter and sort key into columns, so one request carries the predicates, the
 * ordering, the offset and `count: 'exact'`, and comes back with 24 ids and a
 * total. A second request hydrates those 24 rackets. Both are bounded by the
 * page size rather than by the catalogue.
 *
 * It stays behind the repository's single read path: `getCatalogPage` returns
 * the same `CatalogRacket` shape either route produces, and falls
 * back to the in-memory route whenever the view cannot answer — an unprovisioned
 * project, a database still behind this migration, or any query error. A page
 * is never empty because the schema is out of date.
 */

export interface CatalogFacets {
  brands: Record<string, number>;
  weightClasses: Record<string, number>;
  balanceTypes: Record<string, number>;
  flexes: Record<string, number>;
}

export interface CatalogPage {
  rackets: CatalogRacket[];
  /** Every match, not this page's length — the heading and the pager need it. */
  total: number;
  page: number;
  facets: CatalogFacets;
  /** Which route answered. Surfaced so the benchmark and a debug view can tell
   *  a fast path from a fallback without guessing from the timing. */
  source: "view" | "snapshot" | "seed";
}

/** The columns the view exposes, as PostgREST returns them. */
interface MarketRow {
  id: string;
  brand_slug: string;
  shaft_flex: ShaftFlex;
  balance_type: BalanceType;
  weight_classes: string[] | null;
  effective_price: number;
  lowest_price: number | null;
  seller_count: number;
  court_score: number | null;
  spec_score: number;
  review_count: number;
  popular_rank: number;
}

/** Just the four facet columns, for the counts. */
type FacetRow = Pick<
  MarketRow,
  "brand_slug" | "shaft_flex" | "balance_type" | "weight_classes"
>;

const FACET_COLUMNS = "brand_slug,shaft_flex,balance_type,weight_classes";

const MARKET_COLUMNS =
  "id,brand_slug,shaft_flex,balance_type,weight_classes,effective_price," +
  "lowest_price,seller_count,court_score,spec_score,review_count,popular_rank";

/**
 * The SQL in the view restates `balanceTypeOf`'s bands as literals, because a
 * view cannot call a TypeScript function. This is the guard that keeps the two
 * from drifting: change the constants in `types.ts` and this throws in
 * development until the migration is updated to match.
 */
function assertBalanceBands(): void {
  if (EVEN_BAND_MIN_MM !== 285 || EVEN_BAND_MAX_MM !== 295) {
    throw new Error(
      `The even-balance band moved to ${EVEN_BAND_MIN_MM}–${EVEN_BAND_MAX_MM} mm, but ` +
        "racket_market still hardcodes 285–295. Update the CASE in " +
        "supabase/migrations/20260906000000_catalogue_pagination.sql and add a " +
        "migration, or the catalogue's balance filter will disagree with its badges.",
    );
  }
}

/* ---------------------------------------------------------------- query */

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

/**
 * Apply every predicate the URL carries.
 *
 * `skip` drops one facet's own filter, which is what a facet count needs: the
 * number beside "Yonex" is how many results choosing Yonex *would* give, so it
 * is computed with the brand filter removed and every other filter applied.
 */
function applyPredicates(
  query: Query,
  filters: CatalogFilters,
  skip?: keyof CatalogFacets,
): Query {
  let q = query;

  if (skip !== "brands" && filters.brands.length)
    q = q.in("brand_slug", filters.brands);

  if (skip !== "flexes" && filters.flexes.length)
    q = q.in("shaft_flex", filters.flexes);

  if (skip !== "balanceTypes" && filters.balanceTypes.length)
    q = q.in("balance_type", filters.balanceTypes);

  // A racket matches a weight facet when any of its variants does, which is an
  // array overlap rather than containment — `overlaps`, not `contains`.
  if (skip !== "weightClasses" && filters.weightClasses.length)
    q = q.overlaps("weight_classes", filters.weightClasses);

  if (filters.priceMin !== null) q = q.gte("effective_price", filters.priceMin);
  if (filters.priceMax !== null) q = q.lte("effective_price", filters.priceMax);

  const query_ = filters.query.trim().toLowerCase();
  if (query_) {
    // `search_text` is `lower(brand || ' ' || model)`, so this is the same
    // match the in-memory path made, served by a trigram index.
    q = q.like("search_text", `%${escapeLike(query_)}%`);
  }

  return q;
}

/** PostgREST passes `%` and `_` straight into LIKE, so a query containing
 *  either would otherwise match far more than the visitor typed. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Ordering, as columns.
 *
 * Every sort ends on `id` so the order is total. Without it Postgres makes no
 * promise about ties between two statements, and a racket can appear on two
 * pages or on none — the same class of bug as paging an unordered result.
 */
function applySort(query: Query, sort: SortKey): Query {
  const byScore = (q: Query) =>
    q
      .order("court_score", { ascending: false, nullsFirst: false })
      .order("spec_score", { ascending: false });

  switch (sort) {
    case "power":
    case "speed":
    case "control":
    case "comfort":
      // Null until `refresh-market` has filled the axis columns, and null sorts
      // last — the ranking degrades to Court Score order, not to an error.
      return byScore(
        query.order(`spec_${sort}`, { ascending: false, nullsFirst: false }),
      ).order("id");
    case "popular":
      return byScore(query.order("popular_rank", { ascending: true })).order("id");
    case "price-asc":
      return query.order("effective_price", { ascending: true }).order("id");
    case "price-desc":
      return query.order("effective_price", { ascending: false }).order("id");
    case "new":
      return byScore(query.order("release_year", { ascending: false })).order("id");
    default:
      return byScore(query).order("id");
  }
}

/* ------------------------------------------------------------- hydration */

/**
 * Fetch the full rows for one page of ids, in the order the view returned them.
 *
 * Same missing-column retry as `readRackets`: a deployment ahead of the
 * thumbnail migration must degrade to "no thumbnails", never to "no cards".
 */
async function hydrate(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, ReturnType<typeof mapRacket>>> {
  const read = (select: string) =>
    supabase.from("rackets").select(select).in("id", ids);

  let { data, error } = await read(RACKET_SELECT);
  if (error && isMissingColumnError(error.message)) {
    ({ data, error } = await read(RACKET_SELECT_NO_THUMBS));
  }
  if (error) throw new Error(error.message);

  const byId = new Map<string, ReturnType<typeof mapRacket>>();
  for (const row of data ?? []) {
    const racket = mapRacket(row as never);
    byId.set(racket.id, racket);
  }
  return byId;
}

/* ---------------------------------------------------------------- facets */

/**
 * Facet counts, from one narrow read rather than four wide ones.
 *
 * The rows fetched here carry four short columns and no variants, offers,
 * images or price history — an unfiltered catalogue is roughly 150 KB against
 * the snapshot's 7.4 MB. The cross-filtering (each facet counted with its own
 * filter removed) then happens over those rows, which is the same arithmetic
 * the in-memory path did and is not what made it slow.
 *
 * Cached on the facet-independent part of the filter set, because that is all
 * it depends on: two visitors narrowing different facets of the same price
 * range share this read.
 */
export async function readCatalogFacets(
  filters: CatalogFilters,
): Promise<CatalogFacets | null> {
  "use cache";
  // Its own cached scope, and deliberately not keyed on the page number: the
  // counts beside the checkboxes are identical on page 1 and page 40, so
  // paging through a filtered catalogue reuses one entry instead of storing
  // and recomputing the same four tallies per page.
  cacheLife("prices");
  cacheTag(TAG.rackets, TAG.offers);

  const supabase = createStaticClient();
  if (!supabase) return null;

  try {
    return await readFacets(supabase, filters);
  } catch {
    return null;
  }
}

async function readFacets(
  supabase: SupabaseClient,
  filters: CatalogFilters,
): Promise<CatalogFacets> {
  let query = supabase.from("racket_market").select(FACET_COLUMNS);

  // Price and text narrow the candidate set for every facet, so they apply
  // here. The four facet filters are applied per facet, below.
  if (filters.priceMin !== null) query = query.gte("effective_price", filters.priceMin);
  if (filters.priceMax !== null) query = query.lte("effective_price", filters.priceMax);
  const text = filters.query.trim().toLowerCase();
  if (text) query = query.like("search_text", `%${escapeLike(text)}%`);

  // The view has one row per racket, so this is capped by the catalogue and
  // still has to get past `db-max-rows`.
  const rows: FacetRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as FacetRow[]));
    if (data.length < PAGE) break;
  }

  const matches = (row: FacetRow, skip: keyof CatalogFacets): boolean => {
    if (skip !== "brands" && filters.brands.length && !filters.brands.includes(row.brand_slug))
      return false;
    if (skip !== "flexes" && filters.flexes.length && !filters.flexes.includes(row.shaft_flex))
      return false;
    if (
      skip !== "balanceTypes" &&
      filters.balanceTypes.length &&
      !filters.balanceTypes.includes(row.balance_type)
    )
      return false;
    if (
      skip !== "weightClasses" &&
      filters.weightClasses.length &&
      !(row.weight_classes ?? []).some((w) =>
        filters.weightClasses.includes(w as WeightClass),
      )
    )
      return false;
    return true;
  };

  const tally = (
    skip: keyof CatalogFacets,
    read: (row: FacetRow) => string[],
  ): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (!matches(row, skip)) continue;
      for (const value of new Set(read(row)))
        counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  };

  return {
    brands: tally("brands", (r) => [r.brand_slug]),
    weightClasses: tally("weightClasses", (r) => r.weight_classes ?? []),
    balanceTypes: tally("balanceTypes", (r) => [r.balance_type]),
    flexes: tally("flexes", (r) => [r.shaft_flex]),
  };
}

/**
 * How many rackets a filter set would match, without fetching any of them.
 *
 * This is what keeps the empty state actionable — "Removing 'extra stiff'
 * gives 12 results" needs the 12. `head: true` asks PostgREST for the count
 * and no rows at all, so each candidate costs one small round trip, and only
 * on a page that already has nothing to show.
 */
export async function countCatalogMatchesInView(
  filters: CatalogFilters,
): Promise<number | null> {
  "use cache";
  cacheLife("prices");
  cacheTag(TAG.rackets, TAG.offers);

  const supabase = createStaticClient();
  if (!supabase) return null;

  try {
    const { count, error } = await applyPredicates(
      supabase
        .from("racket_market")
        .select("id", { count: "exact", head: true }),
      filters,
    );
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ read */

/**
 * One page from the view, or null when the view cannot answer.
 *
 * Null is not an error path — it is the signal to use the snapshot, which is
 * what makes this migration optional. Anything unexpected (no project, no
 * migration, a renamed column) lands here and the caller falls back.
 */
export async function readCatalogPageFromView(
  filters: CatalogFilters,
  page: number,
  pageSize: number,
): Promise<Omit<CatalogPage, "source"> | null> {
  "use cache";
  // Prices move when the scraper runs, and the page's ordering reads them.
  cacheLife("prices");
  cacheTag(TAG.rackets, TAG.offers, TAG.sellers);

  assertBalanceBands();

  const supabase = createStaticClient();
  if (!supabase) return null;

  try {
    const from = (page - 1) * pageSize;

    const listing = applySort(
      applyPredicates(
        supabase
          .from("racket_market")
          .select(MARKET_COLUMNS, { count: "exact" }),
        filters,
      ),
      filters.sort,
    ).range(from, from + pageSize - 1);

    // Two independent cache entries, fetched together. The facets call is its
    // own `use cache` scope keyed on the filters alone, so it is a hit for
    // every page after the first of any given filter set.
    const [{ data, error, count }, cachedFacets] = await Promise.all([
      listing,
      readCatalogFacets(filters),
    ]);
    const facets: CatalogFacets = cachedFacets ?? {
      brands: {},
      weightClasses: {},
      balanceTypes: {},
      flexes: {},
    };

    if (error) {
      // The view is missing until the migration lands. Say so once, clearly,
      // rather than serving a slow path forever with no explanation.
      if (/spec_(power|speed|control|comfort)/i.test(error.message)) {
        console.warn(
          "[repository] racket_market has no spec-axis columns, so this sort is " +
            "being paginated in memory. Apply supabase/migrations/" +
            "20260929000000_racket_axis_scores.sql and run " +
            "`npx tsx scripts/refresh-market.ts`.",
        );
      } else if (/racket_market|schema cache|does not exist/i.test(error.message)) {
        console.warn(
          "[repository] racket_market is missing, so the catalogue is being " +
            "paginated in memory. Apply supabase/migrations/" +
            "20260906000000_catalogue_pagination.sql and run " +
            "`npx tsx scripts/refresh-market.ts`.",
        );
      } else {
        console.warn(`[repository] catalogue page query failed: ${error.message}`);
      }
      return null;
    }

    const market = (data ?? []) as unknown as MarketRow[];
    if (market.length === 0) {
      return { rackets: [], total: count ?? 0, page, facets };
    }

    const full = await hydrate(
      supabase,
      market.map((row) => row.id),
    );

    // The view decided the order; `in()` does not preserve it.
    const rackets: CatalogRacket[] = [];
    for (const row of market) {
      const racket = full.get(row.id);
      if (!racket) continue;
      rackets.push({
        ...racket,
        balanceType: row.balance_type,
        reviewCount: row.review_count,
        courtScore: row.court_score,
        specScore: row.spec_score,
        lowestPrice: row.lowest_price,
        sellerCount: row.seller_count,
      });
    }

    return { rackets, total: count ?? rackets.length, page, facets };
  } catch (error) {
    console.warn(
      `[repository] catalogue page fell back to the snapshot: ` +
        `${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
}

/* ------------------------------------------------- rackets by id, enriched */

/**
 * The card-shaped rackets behind a set of ids, in one round trip pair.
 *
 * Two callers need this and neither is a catalogue page: `getDeals` has a list
 * of racket ids from `deal_watch`, and the homepage has four from the view's
 * own ordering. Both used to reach it by building the whole enriched index,
 * which is the 9,4 MB read this module exists to avoid — and both want exactly
 * what the view already resolves: balance type, seller count, lowest price and
 * the two scores, joined to the racket's own columns.
 *
 * Batched for the same reason as `readRacketsByIds` in the repository:
 * PostgREST puts `in()` in the query string, and a full page of deals is more
 * ids than an 8 KB request line holds.
 *
 * Returns `null` when the view cannot answer, so the caller falls back rather
 * than renders a page with rackets missing.
 */
const BY_ID_BATCH = 100;

export async function readMarketRacketsByIds(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, CatalogRacket> | null> {
  if (ids.length === 0) return new Map();

  assertBalanceBands();

  const byId = new Map<string, CatalogRacket>();

  for (let from = 0; from < ids.length; from += BY_ID_BATCH) {
    const batch = ids.slice(from, from + BY_ID_BATCH);

    const [market, full] = await Promise.all([
      supabase.from("racket_market").select(MARKET_COLUMNS).in("id", batch),
      hydrate(supabase, [...batch]),
    ]);

    if (market.error) {
      if (/racket_market|schema cache|does not exist/i.test(market.error.message)) {
        console.warn(
          "[repository] racket_market is missing, so this read fell back to " +
            "the snapshot. Apply supabase/migrations/" +
            "20260906000000_catalogue_pagination.sql and run " +
            "`npx tsx scripts/refresh-market.ts`.",
        );
      } else {
        console.warn(`[repository] racket lookup failed: ${market.error.message}`);
      }
      return null;
    }

    for (const row of (market.data ?? []) as unknown as MarketRow[]) {
      const racket = full.get(row.id);
      if (!racket) continue;
      byId.set(row.id, {
        ...racket,
        balanceType: row.balance_type,
        reviewCount: row.review_count,
        courtScore: row.court_score,
        specScore: row.spec_score,
        lowestPrice: row.lowest_price,
        sellerCount: row.seller_count,
      });
    }
  }

  return byId;
}

/* ------------------------------------------------------------- trending */

/**
 * The highest-scoring rackets, in Court Score order.
 *
 * The homepage's four cards. It used to get them by enriching all 3.010
 * rackets in memory and sorting the result, which is the whole snapshot — 9,4
 * MB to render four cards and three counts.
 *
 * `racket_scores` already holds Court Score, so the view can order by it and
 * Postgres can stop after four. `nullsFirst: false` is what keeps a racket
 * with no player half out of the trending set without a separate predicate:
 * under five verified reviews `court_score` is null, and null sorts last.
 * That is the same rule the old `filter(courtScore !== null)` applied.
 */
export async function readTopRacketsByScore(
  limit: number,
): Promise<CatalogRacket[] | null> {
  "use cache";
  // The ordering reads a score, but the cards render a price.
  cacheLife("prices");
  cacheTag(TAG.rackets, TAG.offers, TAG.sellers);

  assertBalanceBands();

  const supabase = createStaticClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("racket_market")
      .select(MARKET_COLUMNS)
      .order("court_score", { ascending: false, nullsFirst: false })
      .order("spec_score", { ascending: false })
      .order("id")
      .limit(limit);

    if (error) {
      if (/racket_market|schema cache|does not exist/i.test(error.message)) {
        console.warn(
          "[repository] racket_market is missing, so trending is being read " +
            "from the snapshot. Apply supabase/migrations/" +
            "20260906000000_catalogue_pagination.sql and run " +
            "`npx tsx scripts/refresh-market.ts`.",
        );
      } else {
        console.warn(`[repository] trending query failed: ${error.message}`);
      }
      return null;
    }

    const market = (data ?? []) as unknown as MarketRow[];
    // Before `refresh-market` has run there are no scores to rank by, and four
    // arbitrary rackets under a "trending" heading is worse than falling back.
    if (market.length === 0 || market[0].court_score === null) return null;

    const full = await hydrate(supabase, market.map((row) => row.id));

    const rackets: CatalogRacket[] = [];
    for (const row of market) {
      const racket = full.get(row.id);
      if (!racket) continue;
      rackets.push({
        ...racket,
        balanceType: row.balance_type,
        reviewCount: row.review_count,
        courtScore: row.court_score,
        specScore: row.spec_score,
        lowestPrice: row.lowest_price,
        sellerCount: row.seller_count,
      });
    }
    return rackets;
  } catch (error) {
    console.warn(
      `[repository] trending fell back to the snapshot: ` +
        `${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
}
