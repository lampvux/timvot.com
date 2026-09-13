/**
 * Reconcile every object in the image buckets against the galleries that are
 * supposed to own them, and report which rackets a stored photograph could
 * legitimately be given to.
 *
 *   npm run images:reconcile                     # report only
 *   npm run images:reconcile -- --apply          # link what is safe to link
 *   npm run images:reconcile -- --apply --adopt-copies
 *
 * `images:audit` answers "does what the database claims still exist?" — it
 * walks from the rows outwards. This walks the other way: from the bytes in the
 * bucket back to the catalogue, which is the direction that finds a racket
 * showing an empty gallery while its folder is full of photographs.
 *
 * The storage layout is `<brand>/<model-slug>/<nn>-<sha8>.<ext>`, and the model
 * slug is the racket slug with its brand prefix stripped (`modelSlugOf`), so a
 * folder names a racket without a lookup table. That is what makes the sweep
 * possible at all — and it is also why the naive reading of it is wrong.
 *
 * ------------------------------------------------------------------
 * Why an unreferenced object is usually NOT a missing gallery
 *
 * A folder full of objects that no row points at looks like a gallery that lost
 * its rows. Nearly always it is one of three kinds of residue, and attaching it
 * to the racket the folder names would put another product's photography on a
 * page:
 *
 *   * Ownership repair. `20260903000000_enforce_racket_image_ownership.sql`
 *     deleted the losing rows when one manufacturer page had been matched to
 *     two catalogue records — ASTROX 22 RX's page belongs to `astrox-22-rx`,
 *     not to `astrox-22` — and deliberately kept the objects so the repair
 *     stays reversible. The loser's folder still holds a byte-identical copy of
 *     the winner's gallery.
 *
 *   * Re-crawls. When a racket's gallery is replaced the old rows go and the
 *     old objects are removed best-effort; a failed remove is swallowed rather
 *     than failing a multi-hour crawl. What is left is a superseded photograph.
 *
 *   * The old provider-first layout, before `relayout.ts` moved it.
 *
 * The test that separates residue from a genuinely orphaned gallery is the
 * content hash, which the key carries in its first eight characters: if some
 * other racket's row already owns an object with that hash, these bytes are a
 * copy of that racket's photograph and belong to it, whatever the folder is
 * named. Only bytes that no row anywhere owns can be linked, and only to a
 * racket that has no gallery of its own.
 *
 * Provenance is the second thing `--apply` has to get right. `source_url` and
 * `source_page_url` are not null and are the audit trail, and an object sitting
 * in the bucket does not carry which manufacturer page it was crawled from.
 * Copying a neighbouring row's page URL would be a guess *and* would collide
 * with the one-page-one-racket trigger, so a recovered row says what is
 * actually true: provider `storage-recovered`, and the object's own public URL
 * as its source. A reader of that row can see it was reconstructed rather than
 * crawled, and the next `scrape:images` run replaces it with the real thing.
 *
 * Nothing here deletes. Residue is reported with the racket that owns those
 * bytes, so the two rows can be compared before anyone decides whether they are
 * the same frame under two names; `relayout.ts --prune-orphans` is what removes
 * objects once that decision is made.
 *
 * ------------------------------------------------------------------
 * --adopt-copies
 *
 * After `duplicate-rackets.ts` merged the rows that were one racket written
 * twice, what is left in the `owned-elsewhere` pile is different: a base model
 * whose folder holds a copy of a *suffixed sibling's* gallery. Astrox 22's
 * folder holds Astrox 22 RX's photographs; Thruster Ryuga II's holds the TD's.
 * Those are genuinely different frames, so the September repair was right to
 * take the rows away — and the base model has no manufacturer gallery of its
 * own, because the manufacturer no longer publishes a page for it.
 *
 * `--adopt-copies` gives the base model the sibling's photographs anyway. It is
 * a deliberate editorial trade, not a repair: an empty product page is worse
 * than one showing a frame from the same family in a slightly different paint,
 * and these frames are usually identical but for the finish. It stays behind
 * its own flag because it is the one thing here that knowingly shows a racket a
 * photograph that is not of it.
 *
 * The invariant the September migration installed is not touched. That trigger
 * forbids two rackets claiming one *manufacturer page*, and an adopted row does
 * not claim one: its provenance is the Storage folder, as `storage-recovered`,
 * which is both true and unique to the folder. A later crawl that finds a real
 * page for the base model replaces these rows with the genuine gallery.
 */

import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "../env";
import { modelSlugOf } from "./targets";

const PAGE_SIZE = 1000;

/* ------------------------------------------------------------------ types */

export interface RacketRef {
  id: string;
  slug: string;
  name: string;
  brandSlug: string;
}

export interface GalleryRow {
  racketId: string;
  bucket: string;
  storagePath: string;
  thumbPath: string | null;
  sourceUrl: string;
  sourcePageUrl: string;
  provider: string;
  colourway: string | null;
}

export interface StoredObject {
  bucket: string;
  path: string;
}

/** Why an unreferenced object was or was not linked. */
export type Verdict =
  /** No row anywhere owns these bytes, and the folder's racket has no gallery. */
  | "linkable"
  /** Same content hash as a photograph another racket's gallery already owns. */
  | "owned-elsewhere"
  /** A gallery is already recorded out of this folder; this is left-over bytes. */
  | "superseded"
  /** More than one racket answers to the folder and none has a gallery. */
  | "ambiguous"
  /** The folder names no racket in the catalogue. */
  | "unclaimed";

export interface Finding {
  folder: string;
  /** Unreferenced originals in the folder (thumbnails follow their original). */
  objects: string[];
  verdict: Verdict;
  /** The racket the folder names and that has no gallery, when there is one. */
  target?: RacketRef;
  /** For `owned-elsewhere`: the racket whose gallery already holds these bytes. */
  owner?: RacketRef;
  /** For `ambiguous`: every gallery-less racket the folder answers to. */
  candidates?: RacketRef[];
}

export interface ReconcileInput {
  rackets: RacketRef[];
  rows: GalleryRow[];
  objects: StoredObject[];
}

/* -------------------------------------------------------------- pure core */

/** The bucket folder a racket's gallery is stored under. */
export function folderFor(racket: RacketRef): string {
  return `${racket.brandSlug}/${modelSlugOf(racket.slug, racket.brandSlug)}`;
}

/**
 * The content hash a key carries, or null when the key is not ours.
 *
 * `storage.ts` writes `<nn>-<sha8>.<ext>` and the thumbnail beside it as
 * `<nn>-<sha8>-thumb.webp`, so eight characters of the sha256 are readable
 * without downloading the object. Eight hex characters is four billion values
 * against a bucket of a few thousand photographs — and a collision would only
 * ever cause a refusal to link, never a wrong link.
 */
export function hashOf(path: string): string | null {
  const match = /\/\d+-([0-9a-f]{8})(-thumb)?\.[a-z0-9]+$/.exec(path);
  return match ? match[1] : null;
}

export function isThumbnail(path: string): boolean {
  return /-thumb\.[a-z0-9]+$/.test(path);
}

function folderOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/**
 * Classify every object no `racket_images` row points at.
 *
 * One finding per folder rather than per object: a gallery is crawled, stored
 * and lost as a unit, and a report that lists 166 objects instead of 34 folders
 * hides the only thing a reader needs to decide — which racket these belong to.
 */
export function reconcile(input: ReconcileInput): Finding[] {
  const racketsByFolder = new Map<string, RacketRef[]>();
  for (const racket of input.rackets) {
    const folder = folderFor(racket);
    const group = racketsByFolder.get(folder) ?? [];
    group.push(racket);
    racketsByFolder.set(folder, group);
  }

  const racketsById = new Map(input.rackets.map((racket) => [racket.id, racket]));
  const referenced = new Set<string>();
  const withGallery = new Set<string>();
  /** content hash → the racket whose gallery owns an object with that hash. */
  const ownerByHash = new Map<string, string>();
  /** folder → the racket whose gallery was recorded out of it. */
  const recordedFolders = new Map<string, string>();

  for (const row of input.rows) {
    referenced.add(row.storagePath);
    if (row.thumbPath) referenced.add(row.thumbPath);
    withGallery.add(row.racketId);

    const hash = hashOf(row.storagePath);
    if (hash && !ownerByHash.has(hash)) ownerByHash.set(hash, row.racketId);

    const folder = folderOf(row.storagePath);
    if (!recordedFolders.has(folder)) recordedFolders.set(folder, row.racketId);
  }

  const strayByFolder = new Map<string, string[]>();
  for (const object of input.objects) {
    if (referenced.has(object.path)) continue;
    if (isThumbnail(object.path)) continue; // judged with its original
    const folder = folderOf(object.path);
    const group = strayByFolder.get(folder) ?? [];
    group.push(object.path);
    strayByFolder.set(folder, group);
  }

  const findings: Finding[] = [];

  for (const [folder, objects] of [...strayByFolder].sort(([a], [b]) => a.localeCompare(b))) {
    objects.sort();
    const claimants = racketsByFolder.get(folder) ?? [];
    const target = claimants.find((racket) => !withGallery.has(racket.id));

    // Bytes win over folder names. A copy of a photograph another racket's
    // gallery owns is that racket's photograph, whatever folder it sits in.
    const ownerId = objects
      .map((path) => hashOf(path))
      .map((hash) => (hash ? ownerByHash.get(hash) : undefined))
      .find((racketId): racketId is string => Boolean(racketId));
    if (ownerId) {
      findings.push({
        folder,
        objects,
        verdict: "owned-elsewhere",
        owner: racketsById.get(ownerId),
        target,
      });
      continue;
    }

    // A gallery was recorded out of this folder and these bytes were not part
    // of it: a photograph the crawl superseded, or one whose row never landed.
    // Either way it belongs to the racket that was stored here — handing it to
    // a duplicate catalogue row that happens to answer to the same folder would
    // give that row one stray photograph and hide the duplication.
    const recorded = recordedFolders.get(folder);
    if (recorded) {
      findings.push({
        folder,
        objects,
        verdict: "superseded",
        owner: racketsById.get(recorded),
        target: target && target.id !== recorded ? target : undefined,
      });
      continue;
    }

    if (claimants.length === 0) {
      findings.push({ folder, objects, verdict: "unclaimed" });
      continue;
    }

    const gallerless = claimants.filter((racket) => !withGallery.has(racket.id));
    if (gallerless.length === 0) {
      findings.push({ folder, objects, verdict: "superseded", owner: claimants[0] });
      continue;
    }
    if (gallerless.length > 1) {
      findings.push({ folder, objects, verdict: "ambiguous", candidates: gallerless });
      continue;
    }

    findings.push({ folder, objects, verdict: "linkable", target: gallerless[0] });
  }

  return findings;
}

/* ------------------------------------------------------------------- i/o */

interface Options {
  apply: boolean;
  adoptCopies: boolean;
  bucket: string | null;
}

function parseArgs(): Options {
  const flags: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    flags[key] = value === undefined ? true : value;
  }
  return {
    apply: Boolean(flags.apply),
    adoptCopies: Boolean(flags["adopt-copies"]),
    bucket: typeof flags.bucket === "string" ? flags.bucket : null,
  };
}

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

/**
 * Every object in a bucket, walking into folders as the listing reports them.
 *
 * Storage's list answers with an error rather than a short page when it is
 * under load, so each page is retried before the walk is abandoned — the same
 * retry `audit.ts` needs for the same reason.
 */
async function listObjects(supabase: SupabaseClient, bucket: string): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  const folders = [""];

  while (folders.length > 0) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      type Entry = { id: string | null; name: string; metadata: unknown };
      let page: Entry[] | null = null;
      let lastError = "unknown Storage error";
      for (let attempt = 1; attempt <= 4; attempt++) {
        const result = await supabase.storage.from(bucket).list(folder, {
          limit: PAGE_SIZE,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (!result.error) {
          page = (result.data ?? []) as unknown as Entry[];
          break;
        }
        lastError = result.error.message;
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
      if (page === null) throw new Error(`Listing ${bucket}/${folder}: ${lastError}`);

      for (const entry of page) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.id === null && entry.metadata === null) folders.push(path);
        else objects.push({ bucket, path });
      }
      if (page.length < PAGE_SIZE) break;
    }
  }

  return objects;
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

/** Recovered rows are labelled, so nobody later reads one as a crawl result. */
const RECOVERED_PROVIDER = "storage-recovered";

/**
 * Write the rows for one linkable folder, and elect the first as its hero.
 *
 * The full checksum is read back from the object rather than reconstructed from
 * the eight characters in the key: `racket_images.checksum` is the dedupe key
 * the next crawl compares against, and a truncated hash there would make every
 * re-crawl store the photograph again. The racket has no gallery — that is what
 * `linkable` means — so `rackets.hero_image_url` is null and has to be filled
 * in too, or the card stays blank while the detail page fills up.
 */
async function link(
  supabase: SupabaseClient,
  bucket: string,
  finding: Finding,
  objectPaths: Set<string>,
): Promise<number> {
  const racket = finding.target!;
  const publicUrl = (path: string) =>
    supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  let written = 0;
  let hero: { publicUrl: string; thumbUrl: string | null } | null = null;

  for (const path of finding.objects) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) {
      console.log(`    ! ${path}: ${error?.message ?? "could not be downloaded"}`);
      continue;
    }
    const body = new Uint8Array(await data.arrayBuffer());
    const checksum = createHash("sha256").update(body).digest("hex");
    const extension = (path.split(".").pop() ?? "jpg").toLowerCase();
    const thumbPath = path.replace(/\.[^./]+$/, "-thumb.webp");
    const hasThumb = objectPaths.has(thumbPath);
    const isHero = hero === null;

    const { error: insertError } = await supabase.from("racket_images").insert({
      id: `ri-${racket.id}-${checksum.slice(0, 12)}`,
      racket_id: racket.id,
      provider: RECOVERED_PROVIDER,
      source_url: publicUrl(path),
      source_page_url: publicUrl(finding.folder),
      storage_bucket: bucket,
      storage_path: path,
      public_url: publicUrl(path),
      thumb_path: hasThumb ? thumbPath : null,
      thumb_url: hasThumb ? publicUrl(thumbPath) : null,
      position: written,
      is_hero: isHero,
      content_type: CONTENT_TYPES[extension] ?? "image/jpeg",
      bytes: body.byteLength,
      checksum,
      colourway: null,
    });
    if (insertError) {
      console.log(`    ! ${path}: ${insertError.message}`);
      continue;
    }
    if (isHero) hero = { publicUrl: publicUrl(path), thumbUrl: hasThumb ? publicUrl(thumbPath) : null };
    written++;
  }

  if (hero) {
    const { error } = await supabase
      .from("rackets")
      .update({ hero_image_url: hero.publicUrl, hero_thumb_url: hero.thumbUrl })
      .eq("id", racket.id);
    if (error) console.log(`    ! ${racket.id} hero pointer: ${error.message}`);
  }

  return written;
}

function describe(finding: Finding): string {
  switch (finding.verdict) {
    case "linkable":
      return `→ ${finding.target!.id} (${finding.target!.name})`;
    case "owned-elsewhere":
      return `bytes belong to ${finding.owner?.id ?? "another racket"}${
        finding.owner ? ` (${finding.owner.name})` : ""
      }${finding.target ? `; ${finding.target.id} has no gallery of its own` : ""}`;
    case "superseded":
      return `${finding.owner?.id ?? "the racket"}'s gallery was recorded out of this folder${
        finding.target ? `; ${finding.target.id} has no gallery of its own` : ""
      }`;
    case "ambiguous":
      return `${finding.candidates!.map((racket) => racket.id).join(", ")} all answer to this folder`;
    case "unclaimed":
      return "no racket in the catalogue answers to this folder";
  }
}

const REPORT_ORDER: Verdict[] = [
  "linkable",
  "ambiguous",
  "unclaimed",
  "owned-elsewhere",
  "superseded",
];

async function main(): Promise<void> {
  loadEnv();
  const options = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL/key is missing from .env or .env.local");
  if (options.apply && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("--apply writes racket_images and needs SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, key);

  const [brands, racketRows, imageRows] = await Promise.all([
    readAll<{ id: string; slug: string }>(supabase, "brands", "id, slug"),
    readAll<{ id: string; slug: string; name: string; brand_id: string }>(
      supabase,
      "rackets",
      "id, slug, name, brand_id",
    ),
    readAll<Record<string, string | null>>(
      supabase,
      "racket_images",
      "id, racket_id, storage_bucket, storage_path, thumb_path, source_url, " +
        "source_page_url, provider, colourway",
    ),
  ]);

  const brandSlugs = new Map(brands.map((brand) => [brand.id, brand.slug]));
  const rackets: RacketRef[] = racketRows
    .filter((racket) => brandSlugs.has(racket.brand_id))
    .map((racket) => ({
      id: racket.id,
      slug: racket.slug,
      name: racket.name,
      brandSlug: brandSlugs.get(racket.brand_id)!,
    }));

  const rows: GalleryRow[] = imageRows.map((row) => ({
    racketId: String(row.racket_id),
    bucket: String(row.storage_bucket),
    storagePath: String(row.storage_path),
    thumbPath: row.thumb_path === null ? null : String(row.thumb_path),
    sourceUrl: String(row.source_url),
    sourcePageUrl: String(row.source_page_url),
    provider: String(row.provider),
    colourway: row.colourway === null ? null : String(row.colourway),
  }));

  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) throw new Error(`Listing buckets: ${bucketError.message}`);
  const imageBuckets = (buckets ?? [])
    .map((bucket) => bucket.name)
    .filter((name) =>
      options.bucket ? name === options.bucket : name.startsWith("racket-images"),
    );
  if (imageBuckets.length === 0) throw new Error("No racket-images bucket found");

  const objects: StoredObject[] = [];
  for (const bucket of imageBuckets) {
    const found = await listObjects(supabase, bucket);
    console.log(`Inventorying ${bucket} … ${found.length} objects`);
    objects.push(...found);
  }

  const findings = reconcile({ rackets, rows, objects });
  const objectPaths = new Set(objects.map((object) => object.path));
  const bucketOf = new Map(objects.map((object) => [object.path, object.bucket]));
  const withGallery = new Set(rows.map((row) => row.racketId));

  console.log("=================================================");
  console.log("🔗 Storage → racket reconciliation");
  console.log("=================================================");
  console.log(`Rackets        : ${rackets.length}`);
  console.log(`With a gallery : ${withGallery.size}`);
  console.log(`Gallery rows   : ${rows.length}`);
  console.log(`Stored objects : ${objects.length}`);

  for (const verdict of REPORT_ORDER) {
    const group = findings.filter((finding) => finding.verdict === verdict);
    if (group.length === 0) continue;
    const objectCount = group.reduce((total, finding) => total + finding.objects.length, 0);
    console.log(`\n${verdict}: ${group.length} folder(s), ${objectCount} object(s)`);
    for (const finding of group) {
      console.log(`  ${finding.folder} (${finding.objects.length})  ${describe(finding)}`);
    }
  }

  const linkable = findings.filter((finding) => finding.verdict === "linkable");
  // A copy is adoptable only when the folder still names a racket that has no
  // gallery; once `duplicate-rackets.ts` has merged the rows that were one
  // racket written twice, what is left is a base model beside a suffixed
  // sibling's photographs.
  const adoptable = options.adoptCopies
    ? findings.filter((finding) => finding.verdict === "owned-elsewhere" && finding.target)
    : [];

  if (!options.apply) {
    console.log(`\nReport only. ${linkable.length} folder(s) can be linked.`);
    const copies = findings.filter(
      (finding) => finding.verdict === "owned-elsewhere" && finding.target,
    ).length;
    console.log(
      `Re-run with --apply to write them` +
        (copies
          ? `, or --apply --adopt-copies to additionally give ${copies} gallery-less racket(s) ` +
            "a sibling's photographs."
          : "."),
    );
    return;
  }

  let written = 0;
  for (const finding of [...linkable, ...adoptable]) {
    const how = finding.verdict === "linkable" ? "Linking" : "Adopting a copy for";
    console.log(`\n${how} ${finding.folder} → ${finding.target!.id}`);
    const bucket = bucketOf.get(finding.objects[0])!;
    written += await link(supabase, bucket, finding, objectPaths);
  }
  console.log(`\n✅ ${written} gallery row(s) written.`);
  if (written > 0) {
    console.log("Run `npm run images:audit` to confirm hero pointers are still in step.");
  }
}

if (process.argv[1]?.endsWith("reconcile.ts")) {
  main().catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
