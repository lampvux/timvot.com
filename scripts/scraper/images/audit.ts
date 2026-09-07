/**
 * Reconcile racket/image ownership across the catalogue and Supabase Storage.
 *
 *   npm run images:audit                    # database + Storage inventory
 *   npm run images:audit -- --database-only # fast relational checks only
 *
 * The command never writes. It exits non-zero when a gallery is attached to a
 * conflicting product page, a Storage key disagrees with its database slugs,
 * a public URL is stale, a hero pointer is stale, or a referenced object is
 * missing. Unreferenced Storage objects are reported as cleanup candidates but
 * do not break the catalogue, so they remain warnings.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "../env";

interface BrandRow {
  id: string;
  slug: string;
}

interface RacketRow {
  id: string;
  slug: string;
  brand_id: string;
  hero_image_url: string | null;
  hero_thumb_url: string | null;
}

interface ImageRow {
  id: string;
  racket_id: string;
  source_page_url: string;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  thumb_path: string | null;
  thumb_url: string | null;
  position: number;
  is_hero: boolean;
}

interface StorageEntry {
  id: string | null;
  name: string;
  metadata: Record<string, unknown> | null;
}

const PAGE_SIZE = 1000;
const databaseOnly = process.argv.includes("--database-only");

async function readAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Reading ${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function modelSlug(racketSlug: string, brandSlug: string): string {
  const prefix = `${brandSlug}-`;
  return racketSlug.startsWith(prefix) ? racketSlug.slice(prefix.length) : racketSlug;
}

/**
 * Retailer hero URLs are allowed without a manufacturer gallery. A hero that
 * points into our own racket-image buckets is different: its object must be
 * represented by a racket_images row, even when an equivalent catalogue row
 * owns that gallery.
 */
function isRacketStorageUrl(url: string): boolean {
  try {
    const marker = "/storage/v1/object/public/";
    const path = new URL(url).pathname;
    const markerAt = path.indexOf(marker);
    if (markerAt < 0) return false;
    const bucket = path.slice(markerAt + marker.length).split("/", 1)[0];
    return bucket.startsWith("racket-images");
  } catch {
    return false;
  }
}

function show(label: string, issues: string[], limit = 20): void {
  console.log(`${label}: ${issues.length}`);
  for (const issue of issues.slice(0, limit)) console.log(`  - ${issue}`);
  if (issues.length > limit) console.log(`  … ${issues.length - limit} more`);
}

async function listObjects(supabase: SupabaseClient, bucket: string): Promise<Set<string>> {
  const objects = new Set<string>();
  const folders = [""];

  while (folders.length > 0) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let data: StorageEntry[] | null = null;
      let lastError = "unknown Storage error";
      for (let attempt = 1; attempt <= 4; attempt++) {
        const result = await supabase.storage.from(bucket).list(folder, {
          limit: PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (!result.error) {
          data = (result.data ?? []) as StorageEntry[];
          break;
        }

        lastError = result.error.message;
        if (attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
      if (data === null) throw new Error(`Listing ${bucket}/${folder}: ${lastError}`);

      for (const entry of data) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.id === null && entry.metadata === null) folders.push(path);
        else objects.add(path);
      }
      if (data.length < PAGE_SIZE) break;
    }
  }

  return objects;
}

async function main(): Promise<void> {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL/key is missing from .env or .env.local");

  const supabase = createClient(url, key);
  const [brands, rackets, images] = await Promise.all([
    readAll<BrandRow>(supabase, "brands", "id, slug"),
    readAll<RacketRow>(
      supabase,
      "rackets",
      "id, slug, brand_id, hero_image_url, hero_thumb_url",
    ),
    readAll<ImageRow>(
      supabase,
      "racket_images",
      "id, racket_id, source_page_url, storage_bucket, storage_path, public_url, thumb_path, thumb_url, position, is_hero",
    ),
  ]);

  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));
  const racketsById = new Map(rackets.map((racket) => [racket.id, racket]));
  const imagesByRacket = new Map<string, ImageRow[]>();
  const ownersByPage = new Map<string, Set<string>>();
  const expectedByBucket = new Map<string, Set<string>>();
  const knownOriginalUrls = new Set<string>();
  const knownThumbUrls = new Set<string>();
  const pathIssues: string[] = [];
  const urlIssues: string[] = [];

  for (const image of images) {
    const racket = racketsById.get(image.racket_id);
    const brand = racket ? brandsById.get(racket.brand_id) : undefined;
    if (!racket || !brand) {
      pathIssues.push(`${image.id}: missing racket or brand`);
      continue;
    }

    const expectedPrefix = `${brand.slug}/${modelSlug(racket.slug, brand.slug)}/`;
    if (!image.storage_path.startsWith(expectedPrefix)) {
      pathIssues.push(
        `${image.id}: ${image.storage_path} should start with ${expectedPrefix}`,
      );
    }
    if (image.thumb_path && !image.thumb_path.startsWith(expectedPrefix)) {
      pathIssues.push(
        `${image.id}: ${image.thumb_path} should start with ${expectedPrefix}`,
      );
    }

    const expectedPublicUrl = supabase.storage
      .from(image.storage_bucket)
      .getPublicUrl(image.storage_path).data.publicUrl;
    if (image.public_url && image.public_url !== expectedPublicUrl) {
      urlIssues.push(`${image.id}: original public URL does not match bucket/path`);
    }
    if (image.public_url) knownOriginalUrls.add(image.public_url);
    if (image.thumb_path && image.thumb_url) {
      const expectedThumbUrl = supabase.storage
        .from(image.storage_bucket)
        .getPublicUrl(image.thumb_path).data.publicUrl;
      if (image.thumb_url !== expectedThumbUrl) {
        urlIssues.push(`${image.id}: thumbnail public URL does not match bucket/path`);
      }
    }
    if (image.thumb_url) knownThumbUrls.add(image.thumb_url);

    const racketImages = imagesByRacket.get(image.racket_id) ?? [];
    racketImages.push(image);
    imagesByRacket.set(image.racket_id, racketImages);

    const pageOwners = ownersByPage.get(image.source_page_url) ?? new Set<string>();
    pageOwners.add(image.racket_id);
    ownersByPage.set(image.source_page_url, pageOwners);

    const expected = expectedByBucket.get(image.storage_bucket) ?? new Set<string>();
    expected.add(image.storage_path);
    if (image.thumb_path) expected.add(image.thumb_path);
    expectedByBucket.set(image.storage_bucket, expected);
  }

  const ownershipIssues = [...ownersByPage]
    .filter(([, owners]) => owners.size > 1)
    .map(([page, owners]) => `${page}: ${[...owners].join(", ")}`);
  const heroIssues: string[] = [];

  for (const racket of rackets) {
    if (
      racket.hero_image_url &&
      isRacketStorageUrl(racket.hero_image_url) &&
      !knownOriginalUrls.has(racket.hero_image_url)
    ) {
      heroIssues.push(
        `${racket.slug}: hero_image_url points to Storage but no gallery row owns it`,
      );
    }
    if (
      racket.hero_thumb_url &&
      isRacketStorageUrl(racket.hero_thumb_url) &&
      !knownThumbUrls.has(racket.hero_thumb_url)
    ) {
      heroIssues.push(
        `${racket.slug}: hero_thumb_url points to Storage but no gallery row owns it`,
      );
    }
  }

  for (const [racketId, gallery] of imagesByRacket) {
    gallery.sort(
      (a, b) =>
        Number(b.is_hero) - Number(a.is_hero) ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
    const hero = gallery[0];
    const racket = racketsById.get(racketId)!;
    if (racket.hero_image_url !== hero.public_url) {
      heroIssues.push(`${racket.slug}: hero_image_url differs from gallery hero`);
    }
    if (racket.hero_thumb_url !== hero.thumb_url) {
      heroIssues.push(`${racket.slug}: hero_thumb_url differs from gallery hero`);
    }
  }

  console.log("=================================================");
  console.log("🔎 Racket image ownership audit");
  console.log("=================================================");
  console.log(`Rackets      : ${rackets.length}`);
  console.log(`Gallery rows : ${images.length}`);
  console.log(`With gallery : ${imagesByRacket.size}`);
  show("Slug/path mismatches", pathIssues);
  show("Public URL mismatches", urlIssues);
  show("Source pages with multiple owners", ownershipIssues);
  show("Stale hero pointers", heroIssues);

  const missing: string[] = [];
  const orphaned: string[] = [];
  if (!databaseOnly) {
    for (const [bucket, expected] of expectedByBucket) {
      console.log(`Inventorying Storage bucket ${bucket} …`);
      const actual = await listObjects(supabase, bucket);
      for (const path of expected) {
        if (!actual.has(path)) missing.push(`${bucket}/${path}`);
      }
      for (const path of actual) {
        if (!expected.has(path)) orphaned.push(`${bucket}/${path}`);
      }
      console.log(`  ${actual.size} objects; ${expected.size} referenced`);
    }
    show("Missing Storage objects", missing);
    show("Unreferenced Storage objects (warning)", orphaned);
  } else {
    console.log("Storage inventory: skipped (--database-only)");
  }

  const failures =
    pathIssues.length +
    urlIssues.length +
    ownershipIssues.length +
    heroIssues.length +
    missing.length;
  if (failures > 0) throw new Error(`Audit found ${failures} catalogue-breaking issue(s)`);
  console.log("\n✅ Database slugs, galleries, hero pointers, and referenced objects agree.");
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
