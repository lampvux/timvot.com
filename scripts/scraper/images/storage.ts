/**
 * Where crawled images are put.
 *
 * `ImageStore` is an interface with one implementation, and the interface is
 * there for a specific reason rather than as decoration: the thing being stored
 * is a copy of someone else's asset, and the decision of *whose* object storage
 * holds it is a deployment decision, not a crawler decision. The crawler asks
 * for "put these bytes at this key and tell me the public URL"; Supabase
 * Storage is what answers today.
 *
 * ------------------------------------------------------------------
 * Layout
 *
 *   bucket:  racket-images                  (shared, the default)
 *            racket-images-<provider>       (--bucket-strategy=per-provider)
 *
 *   key:     <brand>/<racket-slug>/<nn>-<sha8>.<ext>
 *
 * The brand is the first path segment, so one manufacturer's assets are one
 * subtree — which is what makes "Victor asked us to take their photography
 * down" a single prefix delete rather than a query.
 *
 * The provider is not in the key. It used to be the first segment, which broke
 * exactly the property the layout exists for: a brand crawled from more than
 * one of its own sites was scattered across yonex/, yonex-uk/ and yonex-jp/,
 * and which folder a racket landed in was decided by which site matched it
 * first — an implementation detail of provider ordering, showing up in the
 * address of the bytes. Which site a photograph came from is provenance and is
 * recorded in `racket_images.provider`, where it can be queried.
 *
 * The filename carries the first eight characters of the content hash, so a
 * re-crawl that finds the same photograph writes the same key and overwrites
 * itself instead of accumulating `image-1.png`, `image-1-2.png`. The full hash
 * is the dedupe key in `racket_images`.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BucketStrategy = "shared" | "per-provider";

export interface StoredObject {
  bucket: string;
  path: string;
  publicUrl: string;
  checksum: string;
  bytes: number;
  contentType: string;
  /** Null when no thumbnail was supplied, or when storing it failed. The
   *  catalogue falls back to the original, so this is never fatal. */
  thumbPath: string | null;
  thumbUrl: string | null;
}

export interface PutRequest {
  provider: string;
  brandSlug: string;
  racketSlug: string;
  position: number;
  body: Uint8Array;
  contentType: string;
  /**
   * Card-sized copy of `body`, when one could be made. Stored beside the
   * original under the same key plus `-thumb.webp`, so the two are found and
   * deleted together — a takedown is still one prefix delete.
   */
  thumb?: { body: Uint8Array; contentType: string } | null;
  /**
   * sha256 of `body`, computed by the caller.
   *
   * The caller needs the hash *before* the put, to drop a photograph it has
   * already stored for this racket — and hashing 600 KB twice per image to
   * keep the interface tidier is not a trade worth making.
   */
  checksum: string;
}

export interface ImageStore {
  /** Human description for the run header. */
  describe(): string;
  /** Create whatever the layout needs, once, before the first put. */
  prepare(providers: string[]): Promise<void>;
  put(request: PutRequest): Promise<StoredObject>;
}

export function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.toLowerCase()] ?? "jpg";
}

/**
 * Sniff the real type from the magic bytes.
 *
 * Manufacturer CDNs lie about this constantly — Victor serves `.webp` files
 * whose upstream metadata still says `image/jpg`, and Magento's resize endpoint
 * answers `application/octet-stream` when the cache is cold. The bytes are the
 * only honest source, and getting it wrong means an object Supabase refuses on
 * its MIME allow-list, or a `.jpg` in the bucket that no browser will decode.
 */
export function sniffContentType(body: Uint8Array, declared: string): string {
  const b = body;
  if (b.length >= 12) {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
    // RIFF....WEBP
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
      return "image/webp";
    }
    // ....ftypavif
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (brand === "avif" || brand === "avis") return "image/avif";
    }
  }

  const normalised = declared.toLowerCase();
  return EXTENSIONS[normalised] ? (normalised === "image/jpg" ? "image/jpeg" : normalised) : "";
}

/**
 * Read the pixel dimensions from the header, without a decoder.
 *
 * Only the four container formats we accept, and only the fields needed. This
 * is worth the ~60 lines because "is this the 88×110 thumbnail or the 2000px
 * original" is the one quality question about a crawled gallery, and answering
 * it from stored metadata beats re-downloading to find out.
 */
export function readDimensions(body: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  // PNG: IHDR is always the first chunk, at a fixed offset.
  if (body.length > 24 && body[0] === 0x89 && body[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF: little-endian, straight after the header.
  if (body.length > 10 && body[0] === 0x47 && body[1] === 0x49) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // WebP: three sub-formats, each storing the size differently.
  if (body.length > 30 && body[0] === 0x52 && body[8] === 0x57) {
    const format = String.fromCharCode(body[12], body[13], body[14], body[15]);
    if (format === "VP8 ") {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (format === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (format === "VP8X") {
      const width = 1 + (body[24] | (body[25] << 8) | (body[26] << 16));
      const height = 1 + (body[27] | (body[28] << 8) | (body[29] << 16));
      return { width, height };
    }
  }

  // JPEG: walk the segment chain to the start-of-frame marker.
  if (body.length > 4 && body[0] === 0xff && body[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < body.length) {
      if (body[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = body[offset + 1];
      // SOF0…SOF15, excluding the DHT/JPG/DAC markers that share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }

  return null;
}

/**
 * The thumbnail sits beside its original, differing only in suffix:
 *
 *   yonex/astrox-88-s-pro/00-1a2b3c4d.jpg
 *   yonex/astrox-88-s-pro/00-1a2b3c4d-thumb.webp
 *
 * Same brand subtree, so "take Victor's photography down" is still one prefix
 * delete rather than two lists to reconcile.
 */
export function thumbKeyFor(path: string): string {
  // Only a real extension on the final segment. An unescaped `.` here matches
  // any character, which quietly ate the last path segment instead of the
  // suffix — `a/b/01-ff` became `a/b-thumb.webp`, a key in the wrong folder.
  return `${path.replace(/\.[^./]+$/, "")}-thumb.webp`;
}

/* ------------------------------------------------------ Supabase Storage */

export interface SupabaseStoreOptions {
  client: SupabaseClient;
  /** Base bucket name; the provider is appended under `per-provider`. */
  bucket: string;
  strategy: BucketStrategy;
  /** Report what would happen without creating buckets or uploading. */
  dryRun: boolean;
}

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const FILE_SIZE_LIMIT = 15 * 1024 * 1024;

export class SupabaseImageStore implements ImageStore {
  private readonly options: SupabaseStoreOptions;
  private readonly prepared = new Set<string>();

  constructor(options: SupabaseStoreOptions) {
    this.options = options;
  }

  describe(): string {
    const { bucket, strategy } = this.options;
    return strategy === "per-provider"
      ? `Supabase Storage, one bucket per provider (${bucket}-<provider>)`
      : `Supabase Storage, bucket "${bucket}", brand folders`;
  }

  bucketFor(provider: string): string {
    return this.options.strategy === "per-provider"
      ? `${this.options.bucket}-${provider}`
      : this.options.bucket;
  }

  pathFor(request: Omit<PutRequest, "body" | "contentType"> & { extension: string }): string {
    const position = String(request.position).padStart(2, "0");
    const name = `${position}-${request.checksum.slice(0, 8)}.${request.extension}`;

    // Racket slugs are brand-prefixed catalogue keys ("yonex-astrox-77-pro"),
    // and the brand is already a folder, so the prefix comes off here. Without
    // this every path reads `yonex/yonex/yonex-astrox-77-pro/`, which is three
    // ways of saying the same thing and makes the tree harder to skim.
    const model = request.racketSlug.startsWith(`${request.brandSlug}-`)
      ? request.racketSlug.slice(request.brandSlug.length + 1)
      : request.racketSlug;

    // The brand is the first segment under both strategies. The provider is
    // deliberately *not* in the key: it says which of a manufacturer's sites a
    // photograph came from, which is provenance and belongs in the
    // `racket_images.provider` column, not in the address of the bytes.
    //
    // Putting it in the path split every multi-property brand across several
    // top-level folders — Yonex over yonex/, yonex-uk/ and yonex-jp/, Mizuno
    // over mizuno-asia/, mizuno/ and mizuno-vn/ — so "everything we hold for
    // Yonex" was three prefixes, and which one a racket landed in depended on
    // which site happened to match it first. One brand is now one subtree,
    // which is what makes a takedown request a single prefix delete.
    return [request.brandSlug, model, name].join("/");
  }

  /**
   * Create the buckets the run will write to.
   *
   * The shared bucket is also created by the migration; this covers the sharded
   * layout, whose bucket names are not known until the run is configured, and
   * makes the crawler work on a project where the migration has not been
   * applied yet. `createBucket` on an existing bucket returns a duplicate
   * error, which is a success for our purposes.
   */
  async prepare(providers: string[]): Promise<void> {
    const buckets =
      this.options.strategy === "per-provider"
        ? providers.map((provider) => this.bucketFor(provider))
        : [this.options.bucket];

    for (const bucket of buckets) {
      if (this.prepared.has(bucket)) continue;
      this.prepared.add(bucket);

      if (this.options.dryRun) {
        console.log(`   would ensure bucket "${bucket}" (public, ${ALLOWED_MIME.length} image types)`);
        continue;
      }

      const { error } = await this.options.client.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: FILE_SIZE_LIMIT,
        allowedMimeTypes: ALLOWED_MIME,
      });

      if (error && !/already exists|duplicate/i.test(error.message)) {
        throw new Error(`Could not create bucket "${bucket}": ${error.message}`);
      }
      console.log(`   bucket "${bucket}" ready`);
    }
  }

  async put(request: PutRequest): Promise<StoredObject> {
    const { checksum } = request;
    const bucket = this.bucketFor(request.provider);
    const path = this.pathFor({
      provider: request.provider,
      brandSlug: request.brandSlug,
      racketSlug: request.racketSlug,
      position: request.position,
      checksum,
      extension: extensionFor(request.contentType),
    });

    const thumbPath = request.thumb ? thumbKeyFor(path) : null;

    if (this.options.dryRun) {
      return {
        bucket,
        path,
        publicUrl: `${bucket}/${path}`,
        checksum,
        bytes: request.body.byteLength,
        contentType: request.contentType,
        thumbPath,
        thumbUrl: thumbPath ? `${bucket}/${thumbPath}` : null,
      };
    }

    const { error } = await this.options.client.storage.from(bucket).upload(path, request.body, {
      contentType: request.contentType,
      // The key already contains the content hash, so an existing object at
      // this key holds these exact bytes. Upsert makes a re-run idempotent
      // instead of erroring on every image it has seen before.
      upsert: true,
      cacheControl: "31536000",
    });

    if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);

    const { data } = this.options.client.storage.from(bucket).getPublicUrl(path);

    // The thumbnail is an optimisation and its column is nullable, so a failure
    // here costs the card its small copy and nothing else. Losing the original
    // we just uploaded because the derived one would not store is not a trade
    // worth making, so this does not throw.
    let thumbUrl: string | null = null;
    if (request.thumb && thumbPath) {
      const { error: thumbError } = await this.options.client.storage
        .from(bucket)
        .upload(thumbPath, request.thumb.body, {
          contentType: request.thumb.contentType,
          upsert: true,
          cacheControl: "31536000",
        });

      if (thumbError) {
        console.warn(`   ⚠️  thumbnail ${bucket}/${thumbPath}: ${thumbError.message}`);
      } else {
        thumbUrl = this.options.client.storage.from(bucket).getPublicUrl(thumbPath)
          .data.publicUrl;
      }
    }

    return {
      bucket,
      path,
      publicUrl: data.publicUrl,
      checksum,
      bytes: request.body.byteLength,
      contentType: request.contentType,
      thumbPath: thumbUrl ? thumbPath : null,
      thumbUrl,
    };
  }
}
