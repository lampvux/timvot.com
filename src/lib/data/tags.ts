/**
 * Cache tags, one per table, named in one place.
 *
 * The repository tags its cached read with these; `scripts/scraper` asks the
 * app to revalidate them after a successful `--sync-db`. They are a contract
 * between a node script and a deployed route, so a typo on either side fails
 * silently — a price change that never appears. Import the constant, never
 * spell the string.
 *
 * No `server-only` here on purpose: the scraper is a node script outside the
 * Next build, and it has to be able to import this.
 */
export const TAG = {
  brands: "brands",
  rackets: "rackets",
  sellers: "sellers",
  offers: "offers",
  pricePoints: "price-points",
  reviews: "reviews",
  guides: "guides",
} as const;

export type CacheTag = (typeof TAG)[keyof typeof TAG];

export const ALL_TAGS = Object.values(TAG) as CacheTag[];

/** What a catalogue scrape actually changes. Brands and guides do not move on
 *  a price walk, so revalidating them would only throw away warm entries. */
export const SCRAPE_TAGS: CacheTag[] = [
  TAG.rackets,
  TAG.sellers,
  TAG.offers,
  TAG.pricePoints,
];

export function isCacheTag(value: string): value is CacheTag {
  return (ALL_TAGS as string[]).includes(value);
}
