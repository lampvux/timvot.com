/**
 * Editorial priority for the catalogue's default browse experience.
 *
 * Rackets from these established brands share one leading tier so the first
 * page can still show a useful mix of manufacturers. The order below is used
 * by the brand filter, where a fixed sequence is easier to scan.
 */
export const POPULAR_BRAND_SLUGS = [
  "yonex",
  "li-ning",
  "victor",
  "mizuno",
] as const;

const popularBrandOrder = new Map<string, number>(
  POPULAR_BRAND_SLUGS.map((slug, index) => [slug, index]),
);

export function comparePopularBrandTiers(
  a: { brandSlug: string },
  b: { brandSlug: string },
): number {
  const aIsPopular = popularBrandOrder.has(a.brandSlug);
  const bIsPopular = popularBrandOrder.has(b.brandSlug);
  return Number(bIsPopular) - Number(aIsPopular);
}

export function orderBrandsByPopularity<T extends { slug: string; name: string }>(
  brands: readonly T[],
): T[] {
  const fallbackRank = POPULAR_BRAND_SLUGS.length;

  return [...brands].sort(
    (a, b) =>
      (popularBrandOrder.get(a.slug) ?? fallbackRank) -
        (popularBrandOrder.get(b.slug) ?? fallbackRank) ||
      a.name.localeCompare(b.name),
  );
}
