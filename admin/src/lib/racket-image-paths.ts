export interface RacketImagePathTarget {
  brandSlug: string;
  racketSlug: string;
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export function modelSlugOf(racketSlug: string, brandSlug: string) {
  const prefix = `${brandSlug}-`;
  return racketSlug.startsWith(prefix)
    ? racketSlug.slice(prefix.length)
    : racketSlug;
}

export function racketImageFolder(target: RacketImagePathTarget) {
  return `${target.brandSlug}/${modelSlugOf(target.racketSlug, target.brandSlug)}`;
}

export function storagePathMatchesRacket(
  storagePath: string,
  target: RacketImagePathTarget,
) {
  return storagePath.startsWith(`${racketImageFolder(target)}/`);
}

export function extensionForContentType(contentType: string) {
  return CONTENT_TYPE_EXTENSIONS[contentType.toLowerCase()] ?? "jpg";
}

function safeFileName(path: string, fallback: string) {
  const name = path.split("/").at(-1)?.trim() || fallback;
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || fallback;
}

export function relocatedRacketImagePath(
  currentPath: string,
  target: RacketImagePathTarget,
  fallbackFileName: string,
) {
  return `${racketImageFolder(target)}/${safeFileName(currentPath, fallbackFileName)}`;
}

export function racketImageUploadPath({
  target,
  position,
  checksum,
  contentType,
  nonce,
}: {
  target: RacketImagePathTarget;
  position: number;
  checksum: string;
  contentType: string;
  nonce: string;
}) {
  const order = String(position).padStart(2, "0");
  const extension = extensionForContentType(contentType);
  return `${racketImageFolder(target)}/${order}-${checksum.slice(0, 8)}-${nonce}.${extension}`;
}

export function thumbnailPathFor(storagePath: string) {
  return `${storagePath.replace(/\.[^./]+$/, "")}-thumb.webp`;
}
