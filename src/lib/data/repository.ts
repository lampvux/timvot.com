import "server-only";

import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { createStaticClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregate,
  courtScore,
  MIN_REVIEWS_FOR_PLAYER_SCORE,
  toScore,
} from "@/lib/court-score";
import { balanceTypeOf, median } from "@/lib/format";
import type {
  AxisScores,
  Brand,
  CatalogFilters,
  Guide,
  Offer,
  OfferWithSeller,
  PricePoint,
  Racket,
  RacketVariant,
  RacketWithMarket,
  Review,
  Seller,
} from "@/lib/types";
import * as seed from "./seed";
import { TAG } from "./tags";
import {
  mapBrand,
  mapGuide,
  mapOffer,
  mapPricePoint,
  mapRacket,
  mapReview,
  mapSeller,
  RACKET_SELECT,
  RACKET_SELECT_NO_THUMBS,
  RACKET_CARD_SELECT,
  RACKET_CARD_SELECT_NO_THUMBS,
  isMissingColumnError,
} from "./mappers";

/**
 * One read path for the whole app.
 *
 * When Supabase is linked every query goes to Postgres. When it is not — a
 * fresh clone, a design review, a preview before provisioning — the same
 * shapes come out of the seeded catalogue. Callers cannot tell the
 * difference, and there is no third code path to keep in sync.
 */

interface CatalogueSnapshot {
  brands: Brand[];
  rackets: Racket[];
  guides: Guide[];
}

interface MarketSnapshot {
  sellers: Seller[];
  offers: Offer[];
  history: PricePoint[];
  reviews: Review[];
}

interface Snapshot extends CatalogueSnapshot, MarketSnapshot {
  source: "supabase" | "seed";
}

const seedCatalogueSnapshot = (): CatalogueSnapshot => ({
  brands: seed.brands,
  rackets: seed.rackets,
  guides: seed.guides,
});

const seedMarketSnapshot = (): MarketSnapshot => ({
  sellers: seed.sellers,
  offers: seed.offers,
  history: seed.priceHistory,
  reviews: seed.reviews,
});

const seedSnapshot = (): Snapshot => ({
  ...seedCatalogueSnapshot(),
  ...seedMarketSnapshot(),
  source: "seed",
});

/**
 * PostgREST's page size, and the reason this file has to page at all.
 *
 * A Supabase request is capped at `db-max-rows` — 1000 by default — and a
 * truncated response arrives with no error and nothing to say it was cut. The
 * catalogue passed 1000 rackets some time ago, so the snapshot held the first
 * 1000 and `getRacket` answered "no such racket" for the other 2037: every one
 * of those detail pages 404ed, gallery and all, while the rows sat in Postgres.
 * Five of the seven tables read here are over the cap now.
 */
const PAGE_SIZE = 1000;

/**
 * Read a whole table rather than its first page.
 *
 * `page` is a factory, not a query: a range has to be applied to a fresh
 * builder each time round. Every caller orders by a unique column, because
 * paging an unordered result is what silently duplicates some rows and drops
 * others — Postgres makes no promise about row order between two statements.
 */
async function selectAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const all: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;

    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return { data: all, error: null };
}

/**
 * Read every racket, once with thumbnails and once without if the schema is
 * behind the code.
 *
 * PostgREST fails the whole query on an unknown column, and the caller answers
 * any error by falling back to the seeded catalogue — so deploying the
 * thumbnail columns ahead of their migration would quietly serve eighteen
 * rackets instead of three thousand. Retrying without them costs one wasted
 * round trip in that one situation and nothing at all afterwards, and the
 * degraded result is "no thumbnails", not "no catalogue".
 */
async function readRackets(supabase: SupabaseClient) {
  const withThumbs = await selectAll((from, to) =>
    supabase.from("rackets").select(RACKET_SELECT).order("id").range(from, to),
  );

  if (!withThumbs.error || !isMissingColumnError(withThumbs.error.message)) {
    return withThumbs;
  }

  console.warn(
    "[repository] rackets: thumbnail columns are missing, so the catalogue is " +
      "being read without them. Apply supabase/migrations/" +
      "20260828000000_image_thumbnails.sql and redeploy.",
  );

  return selectAll((from, to) =>
    supabase
      .from("rackets")
      .select(RACKET_SELECT_NO_THUMBS)
      .order("id")
      .range(from, to),
  );
}

/** Same schema-rollout guard as `readRackets`, without the gallery relation. */
async function readRacketCardRows(supabase: SupabaseClient) {
  const withThumbs = await selectAll((from, to) =>
    supabase
      .from("rackets")
      .select(RACKET_CARD_SELECT)
      .order("id")
      .range(from, to),
  );

  if (!withThumbs.error || !isMissingColumnError(withThumbs.error.message)) {
    return withThumbs;
  }

  return selectAll((from, to) =>
    supabase
      .from("rackets")
      .select(RACKET_CARD_SELECT_NO_THUMBS)
      .order("id")
      .range(from, to),
  );
}

/**
 * Slow-changing product identity and editorial data.
 *
 * `use cache` is what makes a route holding this data prerenderable: without
 * it Next treats the Supabase call as runtime data and refuses to build a
 * static shell — "encountered uncached or runtime data during prerendering".
 * On Vercel Hobby that matters more than the cache itself, because a
 * prerendered page served from the CDN does not invoke the function at all,
 * and Active CPU is the budget the free plan actually rations.
 *
 * This deliberately does not share an entry with prices and stock. A price
 * expiry or price-only invalidation must not force Postgres to resend names,
 * specifications, images and guides that have not changed.
 *
 * Nothing in here may read `cookies()` or `headers()`: a cached scope has no
 * request to read them from. `createStaticClient()` is cookie-free by design,
 * which is why it is the client used here and not `createClient()`.
 *
 * Deliberately *not* `use cache: remote`. That needs a platform cache handler
 * and bills for it; the in-memory default plus prerendering is the right shape
 * on this plan.
 */
async function readCatalogueSnapshot(): Promise<CatalogueSnapshot | null> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.brands, TAG.rackets, TAG.guides);

  const supabase = createStaticClient();
  if (!supabase) return null;

  try {
    const [brandRows, racketRows, guideRows] = await Promise.all([
      supabase.from("brands").select("*").order("name"),
      readRackets(supabase),
      supabase.from("guides").select("*"),
    ]);

    const failure = [brandRows, racketRows, guideRows].find(
      (result) => result.error,
    );

    // An unmigrated project is the common case on a first run. Fall back
    // rather than render an empty catalogue that looks like a bug.
    if (failure?.error || !racketRows.data?.length) return null;

    return {
      brands: (brandRows.data ?? []).map(mapBrand),
      rackets: (racketRows.data ?? []).map(mapRacket),
      guides: (guideRows.data ?? []).map(mapGuide),
    };
  } catch {
    return null;
  }
}

/**
 * Fast-changing offers, stock and price history use the shorter `prices`
 * profile. Sellers and reviews sit with this side because both participate in
 * the market-derived racket index and need to be internally consistent with
 * its offers.
 */
async function readMarketSnapshot(): Promise<MarketSnapshot | null> {
  "use cache";
  cacheLife("prices");
  cacheTag(TAG.sellers, TAG.offers, TAG.pricePoints, TAG.reviews);

  const supabase = createStaticClient();
  if (!supabase) return null;

  try {
    const [sellerRows, offerRows, historyRows, reviewRows] = await Promise.all([
      supabase.from("sellers").select("*"),
      selectAll((from, to) =>
        supabase
          .from("offers")
          .select("*")
          .eq("status", "live")
          .order("id")
          .range(from, to),
      ),
      // `observed_on` is what the chart wants and is not unique; `id` breaks
      // the ties so the page boundaries are stable.
      selectAll((from, to) =>
        supabase
          .from("price_points")
          .select("*")
          .order("observed_on")
          .order("id")
          .range(from, to),
      ),
      selectAll((from, to) =>
        supabase
          .from("reviews")
          .select("*")
          .eq("status", "published")
          .order("id")
          .range(from, to),
      ),
    ]);

    const failure = [sellerRows, offerRows, historyRows, reviewRows].find(
      (result) => result.error,
    );
    if (failure?.error) return null;

    return {
      sellers: (sellerRows.data ?? []).map(mapSeller),
      offers: (offerRows.data ?? []).map(mapOffer),
      history: (historyRows.data ?? []).map(mapPricePoint),
      reviews: (reviewRows.data ?? []).map(mapReview),
    };
  } catch {
    return null;
  }
}

/**
 * Compose the two independently cached domains. Never mix seeded and live
 * rows: their IDs are only guaranteed to agree inside one source, so a partial
 * Supabase failure falls back to the complete seed snapshot.
 */
async function readSnapshot(): Promise<Snapshot> {
  const [catalogue, market] = await Promise.all([
    readCatalogueSnapshot(),
    readMarketSnapshot(),
  ]);

  if (!catalogue || !market) return seedSnapshot();
  return { ...catalogue, ...market, source: "supabase" };
}

/** Deduped per request by React `cache` on top of the two cross-request
 *  `use cache` entries, so one render composes them once rather than per caller. */
export const loadSnapshot = cache(readSnapshot);

interface MarketSummaryRow {
  racket_id: string;
  lowest_price: number | string | null;
  seller_count: number | string;
  review_count: number | string;
  review_weight: number | string;
  power_weighted_sum: number | string;
  speed_weighted_sum: number | string;
  control_weighted_sum: number | string;
  comfort_weighted_sum: number | string;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

function playerFromSummary(row: MarketSummaryRow): AxisScores | null {
  const reviewCount = Number(row.review_count);
  const weight = Number(row.review_weight);
  if (reviewCount < MIN_REVIEWS_FOR_PLAYER_SCORE || weight <= 0) return null;

  const toTen = (sum: number | string): number =>
    round1(((Number(sum) / weight - 1) / 4) * 10);

  return {
    power: toTen(row.power_weighted_sum),
    speed: toTen(row.speed_weighted_sum),
    control: toTen(row.control_weighted_sum),
    comfort: toTen(row.comfort_weighted_sum),
  };
}

/** Build the card/finder shape from one compact aggregate row. */
function enrichFromSummary(
  racket: Racket,
  row: MarketSummaryRow | undefined,
): RacketWithMarket {
  const specHalf = courtScore(racket, []);
  const player = row ? playerFromSummary(row) : null;

  return {
    ...racket,
    balanceType: balanceTypeOf(racket.balancePointMm),
    spec: specHalf.spec,
    player,
    reviewCount: Number(row?.review_count ?? 0),
    courtScore: player
      ? toScore(aggregate(specHalf.spec) * 0.5 + aggregate(player) * 0.5)
      : null,
    specScore: specHalf.specScore,
    lowestPrice:
      row?.lowest_price === null || row?.lowest_price === undefined
        ? null
        : Number(row.lowest_price),
    sellerCount: Number(row?.seller_count ?? 0),
    // Cards, filters, Finder and static-param ranking do not render charts.
    history: [],
  };
}

/** Slow-changing card fields, cached without any gallery relation. */
async function readRacketCards(): Promise<Racket[] | null> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.brands, TAG.rackets);

  const supabase = createStaticClient();
  if (!supabase) return null;

  try {
    const rows = await readRacketCardRows(supabase);
    return rows.error || !rows.data?.length ? null : rows.data.map(mapRacket);
  } catch {
    return null;
  }
}

/**
 * One compact market row per racket, independently cached on the price
 * window. Returning null is a rollout guard: code can deploy before the view
 * migration and temporarily use the legacy snapshot without losing data.
 */
async function readMarketSummaries(): Promise<MarketSummaryRow[] | null> {
  "use cache";
  cacheLife("prices");
  cacheTag(TAG.offers, TAG.reviews);

  const supabase = createStaticClient();
  if (!supabase) return null;

  try {
    const rows = await selectAll<MarketSummaryRow>((from, to) =>
      supabase
        .from("racket_market_summary")
        .select("*")
        .order("racket_id")
        .range(from, to),
    );
    return rows.error ? null : (rows.data ?? []);
  } catch {
    return null;
  }
}

/**
 * Purpose-built catalogue projection: card fields plus market summaries. It
 * intentionally excludes galleries, sellers, review bodies and price history.
 */
async function readRacketCatalogue(): Promise<RacketWithMarket[] | null> {
  const [rackets, marketRows] = await Promise.all([
    readRacketCards(),
    readMarketSummaries(),
  ]);
  if (!rackets || !marketRows) return null;

  const summaries = new Map(
    marketRows.map((row) => [row.racket_id, row] as const),
  );
  return rackets.map((racket) =>
    enrichFromSummary(racket, summaries.get(racket.id)),
  );
}

async function readBrandsOnly(): Promise<Brand[] | null> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.brands);

  const supabase = createStaticClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("brands").select("*").order("name");
  return error ? null : (data ?? []).map(mapBrand);
}

async function readSellersOnly(): Promise<Seller[] | null> {
  "use cache";
  cacheLife("prices");
  cacheTag(TAG.sellers);

  const supabase = createStaticClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("sellers").select("*");
  return error ? null : (data ?? []).map(mapSeller);
}

async function readGuidesOnly(): Promise<Guide[] | null> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.guides);

  const supabase = createStaticClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("guides").select("*");
  return error ? null : (data ?? []).map(mapGuide);
}

/* --------------------------------------------------------------- index */

/**
 * The snapshot, plus the lookups every read below needs.
 *
 * `enrich` runs once per racket, and it used to answer "which offers, reviews
 * and price points are mine?" by scanning the whole of each array. That is
 * rackets × offers, rackets × reviews and rackets × price points — and the
 * price table grows by ~3.265 rows on every `scrape:refresh`, so the cost went
 * up on the scraper's schedule rather than on the feature backlog. At 3.010
 * rackets and ninety days of scrapes it is roughly 880 million array steps for
 * one render of the home page.
 *
 * Grouping the three tables once turns every one of those scans into a map
 * read. The work becomes rackets + offers + reviews + price points, and the
 * gap widens with each scrape instead of closing.
 *
 * Nothing here changes a public signature: callers, and the seeded fallback,
 * cannot tell the difference.
 */
interface Index {
  snapshot: Snapshot;
  /** Every offer, live or not, by racket. `getOffersForRacket` filters. */
  offersByRacket: Map<string, Offer[]>;
  offersBySeller: Map<string, Offer[]>;
  reviewsByRacket: Map<string, Review[]>;
  /** Ascending by `observedOn`. Sorted once here, never again per caller. */
  historyByVariant: Map<string, PricePoint[]>;
  /** Live offers only — this is what decides the headline variant. */
  liveOfferCountByVariant: Map<string, number>;
  sellersById: Map<string, Seller>;
  variantsById: Map<string, RacketVariant>;
  /** Keyed `brandSlug/slug`, so a detail page is a lookup and not a scan. */
  enrichedByPath: Map<string, RacketWithMarket>;
  enrichedBySlug: Map<string, RacketWithMarket>;
  enriched: RacketWithMarket[];
}

/** Push `value` onto the array at `key`, creating it on first use. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

const EMPTY_OFFERS: readonly Offer[] = [];
const EMPTY_REVIEWS: readonly Review[] = [];
const EMPTY_POINTS: readonly PricePoint[] = [];

/**
 * Built once per request, behind React `cache`, and shared by every read.
 *
 * Enrichment happens here too: `getRackets`, `getRacket` and `getDeals` all
 * want the same enriched list, and computing it three times was the second
 * half of the same problem.
 */
const loadIndex = cache(async (): Promise<Index> => {
  const snapshot = await loadSnapshot();

  const offersByRacket = new Map<string, Offer[]>();
  const offersBySeller = new Map<string, Offer[]>();
  const liveOfferCountByVariant = new Map<string, number>();
  for (const offer of snapshot.offers) {
    push(offersByRacket, offer.racketId, offer);
    push(offersBySeller, offer.sellerId, offer);
    if (offer.status === "live") {
      liveOfferCountByVariant.set(
        offer.variantId,
        (liveOfferCountByVariant.get(offer.variantId) ?? 0) + 1,
      );
    }
  }

  const reviewsByRacket = new Map<string, Review[]>();
  for (const review of snapshot.reviews) push(reviewsByRacket, review.racketId, review);

  const historyByVariant = new Map<string, PricePoint[]>();
  for (const point of snapshot.history) push(historyByVariant, point.variantId, point);
  // Supabase already orders by `observed_on`, but the seed does not promise to,
  // and every caller downstream assumes ascending. Sorting the groups is cheap;
  // sorting the whole table once per variant was not.
  for (const points of historyByVariant.values())
    points.sort((a, b) => a.observedOn.localeCompare(b.observedOn));

  const sellersById = new Map(snapshot.sellers.map((s) => [s.id, s]));
  const variantsById = new Map(
    snapshot.rackets.flatMap((r) => r.variants.map((v) => [v.id, v] as const)),
  );

  const index: Index = {
    snapshot,
    offersByRacket,
    offersBySeller,
    reviewsByRacket,
    historyByVariant,
    liveOfferCountByVariant,
    sellersById,
    variantsById,
    enrichedByPath: new Map(),
    enrichedBySlug: new Map(),
    enriched: [],
  };

  index.enriched = snapshot.rackets.map((racket) => enrich(index, racket));
  for (const racket of index.enriched) {
    index.enrichedByPath.set(`${racket.brandSlug}/${racket.slug}`, racket);
    // First wins: `getRacketsBySlugs` resolves a bare slug, and two brands
    // could in principle share one.
    if (!index.enrichedBySlug.has(racket.slug))
      index.enrichedBySlug.set(racket.slug, racket);
  }

  return index;
});

/* ------------------------------------------------------------ enrichment */

function enrich(index: Index, racket: Racket): RacketWithMarket {
  const history = racket.variants
    .flatMap((v) => index.historyByVariant.get(v.id) ?? EMPTY_POINTS)
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn));
  return enrichWithMarket(
    racket,
    index.offersByRacket.get(racket.id) ?? EMPTY_OFFERS,
    index.reviewsByRacket.get(racket.id) ?? EMPTY_REVIEWS,
    history,
  );
}

function enrichWithMarket(
  racket: Racket,
  offers: readonly Offer[],
  reviews: readonly Review[],
  history: PricePoint[],
): RacketWithMarket {
  const liveOffers = offers.filter((offer) => offer.qtyAvailable > 0);
  const racketReviews = [...reviews];
  const score = courtScore(racket, racketReviews);

  return {
    ...racket,
    balanceType: balanceTypeOf(racket.balancePointMm),
    spec: score.spec,
    player: score.player,
    reviewCount: racketReviews.length,
    courtScore: score.total,
    specScore: score.specScore,
    lowestPrice: liveOffers.length
      ? Math.min(...liveOffers.map((o) => o.price))
      : null,
    sellerCount: new Set(liveOffers.map((o) => o.sellerId)).size,
    history,
  };
}

export const getRackets = cache(async (): Promise<RacketWithMarket[]> => {
  return (await readRacketCatalogue()) ?? (await loadIndex()).enriched;
});

export const getBrands = cache(async (): Promise<Brand[]> => {
  return (await readBrandsOnly()) ?? (await loadSnapshot()).brands;
});

export const getSellers = cache(async (): Promise<Seller[]> => {
  return (await readSellersOnly()) ?? (await loadSnapshot()).sellers;
});

export const getGuides = cache(async (): Promise<Guide[]> => {
  return (await readGuidesOnly()) ?? (await loadSnapshot()).guides;
});

interface DirectRacketDetail {
  racket: RacketWithMarket;
  offers: OfferWithSeller[];
  reviews: Review[];
  history: PricePoint[];
}

type DirectRacketResult =
  | { status: "ok"; data: DirectRacketDetail }
  | { status: "not-found" }
  | { status: "error" };

/**
 * A detail route needs one racket and rows keyed to that racket, not the whole
 * marketplace. This read remains one cache entry because the page consumes
 * the fields together and the market side sets the freshness requirement.
 */
async function readRacketDetail(
  brandSlug: string,
  racketSlug: string,
): Promise<DirectRacketResult> {
  "use cache";
  cacheLife("prices");
  cacheTag(
    TAG.brands,
    TAG.rackets,
    TAG.sellers,
    TAG.offers,
    TAG.pricePoints,
    TAG.reviews,
  );

  const supabase = createStaticClient();
  if (!supabase) return { status: "error" };

  try {
    const brandResult = await supabase
      .from("brands")
      .select("id")
      .eq("slug", brandSlug)
      .maybeSingle();
    if (brandResult.error) return { status: "error" };
    if (!brandResult.data) return { status: "not-found" };

    let racketResult = await supabase
      .from("rackets")
      .select(RACKET_SELECT)
      .eq("brand_id", brandResult.data.id)
      .eq("slug", racketSlug)
      .maybeSingle();

    if (
      racketResult.error &&
      isMissingColumnError(racketResult.error.message)
    ) {
      racketResult = await supabase
        .from("rackets")
        .select(RACKET_SELECT_NO_THUMBS)
        .eq("brand_id", brandResult.data.id)
        .eq("slug", racketSlug)
        .maybeSingle();
    }

    if (racketResult.error) return { status: "error" };
    if (!racketResult.data) return { status: "not-found" };

    const racket = mapRacket(racketResult.data);
    const variantIds = racket.variants.map((variant) => variant.id);
    const [offerRows, reviewRows, historyRows] = await Promise.all([
      supabase
        .from("offers")
        .select("*, seller:sellers!inner(*)")
        .eq("racket_id", racket.id)
        .eq("status", "live")
        .order("price"),
      supabase
        .from("reviews")
        .select("*")
        .eq("racket_id", racket.id)
        .eq("status", "published")
        .order("created_at", { ascending: false }),
      variantIds.length
        ? supabase
            .from("price_points")
            .select("*")
            .in("variant_id", variantIds)
            .order("observed_on")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (offerRows.error || reviewRows.error || historyRows.error)
      return { status: "error" };

    const variants = new Map(
      racket.variants.map((variant) => [variant.id, variant]),
    );
    const offers = (offerRows.data ?? [])
      .map((row) => {
        const sellerRow = Array.isArray(row.seller) ? row.seller[0] : row.seller;
        const variant = variants.get(row.variant_id);
        if (!sellerRow || !variant) return null;
        return { ...mapOffer(row), seller: mapSeller(sellerRow), variant };
      })
      .filter((offer): offer is OfferWithSeller => Boolean(offer));
    const reviews = (reviewRows.data ?? []).map(mapReview);
    const history = (historyRows.data ?? [])
      .map(mapPricePoint)
      .sort((a, b) => a.observedOn.localeCompare(b.observedOn));

    return {
      status: "ok",
      data: {
        racket: enrichWithMarket(racket, offers, reviews, history),
        offers,
        reviews,
        history,
      },
    };
  } catch {
    return { status: "error" };
  }
}

export async function getRacket(
  brandSlug: string,
  racketSlug: string,
): Promise<RacketWithMarket | null> {
  const direct = await readRacketDetail(brandSlug, racketSlug);
  if (direct.status === "ok") return direct.data.racket;
  if (direct.status === "not-found") return null;

  // Missing credentials or a migration still rolling out: preserve the
  // existing all-or-nothing seed/live fallback rather than fail the route.
  const index = await loadIndex();
  return index.enrichedByPath.get(`${brandSlug}/${racketSlug}`) ?? null;
}

export async function getRacketsBySlugs(
  slugs: string[],
): Promise<RacketWithMarket[]> {
  if (slugs.length === 0) return [];
  const rackets = await getRackets();
  const bySlug = new Map(rackets.map((racket) => [racket.slug, racket]));
  // Preserve the order the user picked them in.
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter((r): r is RacketWithMarket => Boolean(r));
}

export async function getOffersForRacket(
  racketId: string,
): Promise<OfferWithSeller[]> {
  const index = await loadIndex();

  return (index.offersByRacket.get(racketId) ?? EMPTY_OFFERS)
    .filter((o) => o.status === "live")
    .map((offer) => {
      const seller = index.sellersById.get(offer.sellerId);
      const variant = index.variantsById.get(offer.variantId);
      if (!seller || !variant) return null;
      return { ...offer, seller, variant };
    })
    .filter((o): o is OfferWithSeller => Boolean(o))
    // Sorted by price ascending by default. Promoted rows never jump the queue.
    .sort((a, b) => a.price - b.price);
}

export async function getOffersForSeller(
  sellerId: string,
): Promise<(OfferWithSeller & { racket: Racket })[]> {
  const index = await loadIndex();
  const seller = index.sellersById.get(sellerId);
  if (!seller) return [];

  const rackets = new Map(index.snapshot.rackets.map((r) => [r.id, r]));

  return (index.offersBySeller.get(sellerId) ?? EMPTY_OFFERS)
    .map((offer) => {
      const racket = rackets.get(offer.racketId);
      const variant = index.variantsById.get(offer.variantId);
      if (!racket || !variant) return null;
      return { ...offer, seller, variant, racket };
    })
    .filter((o): o is OfferWithSeller & { racket: Racket } => Boolean(o))
    .sort((a, b) => a.racket.name.localeCompare(b.racket.name));
}

export async function getSeller(slug: string): Promise<Seller | null> {
  const sellers = await getSellers();
  return sellers.find((s) => s.slug === slug) ?? null;
}

export async function getReviewsForRacket(racketId: string): Promise<Review[]> {
  const index = await loadIndex();
  return [...(index.reviewsByRacket.get(racketId) ?? EMPTY_REVIEWS)].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

/* ------------------------------------------------------------ price data */

export interface VariantPrice {
  variantId: string;
  latest: number;
  median30: number;
  delta90: number;
  delta30: number;
  points: PricePoint[];
}

/**
 * Shape one variant's price series. The points arrive already sorted from the
 * index, which is why there is no `.sort()` here — `getDeals` calls this once
 * per variant, and sorting the whole price table 3.265 times was most of what
 * made the deals page expensive.
 */
function variantPriceFromPoints(
  variantId: string,
  points: PricePoint[] | undefined,
): VariantPrice | null {
  if (!points || points.length === 0) return null;

  const latest = points[points.length - 1].price;
  const lastThird = points.slice(Math.floor((points.length * 2) / 3));

  return {
    variantId,
    latest,
    median30: median(lastThird.map((p) => p.price)),
    delta90: latest - points[0].price,
    delta30: latest - lastThird[0].price,
    points,
  };
}

function variantPrice(index: Index, variantId: string): VariantPrice | null {
  return variantPriceFromPoints(variantId, index.historyByVariant.get(variantId));
}

export async function getVariantPrice(
  variantId: string,
): Promise<VariantPrice | null> {
  return variantPrice(await loadIndex(), variantId);
}

/**
 * The variant a racket's headline price and chart are drawn from: the one the
 * most sellers actually stock, because that is the one a buyer is comparing.
 * Ties go to the lighter frame, which is the more common configuration.
 */
export async function getHeadlineVariantPrice(
  racket: RacketWithMarket,
): Promise<VariantPrice | null> {
  const index = await loadIndex();
  const counts = index.liveOfferCountByVariant;

  const candidates = racket.variants.filter((variant) =>
    index.historyByVariant.has(variant.id),
  );
  if (candidates.length === 0) return null;

  const headline = [...candidates].sort(
    (a, b) =>
      (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
      a.weightGrams - b.weightGrams,
  )[0];

  return variantPrice(index, headline.id);
}

function headlinePriceFromDetail(
  detail: DirectRacketDetail,
): VariantPrice | null {
  const historyByVariant = new Map<string, PricePoint[]>();
  for (const point of detail.history)
    push(historyByVariant, point.variantId, point);

  const liveOfferCount = new Map<string, number>();
  for (const offer of detail.offers) {
    liveOfferCount.set(
      offer.variantId,
      (liveOfferCount.get(offer.variantId) ?? 0) + 1,
    );
  }

  const headline = detail.racket.variants
    .filter((variant) => historyByVariant.has(variant.id))
    .sort(
      (a, b) =>
        (liveOfferCount.get(b.id) ?? 0) -
          (liveOfferCount.get(a.id) ?? 0) || a.weightGrams - b.weightGrams,
    )[0];

  return headline
    ? variantPriceFromPoints(headline.id, historyByVariant.get(headline.id))
    : null;
}

function similarRackets(
  racket: RacketWithMarket,
  candidates: RacketWithMarket[],
): RacketWithMarket[] {
  return candidates
    .filter((other) => other.id !== racket.id)
    .map((other) => ({
      racket: other,
      distance:
        Math.abs(other.balancePointMm - racket.balancePointMm) +
        Math.abs(
          (other.lowestPrice ?? other.msrp) -
            (racket.lowestPrice ?? racket.msrp),
        ) /
          200_000,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((entry) => entry.racket);
}

export interface RacketPageData {
  racket: RacketWithMarket;
  offers: OfferWithSeller[];
  reviews: Review[];
  price: VariantPrice | null;
  similar: RacketWithMarket[];
}

/** One bounded repository call for everything rendered by a detail route. */
export const getRacketPageData = cache(
  async (
    brandSlug: string,
    racketSlug: string,
  ): Promise<RacketPageData | null> => {
    const direct = await readRacketDetail(brandSlug, racketSlug);
    if (direct.status === "not-found") return null;

    if (direct.status === "ok") {
      return {
        racket: direct.data.racket,
        offers: direct.data.offers,
        reviews: direct.data.reviews,
        price: headlinePriceFromDetail(direct.data),
        similar: similarRackets(direct.data.racket, await getRackets()),
      };
    }

    const index = await loadIndex();
    const racket =
      index.enrichedByPath.get(`${brandSlug}/${racketSlug}`) ?? null;
    if (!racket) return null;

    const [offers, reviews, price, candidates] = await Promise.all([
      getOffersForRacket(racket.id),
      getReviewsForRacket(racket.id),
      getHeadlineVariantPrice(racket),
      getRackets(),
    ]);
    return {
      racket,
      offers,
      reviews,
      price,
      similar: similarRackets(racket, candidates),
    };
  },
);

/* -------------------------------------------------------------- deals */

export interface Deal {
  racket: RacketWithMarket;
  variantId: string;
  price: VariantPrice;
}

export async function getDeals(): Promise<Deal[]> {
  const index = await loadIndex();
  const deals: Deal[] = [];

  for (const racket of index.enriched) {
    for (const variant of racket.variants) {
      const price = variantPrice(index, variant.id);
      if (!price) continue;
      if (price.latest < price.median30 && price.delta30 < 0) {
        deals.push({ racket, variantId: variant.id, price });
      }
    }
  }

  return deals.sort((a, b) => a.price.delta30 - b.price.delta30);
}

/* ------------------------------------------------------------ filtering */

const searchTextByRacket = new WeakMap<RacketWithMarket, string>();

function searchText(racket: RacketWithMarket): string {
  const cached = searchTextByRacket.get(racket);
  if (cached) return cached;

  const value = `${racket.brandName} ${racket.name}`.toLowerCase();
  searchTextByRacket.set(racket, value);
  return value;
}

function matchesFilters(
  racket: RacketWithMarket,
  filters: CatalogFilters,
  query: string,
): boolean {
  if (filters.brands.length && !filters.brands.includes(racket.brandSlug))
    return false;

  if (
    filters.weightClasses.length &&
    !racket.variants.some((variant) =>
      filters.weightClasses.includes(variant.weightClass),
    )
  )
    return false;

  if (
    filters.balanceTypes.length &&
    !filters.balanceTypes.includes(racket.balanceType)
  )
    return false;

  if (filters.flexes.length && !filters.flexes.includes(racket.shaftFlex))
    return false;

  const price = racket.lowestPrice ?? racket.msrp;
  if (filters.priceMin !== null && price < filters.priceMin) return false;
  if (filters.priceMax !== null && price > filters.priceMax) return false;

  return !query || searchText(racket).includes(query);
}

export function applyFilters(
  rackets: RacketWithMarket[],
  filters: CatalogFilters,
): RacketWithMarket[] {
  return sortRackets(filterRackets(rackets, filters), filters.sort);
}

/**
 * Apply catalogue predicates without ordering the result.
 *
 * Facet counts and empty-state suggestions only need membership. They used to
 * call `applyFilters`, which sorted the same catalogue four or more times per
 * request before immediately throwing that order away. Keeping filtering and
 * sorting separate makes one final sort the only `O(n log n)` step.
 */
export function filterRackets(
  rackets: RacketWithMarket[],
  filters: CatalogFilters,
): RacketWithMarket[] {
  const query = filters.query.trim().toLowerCase();
  return rackets.filter((racket) => matchesFilters(racket, filters, query));
}

export function countFilteredRackets(
  rackets: RacketWithMarket[],
  filters: CatalogFilters,
): number {
  const query = filters.query.trim().toLowerCase();
  let count = 0;
  for (const racket of rackets)
    if (matchesFilters(racket, filters, query)) count++;
  return count;
}

export function sortRackets(
  rackets: RacketWithMarket[],
  sort: CatalogFilters["sort"],
): RacketWithMarket[] {
  const priceOf = (r: RacketWithMarket) => r.lowestPrice ?? r.msrp;
  const copy = [...rackets];

  /** Scored rackets rank above spec-only ones. A racket with no player half
   *  has not earned a position among the ones that do. */
  const byScore = (a: RacketWithMarket, b: RacketWithMarket) => {
    if (a.courtScore !== null && b.courtScore !== null)
      return b.courtScore - a.courtScore;
    if (a.courtScore !== null) return -1;
    if (b.courtScore !== null) return 1;
    return b.specScore - a.specScore;
  };

  switch (sort) {
    case "price-asc":
      return copy.sort((a, b) => priceOf(a) - priceOf(b));
    case "price-desc":
      return copy.sort((a, b) => priceOf(b) - priceOf(a));
    case "new":
      return copy.sort((a, b) => b.releaseYear - a.releaseYear || byScore(a, b));
    default:
      return copy.sort(byScore);
  }
}

/** Facet counts, computed against everything except that facet's own filter. */
export function facetCounts(
  rackets: RacketWithMarket[],
  filters: CatalogFilters,
) {
  type ArrayFacet = "brands" | "weightClasses" | "balanceTypes" | "flexes";
  const without = (key: ArrayFacet) =>
    filterRackets(rackets, { ...filters, [key]: [] });

  const count = <T,>(list: RacketWithMarket[], read: (r: RacketWithMarket) => T[]) => {
    const map = new Map<T, number>();
    for (const racket of list)
      for (const value of new Set(read(racket)))
        map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  };

  return {
    brands: count(without("brands"), (r) => [r.brandSlug]),
    weightClasses: count(without("weightClasses"), (r) =>
      r.variants.map((v) => v.weightClass),
    ),
    balanceTypes: count(without("balanceTypes"), (r) => [r.balanceType]),
    flexes: count(without("flexes"), (r) => [r.shaftFlex]),
  };
}
