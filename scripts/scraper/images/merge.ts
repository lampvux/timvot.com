export interface GalleryMergeRow {
  id: string;
  racket_id: string;
  provider: string;
  checksum: string;
  public_url: string | null;
  thumb_url: string | null;
  storage_bucket: string;
  storage_path: string;
  thumb_path: string | null;
  position: number;
  is_hero: boolean;
}

export interface ExistingGalleryMergeRow extends GalleryMergeRow {
  admin_managed: boolean;
}

export function isAdminManagedImage(
  image: Pick<ExistingGalleryMergeRow, "provider" | "admin_managed">,
) {
  return image.provider === "admin" || image.admin_managed;
}

/**
 * Merge one crawler result with the rows already curated in the admin app.
 *
 * Crawler-owned rows remain refreshable, but an uploaded or manually edited
 * row is an explicit editorial decision. Those rows survive replacement and
 * win checksum collisions. A still-valid hero also survives, whether it was
 * selected from a crawler gallery or uploaded by staff.
 */
export function planGalleryMerge<Incoming extends GalleryMergeRow>(
  existing: ExistingGalleryMergeRow[],
  incoming: Incoming[],
) {
  const incomingChecksums = new Set(incoming.map((image) => image.checksum));
  const protectedRows = existing.filter(isAdminManagedImage);
  const protectedChecksums = new Set(protectedRows.map((image) => image.checksum));
  const discardedIncoming = incoming.filter((image) => protectedChecksums.has(image.checksum));
  const incomingToWrite = incoming
    .filter((image) => !protectedChecksums.has(image.checksum))
    .map((image) => ({ ...image, is_hero: false }));
  const stale = existing.filter(
    (image) => !isAdminManagedImage(image) && !incomingChecksums.has(image.checksum),
  );

  const currentHero = existing.find((image) => image.is_hero && image.public_url);
  const retainedCurrentHero = currentHero && !stale.some((image) => image.id === currentHero.id)
    ? currentHero
    : null;
  let hero: GalleryMergeRow | null = null;

  if (retainedCurrentHero) {
    hero = isAdminManagedImage(retainedCurrentHero)
      ? retainedCurrentHero
      : incomingToWrite.find((image) => image.checksum === retainedCurrentHero.checksum) ?? retainedCurrentHero;
  }
  if (!hero) {
    hero = incomingToWrite.find((image) => image.public_url)
      ?? protectedRows
        .filter((image) => image.public_url)
        .toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0]
      ?? null;
  }

  return {
    stale,
    protectedRows,
    discardedIncoming,
    incomingToWrite,
    retainedCurrentHero,
    hero,
  };
}
