import type { Seller, SellerTier } from "@/lib/types";

/**
 * How the /sellers directory ranks and filters.
 *
 * Every ranking is a measured number, never a paid position — the same
 * promise the Court Score makes. Tier is a filter, not a sort key, because
 * it is a trust category rather than a quantity; ordering "authorised"
 * above "verified" would read as the site vouching for one shop over another.
 *
 * The state lives in the URL (`?sort=`, `?city=`, `?tier=`) like the
 * catalogue's filters, so a ranked, filtered directory survives being pasted
 * into a chat. Unknown values fall back to the defaults rather than erroring.
 */

export interface SellerDirectoryEntry extends Seller {
  /** Distinct rackets with a live offer in stock. */
  racketCount: number;
  /** Live offers, in stock or not. */
  offerCount: number;
  /** Distinct brands across the in-stock rackets. */
  brandCount: number;
}

export const SELLER_SORTS = ["rackets", "rating", "brands", "tenure"] as const;
export type SellerSort = (typeof SELLER_SORTS)[number];
export const DEFAULT_SELLER_SORT: SellerSort = "rackets";

export const SELLER_TIERS: readonly SellerTier[] = ["authorised", "verified", "new"];

export interface SellerDirectoryQuery {
  sort: SellerSort;
  city: string | null;
  tier: SellerTier | null;
}

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export function parseSellerQuery(params: Params, cities: readonly string[]): SellerDirectoryQuery {
  const sort = first(params.sort);
  const city = first(params.city);
  const tier = first(params.tier);
  return {
    sort: (SELLER_SORTS as readonly string[]).includes(sort ?? "")
      ? (sort as SellerSort)
      : DEFAULT_SELLER_SORT,
    // Only a city some seller is actually in; anything else is ignored.
    city: city && cities.includes(city) ? city : null,
    tier: (SELLER_TIERS as readonly string[]).includes(tier ?? "")
      ? (tier as SellerTier)
      : null,
  };
}

/** The query string for a directory state, omitting defaults. */
export function sellerQueryString(query: SellerDirectoryQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.sort !== DEFAULT_SELLER_SORT) out.sort = query.sort;
  if (query.city) out.city = query.city;
  if (query.tier) out.tier = query.tier;
  return out;
}

/** Cities that have a seller, alphabetised in Vietnamese collation. */
export function sellerCities(sellers: readonly Seller[]): string[] {
  return [...new Set(sellers.map((seller) => seller.city))].sort((a, b) =>
    a.localeCompare(b, "vi"),
  );
}

/** An unrated seller (rating 0) is not a 0-star seller; it ranks last on rating. */
const ratingKey = (seller: SellerDirectoryEntry) => (seller.rating > 0 ? seller.rating : -1);

const COMPARE: Record<SellerSort, (a: SellerDirectoryEntry, b: SellerDirectoryEntry) => number> = {
  rackets: (a, b) => b.racketCount - a.racketCount,
  rating: (a, b) => ratingKey(b) - ratingKey(a),
  brands: (a, b) => b.brandCount - a.brandCount,
  // Longest on the platform first.
  tenure: (a, b) => a.since - b.since,
};

/**
 * Filter, then rank. Ties fall through to racket count, then rating, then
 * name, so two renders of the same URL always agree on the order.
 */
export function rankSellers(
  sellers: readonly SellerDirectoryEntry[],
  query: SellerDirectoryQuery,
): SellerDirectoryEntry[] {
  return sellers
    .filter((seller) => !query.city || seller.city === query.city)
    .filter((seller) => !query.tier || seller.tier === query.tier)
    .sort(
      (a, b) =>
        COMPARE[query.sort](a, b) ||
        COMPARE.rackets(a, b) ||
        COMPARE.rating(a, b) ||
        a.name.localeCompare(b.name, "vi"),
    );
}
