export interface RacketTarget {
  id: string;
  slug: string;
  name: string;
  brandSlug: string;
  brandName: string;
  /** Database ids that describe the same brand/model identity. */
  equivalentIds: string[];
}

/**
 * The retailer catalogue historically used brand-prefixed racket slugs while
 * the hand-authored seed used model-only slugs. The public route already has a
 * brand segment, so both of these describe the same racket:
 *
 *   yonex/nanoflare-800-pro
 *   yonex/yonex-nanoflare-800-pro
 */
export function modelSlugOf(slug: string, brandSlug: string): string {
  const prefix = `${brandSlug}-`;
  return slug.startsWith(prefix) ? slug.slice(prefix.length) : slug;
}

/**
 * Crawl an equivalent brand/model only once. Prefer the model-only row when it
 * exists because that is the canonical public route used by the seeded
 * catalogue, reviews, and editorial content.
 */
export function collapseEquivalentRacketTargets(
  targets: RacketTarget[],
): RacketTarget[] {
  const groups = new Map<string, RacketTarget[]>();

  for (const target of targets) {
    const key = `${target.brandSlug}/${modelSlugOf(target.slug, target.brandSlug)}`;
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort((a, b) => {
      const aPrefixed = a.slug.startsWith(`${a.brandSlug}-`) ? 1 : 0;
      const bPrefixed = b.slug.startsWith(`${b.brandSlug}-`) ? 1 : 0;
      return aPrefixed - bPrefixed || a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id);
    });
    const chosen = ordered[0];

    return {
      ...chosen,
      equivalentIds: [...new Set(ordered.flatMap((target) => target.equivalentIds))],
    };
  });
}
