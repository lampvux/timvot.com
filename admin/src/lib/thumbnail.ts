import "server-only";

import sharp from "sharp";

/**
 * A 400px WebP for list views, or null when the original is already smaller
 * than the thumbnail would be (then the original is served instead).
 *
 * Shared by racket gallery and string packshot uploads. It lives here rather
 * than in an actions file because every export of a "use server" module is a
 * callable endpoint, and this takes raw bytes.
 */
export async function makeThumbnail(bytes: Buffer) {
  try {
    const { data, info } = await sharp(bytes, { failOn: "error" })
      .resize({ width: 400, withoutEnlargement: true, fit: "inside" })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });

    if (data.byteLength >= bytes.byteLength) return null;
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}
