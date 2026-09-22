import "server-only";

import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { createStaticClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { courtScore } from "@/lib/court-score";
import { balanceTypeOf } from "@/lib/format";
import {
  bySteepestDrop,
  isPriceDrop,
  variantPriceFromPoints,
  type VariantPrice,
} from "@/lib/price-window";
import { comparePopularBrandTiers } from "@/lib/catalog-ranking";
import type {
  Brand,
  CatalogFilters,
  CatalogRacket,
  RacketCardData,
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
  countCatalogMatchesInView,
  readCatalogPageFromView,
  readMarketRacketsByIds,
  readTopRacketsByScore,
  type CatalogPage,
} from "./catalog-page";
export type { CatalogPage, CatalogFacets } from "./catalog-page";
import {
  mapBrand,
  mapGuide,
  mapOffer,
  mapPricePoint,
  mapRacket,
  mergeEquivalentRacketGalleries,
  mapReview,
  mapSeller,
  mapVariant,
  RACKET_SELECT,
  RACKET_SELECT_NO_THUMBS,
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

interface Snapshot {
  brands: Brand[];
  rackets: Racket[];
  sellers: Seller[];
  offers: Offer[];
  history: PricePoint[];
  reviews: Review[];
  guides: Guide[];
  source: "supabase" | "seed";
}

const seedSnapshot = (): Snapshot => ({
  brands: seed.brands,
  rackets: seed.rackets,
  sellers: seed.sellers,
  offers: seed.offers,
  history: seed.priceHistory,
  reviews: seed.reviews,
  guides: seed.guides,
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

/**
 * The catalogue read, cached across requests rather than rebuilt for each one.
 *
 * `use cache` is what makes a route holding this data prerenderable: without
 * it Next treats the Supabase call as runtime data and refuses to build a
 * static shell — "encountered uncached or runtime data during prerendering".
 * On Vercel Hobby that matters more than the cache itself, because a
 * prerendered page served from the CDN does not invoke the function at all,
 * and Active CPU is the budget the free plan actually rations.
 *
 * The tags are per table so `scrape:sync` can invalidate what it just wrote
 * instead of waiting out a timer — see `app/api/revalidate/route.ts`.
 *
 * Nothing in here may read `cookies()` or `headers()`: a cached scope has no
 * request to read them from. `createStaticClient()` is cookie-free by design,
 * which is why it is the client used here and not `createClient()`.
 *
 * Deliberately *not* `use cache: remote`. That needs a platform cache handler
 * and bills for it; the in-memory default plus prerendering is the right shape
 * on this plan.
 */
async function readSnapshot(): Promise<Snapshot> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(
    TAG.brands,
    TAG.rackets,
    TAG.sellers,
    TAG.offers,
    TAG.pricePoints,
    TAG.reviews,
    TAG.guides,
  );

  const supabase = createStaticClient("snapshot-client");
  if (!supabase) return seedSnapshot();

  try {
    const [brandRows, racketRows, sellerRows, offerRows, historyRows, reviewRows, guideRows] =
      await Promise.all([
        supabase.from("brands").select("*").order("name"),
        readRackets(supabase),
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
        supabase.from("guides").select("*"),
      ]);

    const failure = [
      brandRows,
      racketRows,
      sellerRows,
      offerRows,
      historyRows,
      reviewRows,
      guideRows,
    ].find((result) => result.error);

    // An unmigrated project is the common case on a first run. Fall back
    // rather than render an empty catalogue that looks like a bug.
    if (failure?.error || !racketRows.data?.length) return seedSnapshot();

    return {
      brands: (brandRows.data ?? []).map(mapBrand),
      rackets: mergeEquivalentRacketGalleries((racketRows.data ?? []).map(mapRacket)),
      sellers: (sellerRows.data ?? []).map(mapSeller),
      offers: (offerRows.data ?? []).map(mapOffer),
      history: (historyRows.data ?? []).map(mapPricePoint),
      reviews: (reviewRows.data ?? []).map(mapReview),
      guides: (guideRows.data ?? []).map(mapGuide),
      source: "supabase",
    };
  } catch {
    return seedSnapshot();
  }
}

/** Deduped per request by React `cache` on top of the cross-request
 *  `use cache`, so one render hits the cache once rather than per caller. */
export const loadSnapshot = cache(readSnapshot);

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
  const racketReviews = index.reviewsByRacket.get(racket.id) ?? EMPTY_REVIEWS;
  const history = racket.variants
    .flatMap((v) => index.historyByVariant.get(v.id) ?? EMPTY_POINTS)
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn));

  return enrichRacket(
    racket,
    index.offersByRacket.get(racket.id) ?? EMPTY_OFFERS,
    racketReviews,
    history,
  );
}

/** Enrich one racket from either the full snapshot or the bounded detail read. */
function enrichRacket(
  racket: Racket,
  offers: readonly Offer[],
  racketReviews: readonly Review[],
  history: PricePoint[],
): RacketWithMarket {
  const liveOffers = offers.filter(
    (offer) => offer.status === "live" && offer.qtyAvailable > 0,
  );
  const score = courtScore(racket, racketReviews as Review[]);

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
  return (await loadIndex()).enriched;
});

/**
 * The brand list, read as the brand list.
 *
 * This is thirty-six rows of four columns and it used to arrive by loading the
 * entire catalogue — 9,4 MB across seven tables, the price history alone
 * thirty-five paged round trips — because it came off the snapshot. On
 * `/rackets` that is the *dynamic* half of the route, so it ran per request
 * against an in-memory cache that is per-instance and dies with every deploy.
 * The listing's own reads were already query-shaped and answered in ~126 ms;
 * this one call behind them is what closed the page at 23 s.
 *
 * `readCatalogBrands` is the whole task: one table, one round trip, one tag.
 * Nothing here reads rackets, offers or price points, and nothing may start.
 * `repository.test.ts` fails if it does.
 */
async function readCatalogBrands(): Promise<Brand[]> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.brands);

  const supabase = createStaticClient("brands-client");
  if (!supabase) return seed.brands;

  try {
    // `name` is the order the snapshot used, kept so the two sources still
    // answer identically; `id` breaks ties, because paging an order that is
    // not unique is what silently drops rows. Thirty-six brands make this one
    // round trip, and `selectAll` stops as soon as a short page arrives.
    const { data, error } = await selectAll((from, to) =>
      supabase.from("brands").select("*").order("name").order("id").range(from, to),
    );

    // An unmigrated project is the common case on a first run, and an empty
    // brand filter reads as a broken page rather than an unprovisioned one.
    if (error || !data?.length) return seed.brands;

    return data.map(mapBrand);
  } catch {
    return seed.brands;
  }
}

export const getBrands = cache(readCatalogBrands);

/**
 * The seller directory, and the guide list, read the same way as the brands
 * above and for the same reason.
 *
 * `/sellers`, `/guides` and every seller detail page's `generateStaticParams`
 * each needed one small table and each loaded all seven. Their document
 * timings — 3,09 s, 3,17 s — are that read, not their own work: `/methodology`
 * renders comparable markup from no database at all in 1,36 s.
 *
 * Both tables are well under PostgREST's 1000-row cap, so `selectAll` makes
 * exactly one round trip; it is here because the cap is silent when it is
 * reached and a directory that grows past it would otherwise truncate with no
 * error. The seed fallback answers an unprovisioned or unmigrated project, so
 * callers still cannot tell which source replied.
 *
 * Both now order by their primary key, which the snapshot did not. Neither
 * page sorts what it is given, so until now Supabase decided the running order
 * and was free to change it after any UPDATE — two renders of `/guides` could
 * disagree, and the homepage's `slice(0, 3)` could pick a different three.
 * Ordering by the key is what `selectAll` requires anyway, and it makes that
 * arbitrary order at least a stable one.
 */
async function readSellers(): Promise<Seller[]> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.sellers);

  const supabase = createStaticClient("sellers-client");
  if (!supabase) return seed.sellers;

  try {
    const { data, error } = await selectAll((from, to) =>
      supabase.from("sellers").select("*").order("id").range(from, to),
    );
    if (error || !data?.length) return seed.sellers;
    return data.map(mapSeller);
  } catch {
    return seed.sellers;
  }
}

export const getSellers = cache(readSellers);

async function readGuides(): Promise<Guide[]> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.guides);

  const supabase = createStaticClient("guides-client");
  if (!supabase) return seed.guides;

  try {
    const { data, error } = await selectAll((from, to) =>
      supabase.from("guides").select("slug,title_en,title_vi,excerpt_en,excerpt_vi,read_minutes,tone,has_content")
        .eq("published", true).eq("has_content", true)
        .order("published_at", { ascending: false, nullsFirst: false }).order("slug").range(from, to),
    );
    if (error) throw new Error("Guides could not be loaded");
    return (data ?? []).map(mapGuide);
  } catch {
    return [];
  }
}

export const getGuides = cache(readGuides);

type RpcRow = Record<string, unknown>;

type RacketCoreRead =
  | { status: "found"; racket: Racket }
  | { status: "missing" | "unavailable" };

interface RacketMarketData {
  racketId: string;
  offers: OfferWithSeller[];
  reviews: Review[];
  history: PricePoint[];
}

type RacketMarketRead =
  | { status: "found"; market: RacketMarketData }
  | { status: "missing" | "unavailable" };

export interface RacketDetail {
  racket: RacketWithMarket;
  offers: OfferWithSeller[];
  reviews: Review[];
  price: VariantPrice | null;
}

function rpcRecord(value: unknown): RpcRow | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RpcRow)
    : null;
}

function rpcRows(value: unknown): RpcRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is RpcRow => Boolean(rpcRecord(row)))
    : [];
}

/**
 * Read stable catalogue data for the one row a detail URL names.
 *
 * The RPC joins brand and racket in one indexed statement, removing the old
 * brand -> racket network waterfall. It returns every image for both legacy
 * equivalent slug rows, but only the fields the gallery renders or needs for
 * deterministic merging. Specifications and galleries use the long catalogue
 * cache and therefore stay warm when only prices change.
 */
async function readRacketCoreByPath(
  brandSlug: string,
  racketSlug: string,
): Promise<RacketCoreRead> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.brands, TAG.rackets);

  const supabase = createStaticClient("detail-core-client");
  if (!supabase) return { status: "unavailable" };

  try {
    const { data, error } = await supabase.rpc("get_racket_detail_core", {
      p_brand_slug: brandSlug,
      p_racket_slug: racketSlug,
    });
    if (error) throw new Error(error.message);

    const payload = rpcRecord(data);
    const status = payload?.status;
    if (status === "unavailable") return { status: "unavailable" };
    if (status === "missing") return { status: "missing" };
    if (!payload || status !== "found") throw new Error("malformed core RPC response");

    const rackets = mergeEquivalentRacketGalleries(
      rpcRows(payload.rackets).map((row) => mapRacket(row as never)),
    );
    const racket = rackets.find((candidate) => candidate.slug === racketSlug);
    if (!racket) throw new Error("core RPC omitted the requested racket");
    return { status: "found", racket };
  } catch (error) {
    console.warn(
      `[repository] racket detail core RPC failed for ${brandSlug}/${racketSlug}: ` +
        `${error instanceof Error ? error.message : "unknown error"}`,
    );
    return { status: "unavailable" };
  }
}

/**
 * Read the volatile half of a detail page independently of its gallery.
 *
 * Resolving the id inside the RPC means this starts at the same time as the
 * core RPC. One result contains live offers with their seller and variant,
 * published reviews, and the narrow price series the chart consumes.
 */
async function readRacketMarketByPath(
  brandSlug: string,
  racketSlug: string,
): Promise<RacketMarketRead> {
  "use cache";
  cacheLife("prices");
  cacheTag(TAG.sellers, TAG.offers, TAG.pricePoints, TAG.reviews);

  const supabase = createStaticClient("detail-market-client");
  if (!supabase) return { status: "unavailable" };

  try {
    const { data, error } = await supabase.rpc("get_racket_detail_market", {
      p_brand_slug: brandSlug,
      p_racket_slug: racketSlug,
    });
    if (error) throw new Error(error.message);

    const payload = rpcRecord(data);
    if (!payload) return { status: "missing" };
    const racketId = payload.racket_id;
    if (typeof racketId !== "string") throw new Error("malformed market RPC response");

    const offers = rpcRows(payload.offers)
      .map((row): OfferWithSeller | null => {
        const seller = rpcRecord(row.seller);
        const variant = rpcRecord(row.variant);
        if (!seller || !variant) return null;
        return {
          ...mapOffer(row as never),
          seller: mapSeller(seller as never),
          variant: mapVariant(variant as never),
        };
      })
      .filter((offer): offer is OfferWithSeller => Boolean(offer))
      .sort((a, b) => a.price - b.price);

    const reviews = rpcRows(payload.reviews)
      .map((row) => mapReview(row as never))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const history = rpcRows(payload.price_points)
      .map((row) => mapPricePoint(row as never))
      .sort((a, b) => a.observedOn.localeCompare(b.observedOn));

    return {
      status: "found",
      market: { racketId, offers, reviews, history },
    };
  } catch (error) {
    console.warn(
      `[repository] racket detail market RPC failed for ${brandSlug}/${racketSlug}: ` +
        `${error instanceof Error ? error.message : "unknown error"}`,
    );
    return { status: "unavailable" };
  }
}

const readRacketCore = cache(readRacketCoreByPath);
const readRacketMarket = cache(readRacketMarketByPath);

/** Stable detail data for metadata and other callers that need no prices. */
export async function getRacketCore(
  brandSlug: string,
  racketSlug: string,
): Promise<Racket | null> {
  const direct = await readRacketCore(brandSlug, racketSlug);
  if (direct.status === "found") return direct.racket;
  if (direct.status === "missing") return null;

  // An unconfigured or temporarily unavailable database still gets the seeded
  // fallback, preserving the repository's single public read contract.
  const index = await loadIndex();
  return index.enrichedByPath.get(`${brandSlug}/${racketSlug}`) ?? null;
}

/**
 * The complete initial detail payload. The two cache generations are
 * independent but begin together, so a cold page pays one parallel round-trip
 * window and a price invalidation does not evict specifications or images.
 */
export const getRacketDetail = cache(
  async (brandSlug: string, racketSlug: string): Promise<RacketDetail | null> => {
    const [core, market] = await Promise.all([
      readRacketCore(brandSlug, racketSlug),
      readRacketMarket(brandSlug, racketSlug),
    ]);

    if (
      core.status === "missing" ||
      (core.status === "found" && market.status === "missing")
    ) {
      return null;
    }

    if (
      core.status === "found" &&
      market.status === "found" &&
      core.racket.id === market.market.racketId
    ) {
      const { offers, reviews, history } = market.market;
      const racket = enrichRacket(core.racket, offers, reviews, history);
      return {
        racket,
        offers,
        reviews,
        price: headlineVariantPriceFromRows(racket, offers, history),
      };
    }

    // The fallback is intentionally the old full index. It is expensive, but
    // only runs when the RPC migration is absent, Supabase is unconfigured, or
    // an upstream request fails; normal detail traffic never builds it.
    const index = await loadIndex();
    const racket = index.enrichedByPath.get(`${brandSlug}/${racketSlug}`);
    if (!racket) return null;

    const [offers, reviews, price] = await Promise.all([
      getOffersForRacket(racket.id),
      getReviewsForRacket(racket.id),
      getHeadlineVariantPrice(racket),
    ]);
    return { racket, offers, reviews, price };
  },
);

/** Backwards-compatible rich racket read for repository consumers. */
export async function getRacket(
  brandSlug: string,
  racketSlug: string,
): Promise<RacketWithMarket | null> {
  return (await getRacketDetail(brandSlug, racketSlug))?.racket ?? null;
}

function mapRacketCardRow(row: RpcRow): RacketCardData | null {
  if (
    typeof row.id !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.brand_slug !== "string" ||
    typeof row.brand_name !== "string" ||
    typeof row.name !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    brandSlug: row.brand_slug,
    brandName: row.brand_name,
    name: row.name,
    releaseYear: Number(row.release_year),
    balancePointMm: Number(row.balance_point_mm),
    shaftFlex: row.shaft_flex as RacketCardData["shaftFlex"],
    msrp: Number(row.msrp),
    playStyleTags: (Array.isArray(row.play_style_tags)
      ? row.play_style_tags
      : []) as RacketCardData["playStyleTags"],
    heroImageUrl: typeof row.hero_image_url === "string" ? row.hero_image_url : null,
    heroThumbUrl: typeof row.hero_thumb_url === "string" ? row.hero_thumb_url : null,
    balanceType: row.balance_type as RacketCardData["balanceType"],
    lowestPrice: row.lowest_price === null ? null : Number(row.lowest_price),
    sellerCount: Number(row.seller_count ?? 0),
    variants: rpcRows(row.variants).map((variant) => ({
      weightClass: variant.weight_class as RacketVariant["weightClass"],
      weightGrams: Number(variant.weight_grams),
    })),
  };
}

async function readSimilarRackets(
  racketId: string,
  limit: number,
): Promise<RacketCardData[] | null> {
  "use cache";
  cacheLife("prices");
  cacheTag(TAG.rackets, TAG.offers);

  const supabase = createStaticClient("similar-rackets-client");
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.rpc("get_similar_rackets", {
      p_racket_id: racketId,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error("malformed similar-rackets RPC response");
    return rpcRows(data)
      .map(mapRacketCardRow)
      .filter((racket): racket is RacketCardData => Boolean(racket));
  } catch (error) {
    console.warn(
      `[repository] similar rackets RPC failed for ${racketId}: ` +
        `${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
}

const readSimilarRacketsCached = cache(readSimilarRackets);

function toRacketCardData(racket: RacketWithMarket): RacketCardData {
  return {
    id: racket.id,
    slug: racket.slug,
    brandSlug: racket.brandSlug,
    brandName: racket.brandName,
    name: racket.name,
    releaseYear: racket.releaseYear,
    balancePointMm: racket.balancePointMm,
    shaftFlex: racket.shaftFlex,
    msrp: racket.msrp,
    playStyleTags: racket.playStyleTags,
    heroImageUrl: racket.heroImageUrl,
    heroThumbUrl: racket.heroThumbUrl,
    balanceType: racket.balanceType,
    lowestPrice: racket.lowestPrice,
    sellerCount: racket.sellerCount,
    variants: racket.variants.map((variant) => ({
      weightClass: variant.weightClass,
      weightGrams: variant.weightGrams,
    })),
  };
}

/** Three card-shaped recommendations. Normal traffic uses the bounded RPC;
 *  the full-index calculation remains only as an unmigrated-project fallback. */
export async function getSimilarRackets(
  racketId: string,
  requestedLimit = 3,
): Promise<RacketCardData[]> {
  const finiteLimit = Number.isFinite(requestedLimit) ? requestedLimit : 3;
  const limit = Math.min(Math.max(Math.floor(finiteLimit), 1), 12);
  const direct = await readSimilarRacketsCached(racketId, limit);
  if (direct) return direct;

  const index = await loadIndex();
  const target = index.enriched.find((racket) => racket.id === racketId);
  if (!target) return [];

  return index.enriched
    .filter((racket) => racket.id !== target.id)
    .map((racket) => ({
      racket,
      distance:
        Math.abs(racket.balancePointMm - target.balancePointMm) +
        Math.abs(
          (racket.lowestPrice ?? racket.msrp) -
            (target.lowestPrice ?? target.msrp),
        ) /
          200_000,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ racket }) => toRacketCardData(racket));
}

export async function getRacketsBySlugs(
  slugs: string[],
): Promise<RacketWithMarket[]> {
  if (slugs.length === 0) return [];
  const index = await loadIndex();
  // Preserve the order the user picked them in.
  return slugs
    .map((slug) => index.enrichedBySlug.get(slug))
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

/**
 * Read the rackets behind a set of offers, in bounded batches.
 *
 * `RACKET_SELECT` already brings the variants along, so one read answers both
 * "which racket is this offer on" and "which variant". The batching is not
 * about rows: PostgREST takes `in()` as a query string, and one seller can
 * carry several hundred offers, which puts a single `in()` past the 8 KB
 * request line most proxies accept. A hundred ids is comfortably inside it.
 *
 * Same missing-column retry as `readRackets`: a deployment ahead of the
 * thumbnail migration degrades to "no thumbnails", never to "no listings".
 */
const HYDRATE_BATCH = 100;

async function readRacketsByIds(
  supabase: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, Racket>> {
  const byId = new Map<string, Racket>();

  for (let from = 0; from < ids.length; from += HYDRATE_BATCH) {
    const batch = ids.slice(from, from + HYDRATE_BATCH);
    const read = (select: string) =>
      supabase.from("rackets").select(select).in("id", batch);

    let { data, error } = await read(RACKET_SELECT);
    if (error && isMissingColumnError(error.message)) {
      ({ data, error } = await read(RACKET_SELECT_NO_THUMBS));
    }
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const racket = mapRacket(row as never);
      byId.set(racket.id, racket);
    }
  }

  return byId;
}

/**
 * One seller's listings, read as one seller's listings.
 *
 * This is the read behind the worst number in the baseline: `/vi/sellers/vnb`
 * answered in 0,89 s warm and **18,57 s cold**, because `loadIndex()` builds
 * the entire catalogue — every racket, every offer, every price point, every
 * review — to find the two hundred or so offers belonging to one shop. Warm
 * hid it, and `use cache` is per-instance in-memory, so cold is not the rare
 * case it looks like: every deploy changes the build ID and empties it.
 *
 * Now it reads the offers that name this seller, then the rackets those offers
 * name. Both are bounded by the shop, not by the catalogue.
 *
 * The snapshot path stays as the degraded mode for an unprovisioned or
 * unmigrated project, which is the same shape `getCatalogPage` uses and for
 * the same reason: the code has to deploy before the data is ready.
 */
export async function getOffersForSeller(
  sellerId: string,
): Promise<(OfferWithSeller & { racket: Racket })[]> {
  const direct = await readOffersForSeller(sellerId);
  if (direct) return direct;

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

async function readOffersForSeller(
  sellerId: string,
): Promise<(OfferWithSeller & { racket: Racket })[] | null> {
  "use cache";
  // Offers carry the prices, so they move on the scraper's schedule rather
  // than the catalogue's.
  cacheLife("prices");
  cacheTag(TAG.offers, TAG.sellers, TAG.rackets);

  const supabase = createStaticClient("seller-offers-client");
  if (!supabase) return null;

  try {
    // Every status, because the caller decides what "live" means for its own
    // page — the old index-backed read returned them all too.
    const { data: offerRows, error } = await selectAll((from, to) =>
      supabase
        .from("offers")
        .select("*")
        .eq("seller_id", sellerId)
        .order("id")
        .range(from, to),
    );
    if (error) throw new Error(error.message);

    // `readSellers` rather than `getSellers`: this is already inside a cached
    // scope, which has no request for React `cache` to dedupe against.
    const seller = (await readSellers()).find((s) => s.id === sellerId);
    if (!seller) return [];
    if (!offerRows?.length) return [];

    const offers = offerRows.map(mapOffer);
    const rackets = await readRacketsByIds(supabase, [
      ...new Set(offers.map((offer) => offer.racketId)),
    ]);

    const variantsById = new Map<string, RacketVariant>();
    for (const racket of rackets.values())
      for (const variant of racket.variants) variantsById.set(variant.id, variant);

    return offers
      .map((offer) => {
        const racket = rackets.get(offer.racketId);
        const variant = variantsById.get(offer.variantId);
        if (!racket || !variant) return null;
        return { ...offer, seller, variant, racket };
      })
      .filter((o): o is OfferWithSeller & { racket: Racket } => Boolean(o))
      .sort((a, b) => a.racket.name.localeCompare(b.racket.name));
  } catch (error) {
    console.warn(
      `[repository] seller offers fell back to the snapshot: ` +
        `${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
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

/** Re-exported so callers keep importing the price shape from the repository,
 *  while the arithmetic stays in a module `scripts/refresh-market.ts` can also
 *  import — `repository.ts` is `server-only`. */
export type { VariantPrice };

/**
 * Shape one variant's price series. The points arrive already sorted from the
 * index, which is why there is no `.sort()` here — `getDeals` calls this once
 * per variant, and sorting the whole price table 3.265 times was most of what
 * made the deals page expensive.
 */
function variantPrice(index: Index, variantId: string): VariantPrice | null {
  const points = index.historyByVariant.get(variantId);
  return points ? variantPriceFromPoints(variantId, points) : null;
}

/** The detail RPC already returned these bounded rows, so do not consult the
 *  full catalogue index merely to choose one variant's line series. */
function headlineVariantPriceFromRows(
  racket: RacketWithMarket,
  offers: readonly Offer[],
  history: PricePoint[],
): VariantPrice | null {
  const offerCounts = new Map<string, number>();
  for (const offer of offers) {
    if (offer.status !== "live") continue;
    offerCounts.set(offer.variantId, (offerCounts.get(offer.variantId) ?? 0) + 1);
  }

  const historyByVariant = new Map<string, PricePoint[]>();
  for (const point of history) push(historyByVariant, point.variantId, point);
  for (const points of historyByVariant.values())
    points.sort((a, b) => a.observedOn.localeCompare(b.observedOn));

  const candidates = racket.variants.filter((variant) =>
    historyByVariant.has(variant.id),
  );
  if (candidates.length === 0) return null;

  const headline = [...candidates].sort(
    (a, b) =>
      (offerCounts.get(b.id) ?? 0) - (offerCounts.get(a.id) ?? 0) ||
      a.weightGrams - b.weightGrams,
  )[0];

  return variantPriceFromPoints(headline.id, historyByVariant.get(headline.id) ?? []);
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

/* -------------------------------------------------------------- deals */

/**
 * `racket` is card-shaped, not the full enriched racket.
 *
 * Neither deal surface renders a spec profile, a player half or a price
 * history — they render a name, a brand, a balance, a price and a delta. The
 * narrower type is what lets `deal_watch` be answered from the `racket_market`
 * view instead of from the enriched index, and tsc is the thing that keeps the
 * claim true: widen a usage and this stops compiling.
 */
export interface Deal {
  racket: CatalogRacket;
  variantId: string;
  price: VariantPrice;
}

/**
 * Price drops, steepest first.
 *
 * The in-memory version below is the definition and it reads every price point
 * there is — 3,3 MB across 35 paged round trips, growing by ~3.265 rows on
 * every scrape — to answer a question the homepage asks for three rows of.
 * `deal_watch` holds the answer, written by `scripts/refresh-market.ts` with
 * the same `variantPriceFromPoints` this file uses, so there is one formula.
 *
 * `limit` is what makes the projection worth having: the homepage asks for
 * three and gets three rows and three rackets, not a catalogue.
 *
 * The snapshot path stays as the degraded mode — an unprovisioned project, a
 * database behind the migration, a `refresh-market` that has not run yet. Same
 * shape as `getCatalogPage`, and the same reason: the code deploys first.
 */
export async function getDeals(limit?: number): Promise<Deal[]> {
  const projected = await readDealWatch(limit);
  if (projected) return projected;

  const index = await loadIndex();
  const deals: Deal[] = [];

  for (const racket of index.enriched) {
    for (const variant of racket.variants) {
      const price = variantPrice(index, variant.id);
      if (!price) continue;
      if (isPriceDrop(price)) {
        deals.push({ racket, variantId: variant.id, price });
      }
    }
  }

  deals.sort((a, b) => bySteepestDrop(a.price, b.price));
  return limit === undefined ? deals : deals.slice(0, limit);
}

/** One stored row of `deal_watch`. `recent_points` is the bounded trailing
 *  window the sparkline draws — see the migration's comment on the column. */
interface DealWatchRow {
  variant_id: string;
  racket_id: string;
  latest: number;
  delta_30: number;
  median_30: number;
  delta_90: number;
  recent_points: { d: string; p: number }[] | null;
}

async function readDealWatch(limit?: number): Promise<Deal[] | null> {
  "use cache";
  cacheLife("prices");
  cacheTag(TAG.pricePoints, TAG.rackets, TAG.offers);

  const supabase = createStaticClient("deals-client");
  if (!supabase) return null;

  try {
    // Ordered in Postgres by the index this migration adds, and cut there too
    // when the caller said how many it wants. `variant_id` breaks ties on
    // `delta_30`, because paging an order that is not total is what puts one
    // row on two pages and another on none.
    const page = (from: number, to: number) =>
      supabase
        .from("deal_watch")
        .select("*")
        .order("delta_30", { ascending: true })
        .order("variant_id", { ascending: true })
        .range(from, to);

    const { data, error } =
      limit === undefined
        ? await selectAll<DealWatchRow>(page)
        : await page(0, limit - 1);

    if (error) {
      if (/deal_watch|schema cache|does not exist/i.test(error.message)) {
        console.warn(
          "[repository] deal_watch is missing, so price drops are being " +
            "computed from the whole price table. Apply supabase/migrations/" +
            "20260912000000_deal_watch.sql and run " +
            "`npx tsx scripts/refresh-market.ts`.",
        );
      } else {
        console.warn(`[repository] deal_watch query failed: ${error.message}`);
      }
      return null;
    }

    const rows = (data ?? []) as DealWatchRow[];
    // An empty table is indistinguishable from one `refresh-market` has not
    // filled yet, and "no deals today" is a plausible answer that would hide a
    // missing job. Fall back rather than publish an empty page from a guess.
    if (rows.length === 0) return null;

    const rackets = await readMarketRacketsByIds(supabase, [
      ...new Set(rows.map((row) => row.racket_id)),
    ]);
    // The view could not answer, so neither can this. Falling back keeps the
    // page whole instead of dropping the rackets the lookup missed.
    if (!rackets) return null;

    const deals: Deal[] = [];
    for (const row of rows) {
      const racket = rackets.get(row.racket_id);
      if (!racket) continue;
      deals.push({
        racket,
        variantId: row.variant_id,
        price: {
          variantId: row.variant_id,
          latest: row.latest,
          median30: row.median_30,
          delta30: row.delta_30,
          delta90: row.delta_90,
          points: (row.recent_points ?? []).map((point) => ({
            variantId: row.variant_id,
            observedOn: point.d,
            price: point.p,
          })),
        },
      });
    }

    return deals;
  } catch (error) {
    console.warn(
      `[repository] deals fell back to the snapshot: ` +
        `${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
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
    case "popular":
      return copy.sort(
        (a, b) => comparePopularBrandTiers(a, b) || byScore(a, b),
      );
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

/* --------------------------------------------------------- catalogue page */

/**
 * One page of the catalogue, paginated where the rows are.
 *
 * This is the only function the listing route should call. It asks Postgres for
 * 24 rows and a total (`catalog-page.ts`), and falls back to filtering the
 * in-memory snapshot when the view is not there to answer — an unprovisioned
 * project, a database behind `20260906000000_catalogue_pagination.sql`, or any
 * query error. Both routes return the same shape, so the page never branches on
 * which one answered; `source` is reported for the benchmark's benefit, not for
 * the UI's.
 *
 * The fallback is not a second read path in the sense CLAUDE.md forbids: it is
 * this function's own degraded mode, behind this function's own signature, and
 * it reuses the same `filterRackets`/`sortRackets` predicates the fast path
 * expresses as SQL.
 */
export async function getCatalogPage(
  filters: CatalogFilters,
  page: number,
  pageSize: number,
): Promise<CatalogPage> {
  const fromView = await readCatalogPageFromView(filters, page, pageSize);
  if (fromView) return { ...fromView, source: "view" };

  const all = await getRackets();
  const matched = sortRackets(filterRackets(all, filters), filters.sort);
  const counts = facetCounts(all, filters);
  const toRecord = <T extends string>(map: Map<T, number>): Record<string, number> =>
    Object.fromEntries(map.entries());

  return {
    rackets: matched.slice((page - 1) * pageSize, page * pageSize),
    total: matched.length,
    page,
    facets: {
      brands: toRecord(counts.brands),
      weightClasses: toRecord(counts.weightClasses),
      balanceTypes: toRecord(counts.balanceTypes),
      flexes: toRecord(counts.flexes),
    },
    source: (await loadSnapshot()).source === "seed" ? "seed" : "snapshot",
  };
}

/**
 * How many rackets a filter set matches. Used only by the empty state, which
 * needs a number to make its advice worth following.
 */
export async function countCatalogMatches(
  filters: CatalogFilters,
): Promise<number> {
  const fromView = await countCatalogMatchesInView(filters);
  if (fromView !== null) return fromView;
  return countFilteredRackets(await getRackets(), filters);
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

/* --------------------------------------------------------------- homepage */

export interface HomepageData {
  /** Court Score order, highest first. */
  trending: CatalogRacket[];
  /** Steepest price drops, steepest first. */
  deals: Deal[];
  guides: Guide[];
  counts: {
    rackets: number;
    liveOffers: number;
    verifiedSellers: number;
  };
}

/** How many of each the homepage renders. Here rather than in the page so the
 *  read is bounded by the same numbers the layout is. */
const HOME_TRENDING = 4;
const HOME_DEALS = 3;
const HOME_GUIDES = 3;

/**
 * Everything the homepage renders, and nothing else.
 *
 * It used to call `getRackets()`, `getDeals()`, `getGuides()` and
 * `loadSnapshot()` — four calls that are one read, the whole catalogue: 3.010
 * rackets with their variants and galleries, every offer, every review and the
 * entire price table. 9,4 MB and ~6,6 s from a laptop in the database's own
 * region, to render four cards, three rows, three links and three numbers.
 *
 * Three of the four now have a bounded source — `racket_market` for trending,
 * `deal_watch` for the drops, the guides table for the guides — and the three
 * statistics are three `head: true` counts, which return a number and no rows
 * at all.
 *
 * Every part falls back independently. A missing view costs the trending set
 * its fast path, not the homepage its counts.
 */
async function readHomepageData(): Promise<HomepageData> {
  const [trending, deals, guides, counts] = await Promise.all([
    readTopRacketsByScore(HOME_TRENDING),
    getDeals(HOME_DEALS),
    readGuides(),
    readHomepageCounts(),
  ]);

  return {
    trending: trending ?? (await trendingFromSnapshot()),
    deals,
    guides: guides.slice(0, HOME_GUIDES),
    counts,
  };
}

export const getHomepageData = cache(readHomepageData);

/** The degraded path for an unprovisioned project or a database behind the
 *  catalogue migration — the same ranking, computed in memory. */
async function trendingFromSnapshot(): Promise<CatalogRacket[]> {
  const rackets = await getRackets();
  return rackets
    .filter((racket) => racket.courtScore !== null)
    .sort((a, b) => (b.courtScore ?? 0) - (a.courtScore ?? 0))
    .slice(0, HOME_TRENDING);
}

/**
 * The three numbers in the hero, as three counts.
 *
 * `head: true` asks PostgREST for the count and no rows, so each of these is a
 * number over the wire rather than a table. The predicates match what the
 * snapshot filtered on: live offers, and sellers past the `new` tier.
 */
async function readHomepageCounts(): Promise<HomepageData["counts"]> {
  "use cache";
  cacheLife("prices");
  cacheTag(TAG.rackets, TAG.offers, TAG.sellers);

  const supabase = createStaticClient("home-counts-client");
  if (!supabase) {
    return {
      rackets: seed.rackets.length,
      liveOffers: seed.offers.filter((offer) => offer.status === "live").length,
      verifiedSellers: seed.sellers.filter((seller) => seller.tier !== "new").length,
    };
  }

  try {
    const [rackets, liveOffers, verifiedSellers] = await Promise.all([
      supabase.from("rackets").select("id", { count: "exact", head: true }),
      supabase
        .from("offers")
        .select("id", { count: "exact", head: true })
        .eq("status", "live"),
      supabase
        .from("sellers")
        .select("id", { count: "exact", head: true })
        .neq("tier", "new"),
    ]);

    const failure = [rackets, liveOffers, verifiedSellers].find((r) => r.error);
    if (failure?.error) throw new Error(failure.error.message);

    return {
      rackets: rackets.count ?? 0,
      liveOffers: liveOffers.count ?? 0,
      verifiedSellers: verifiedSellers.count ?? 0,
    };
  } catch (error) {
    console.warn(
      `[repository] homepage counts fell back to the seed: ` +
        `${error instanceof Error ? error.message : "unknown error"}`,
    );
    return {
      rackets: seed.rackets.length,
      liveOffers: seed.offers.filter((offer) => offer.status === "live").length,
      verifiedSellers: seed.sellers.filter((seller) => seller.tier !== "new").length,
    };
  }
}
