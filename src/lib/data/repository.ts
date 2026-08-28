import "server-only";

import { cache } from "react";
import { createStaticClient } from "@/lib/supabase/server";
import { courtScore } from "@/lib/court-score";
import { balanceTypeOf, median } from "@/lib/format";
import type {
  Brand,
  CatalogFilters,
  Guide,
  Offer,
  OfferWithSeller,
  PricePoint,
  Racket,
  RacketWithMarket,
  Review,
  Seller,
} from "@/lib/types";
import * as seed from "./seed";
import {
  mapBrand,
  mapGuide,
  mapOffer,
  mapPricePoint,
  mapRacket,
  mapReview,
  mapSeller,
  RACKET_SELECT,
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

/** Deduped per request by React `cache`, so a page hits the DB once. */
export const loadSnapshot = cache(async (): Promise<Snapshot> => {
  const supabase = createStaticClient();
  if (!supabase) return seedSnapshot();

  try {
    const [brandRows, racketRows, sellerRows, offerRows, historyRows, reviewRows, guideRows] =
      await Promise.all([
        supabase.from("brands").select("*").order("name"),
        selectAll((from, to) =>
          supabase.from("rackets").select(RACKET_SELECT).order("id").range(from, to),
        ),
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
      rackets: (racketRows.data ?? []).map(mapRacket),
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
});

/* ------------------------------------------------------------ enrichment */

function enrich(snapshot: Snapshot, racket: Racket): RacketWithMarket {
  const variantIds = new Set(racket.variants.map((v) => v.id));
  const liveOffers = snapshot.offers.filter(
    (o) => o.racketId === racket.id && o.qtyAvailable > 0,
  );
  const racketReviews = snapshot.reviews.filter((r) => r.racketId === racket.id);
  const history = snapshot.history.filter((p) => variantIds.has(p.variantId));
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
  const snapshot = await loadSnapshot();
  return snapshot.rackets.map((racket) => enrich(snapshot, racket));
});

export const getBrands = cache(async (): Promise<Brand[]> => {
  return (await loadSnapshot()).brands;
});

export const getSellers = cache(async (): Promise<Seller[]> => {
  return (await loadSnapshot()).sellers;
});

export const getGuides = cache(async (): Promise<Guide[]> => {
  return (await loadSnapshot()).guides;
});

export async function getRacket(
  brandSlug: string,
  racketSlug: string,
): Promise<RacketWithMarket | null> {
  const rackets = await getRackets();
  return (
    rackets.find((r) => r.brandSlug === brandSlug && r.slug === racketSlug) ??
    null
  );
}

export async function getRacketsBySlugs(
  slugs: string[],
): Promise<RacketWithMarket[]> {
  if (slugs.length === 0) return [];
  const rackets = await getRackets();
  // Preserve the order the user picked them in.
  return slugs
    .map((slug) => rackets.find((r) => r.slug === slug))
    .filter((r): r is RacketWithMarket => Boolean(r));
}

export async function getOffersForRacket(
  racketId: string,
): Promise<OfferWithSeller[]> {
  const snapshot = await loadSnapshot();
  const sellers = new Map(snapshot.sellers.map((s) => [s.id, s]));
  const variants = new Map(
    snapshot.rackets.flatMap((r) => r.variants.map((v) => [v.id, v] as const)),
  );

  return snapshot.offers
    .filter((o) => o.racketId === racketId && o.status === "live")
    .map((offer) => {
      const seller = sellers.get(offer.sellerId);
      const variant = variants.get(offer.variantId);
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
  const snapshot = await loadSnapshot();
  const seller = snapshot.sellers.find((s) => s.id === sellerId);
  if (!seller) return [];

  const rackets = new Map(snapshot.rackets.map((r) => [r.id, r]));
  const variants = new Map(
    snapshot.rackets.flatMap((r) => r.variants.map((v) => [v.id, v] as const)),
  );

  return snapshot.offers
    .filter((o) => o.sellerId === sellerId)
    .map((offer) => {
      const racket = rackets.get(offer.racketId);
      const variant = variants.get(offer.variantId);
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
  const snapshot = await loadSnapshot();
  return snapshot.reviews
    .filter((r) => r.racketId === racketId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

export async function getVariantPrice(
  variantId: string,
): Promise<VariantPrice | null> {
  const snapshot = await loadSnapshot();
  const points = snapshot.history
    .filter((p) => p.variantId === variantId)
    .sort((a, b) => a.observedOn.localeCompare(b.observedOn));

  if (points.length === 0) return null;

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

/**
 * The variant a racket's headline price and chart are drawn from: the one the
 * most sellers actually stock, because that is the one a buyer is comparing.
 * Ties go to the lighter frame, which is the more common configuration.
 */
export async function getHeadlineVariantPrice(
  racket: RacketWithMarket,
): Promise<VariantPrice | null> {
  const snapshot = await loadSnapshot();
  const offerCounts = new Map<string, number>();
  for (const offer of snapshot.offers) {
    if (offer.racketId !== racket.id || offer.status !== "live") continue;
    offerCounts.set(offer.variantId, (offerCounts.get(offer.variantId) ?? 0) + 1);
  }

  const candidates = racket.variants.filter((variant) =>
    racket.history.some((point) => point.variantId === variant.id),
  );
  if (candidates.length === 0) return null;

  const headline = candidates.sort(
    (a, b) =>
      (offerCounts.get(b.id) ?? 0) - (offerCounts.get(a.id) ?? 0) ||
      a.weightGrams - b.weightGrams,
  )[0];

  return getVariantPrice(headline.id);
}

/* -------------------------------------------------------------- deals */

export interface Deal {
  racket: RacketWithMarket;
  variantId: string;
  price: VariantPrice;
}

export async function getDeals(): Promise<Deal[]> {
  const rackets = await getRackets();
  const deals: Deal[] = [];

  for (const racket of rackets) {
    for (const variant of racket.variants) {
      const price = await getVariantPrice(variant.id);
      if (!price) continue;
      if (price.latest < price.median30 && price.delta30 < 0) {
        deals.push({ racket, variantId: variant.id, price });
      }
    }
  }

  return deals.sort((a, b) => a.price.delta30 - b.price.delta30);
}

/* ------------------------------------------------------------ filtering */

export function applyFilters(
  rackets: RacketWithMarket[],
  filters: CatalogFilters,
): RacketWithMarket[] {
  const query = filters.query.trim().toLowerCase();

  const filtered = rackets.filter((racket) => {
    if (filters.brands.length && !filters.brands.includes(racket.brandSlug))
      return false;

    if (
      filters.weightClasses.length &&
      !racket.variants.some((v) => filters.weightClasses.includes(v.weightClass))
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

    if (query) {
      const haystack = `${racket.brandName} ${racket.name}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  return sortRackets(filtered, filters.sort);
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
    applyFilters(rackets, { ...filters, [key]: [] });

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
