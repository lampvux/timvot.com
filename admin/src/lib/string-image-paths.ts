import { extensionForContentType } from "./racket-image-paths";

export interface StringImagePathTarget {
  brandSlug: string;
  stringSlug: string;
}

/** Strings are stored in their own bucket, never in `racket-images`. */
export const STRING_IMAGE_BUCKET = "string-images";

/** `<brand>/<string-slug>`, the folder one string's packshot lives in. */
export function stringImageFolder(target: StringImagePathTarget) {
  return `${target.brandSlug}/${target.stringSlug}`;
}

/**
 * A new object key per upload. The checksum prefix names the bytes and the
 * nonce keeps a re-upload of the same file from colliding with the object it
 * replaces, so the old one can be removed only after the row points at the
 * new one.
 */
export function stringImageUploadPath({
  target,
  checksum,
  contentType,
  nonce,
}: {
  target: StringImagePathTarget;
  checksum: string;
  contentType: string;
  nonce: string;
}) {
  return `${stringImageFolder(target)}/${checksum.slice(0, 8)}-${nonce}.${extensionForContentType(contentType)}`;
}

/** Where an upload came from: a real page when staff supply one. */
export function stringImageSource(value: string, uploadId: string) {
  const supplied = value.trim();
  if (!supplied || supplied === "admin-upload") return `admin-upload:${uploadId}`;
  return supplied;
}
