import sharp from "sharp";

/**
 * Card-sized copies, made once at crawl time.
 *
 * The catalogue grid renders a box about 400px across. The stored originals are
 * manufacturer photography — routinely 1500–2500px — and putting those through
 * `next/image` meant one billed transformation per distinct
 * (src, width, quality). Vercel Hobby allows 5.000 a month against 3.010 hero
 * images, and past the allowance the optimizer answers 402 and the card renders
 * its alt text: a visible product failure, not a slow page.
 *
 * The crawler already has the bytes in memory. Resizing here costs one pass
 * over an image we downloaded anyway, and the result is served straight from
 * Supabase Storage with `unoptimized`, so the grid stops touching the metered
 * path at all.
 */

/** Wide enough for a 2x render of the ~200px card box, and for the 384 entry
 *  in `images.imageSizes`, without being wide enough to be worth optimizing. */
export const THUMB_WIDTH = 400;

/** webp everywhere: universally supported now, and roughly a third of the
 *  bytes of the equivalent jpeg at this size. */
export const THUMB_CONTENT_TYPE = "image/webp";

export interface Thumbnail {
  body: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

/**
 * Returns `null` rather than throwing.
 *
 * A thumbnail is an optimisation, and the columns that hold it are nullable so
 * the app falls back to the original. A frame sharp cannot decode — a truncated
 * download, an animated gif, a format it was built without — must not cost the
 * crawler the full-size image it already fetched successfully.
 */
export async function makeThumbnail(
  body: Uint8Array,
  options: { width?: number; quality?: number } = {},
): Promise<Thumbnail | null> {
  const width = options.width ?? THUMB_WIDTH;

  try {
    const pipeline = sharp(body, { failOn: "error" }).resize({
      width,
      // Never upscale. A manufacturer thumbnail that is already 220px wide
      // stays 220px rather than being blown up to 400 and stored larger than
      // the original it was meant to replace.
      withoutEnlargement: true,
      fit: "inside",
    });

    const { data, info } = await pipeline
      .webp({ quality: options.quality ?? 78 })
      .toBuffer({ resolveWithObject: true });

    // If the "thumbnail" came out bigger than the source there is nothing to
    // gain by storing it, and a second object to keep in sync for no reason.
    if (data.byteLength >= body.byteLength) return null;

    return {
      body: new Uint8Array(data),
      contentType: THUMB_CONTENT_TYPE,
      width: info.width,
      height: info.height,
    };
  } catch {
    return null;
  }
}
