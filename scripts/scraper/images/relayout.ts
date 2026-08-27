/**
 * Move stored images from the old provider-first storage layout to the
 * brand-first one.
 *
 *   was:  <provider>/<brand>/<racket-slug>/<nn>-<sha8>.<ext>
 *   is:   <brand>/<racket-slug>/<nn>-<sha8>.<ext>
 *
 * A brand crawled from more than one of its own sites used to be split across
 * several top-level folders — Yonex over yonex/, yonex-uk/ and yonex-jp/,
 * Mizuno over mizuno-asia/, mizuno/ and mizuno-vn/ — and which folder a racket
 * landed in was decided by which property matched it first. That is provider
 * ordering, an implementation detail, showing up in the address of the bytes.
 *
 * Run it with no flags to see the plan; `--apply` performs it.
 *
 *   npx tsx scripts/scraper/images/relayout.ts
 *   npx tsx scripts/scraper/images/relayout.ts --apply
 *
 * Safe to re-run: a row already at its brand-first path is counted and skipped,
 * so an interrupted run is resumed by running it again.
 *
 * `--prune-orphans` additionally deletes objects in the bucket that no
 * `racket_images` row points at. Those are the residue of re-crawls: when a
 * racket's gallery is replaced the old rows are deleted and the old objects are
 * removed on a best-effort basis, and a failed remove is swallowed so a storage
 * hiccup cannot fail a multi-hour crawl. What it leaves behind is bytes nothing
 * references — and, after this move, bytes sitting in the old provider-first
 * folders, keeping `mizuno-asia/` and `victor/victor/` alive in the listing
 * long after the last row left them.
 *
 * The prune reads the whole table first and deletes only objects absent from
 * it. It is a separate flag from `--apply` because one is a move and the other
 * is a delete, and those deserve separate decisions.
 *
 * Each row is moved and then immediately updated, rather than moving everything
 * and rewriting the table at the end. An interruption then leaves every row
 * either fully migrated or fully untouched — never a `storage_path` pointing at
 * an object that has already moved out from under it.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "../env";
import { PROVIDERS } from "./providers";

interface Row {
  id: string;
  racket_id: string;
  provider: string;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
}

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

/**
 * The brand-first path for a row, or null if it is already there.
 *
 * Throws rather than guesses when the path is neither shape. A key that does
 * not parse is a key this script does not understand, and moving it on a
 * best-effort basis is how images get lost.
 */
function targetPath(row: Row, brandSlug: string): string | null {
  const segments = row.storage_path.split("/");

  if (segments.length === 3 && segments[0] === brandSlug) return null;

  if (segments.length !== 4) {
    throw new Error(`${row.id}: expected 3 or 4 path segments, got ${segments.length} (${row.storage_path})`);
  }
  if (!PROVIDER_IDS.has(segments[0])) {
    throw new Error(`${row.id}: leading segment "${segments[0]}" is not a known provider (${row.storage_path})`);
  }
  if (segments[1] !== brandSlug) {
    throw new Error(`${row.id}: path says brand "${segments[1]}", catalogue says "${brandSlug}" (${row.storage_path})`);
  }

  return segments.slice(1).join("/");
}

async function readRows(supabase: SupabaseClient): Promise<{ rows: Row[]; brandOf: Map<string, string> }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("racket_images")
      .select("id, racket_id, provider, storage_bucket, storage_path, public_url")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`racket_images: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const brandOf = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => r.racket_id))];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase
      .from("rackets")
      .select("id, brands ( slug )")
      .in("id", ids.slice(i, i + 500));
    if (error) throw new Error(`rackets: ${error.message}`);
    for (const r of (data ?? []) as unknown as {
      id: string;
      brands: { slug: string } | { slug: string }[] | null;
    }[]) {
      const brand = Array.isArray(r.brands) ? r.brands[0] : r.brands;
      if (brand?.slug) brandOf.set(r.id, brand.slug);
    }
  }

  return { rows, brandOf };
}

async function main(): Promise<void> {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const pruneOrphans = process.argv.includes("--prune-orphans");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { rows, brandOf } = await readRows(supabase);
  console.log(`${rows.length} image rows\n`);

  const plan: { row: Row; to: string }[] = [];
  let already = 0;

  for (const row of rows) {
    const brandSlug = brandOf.get(row.racket_id);
    if (!brandSlug) throw new Error(`${row.id}: no brand for racket ${row.racket_id}`);
    const to = targetPath(row, brandSlug);
    if (to === null) already++;
    else plan.push({ row, to });
  }

  // Two rows landing on one key would silently destroy an image, so the plan is
  // checked for collisions in full before a single object is touched.
  const byTarget = new Map<string, string[]>();
  for (const { row, to } of plan) {
    const key = `${row.storage_bucket}/${to}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), row.id]);
  }
  const collisions = [...byTarget].filter(([, ids]) => ids.length > 1);
  if (collisions.length > 0) {
    console.error("❌ two rows would land on one key — nothing moved:");
    for (const [key, ids] of collisions) console.error(`   ${key}  ←  ${ids.join(", ")}`);
    process.exit(1);
  }


  const fromFolders = new Map<string, number>();
  for (const { row } of plan) {
    const folder = row.storage_path.split("/")[0];
    fromFolders.set(folder, (fromFolders.get(folder) ?? 0) + 1);
  }
  console.log("folders being collapsed:");
  for (const [folder, n] of [...fromFolders].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${folder.padEnd(14)} ${String(n).padStart(4)} objects`);
  }
  console.log(`\nto move: ${plan.length}   already brand-first: ${already}`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to perform it.");
    for (const { row, to } of plan.slice(0, 3)) console.log(`   ${row.storage_path}\n     → ${to}`);
    if (pruneOrphans) await prune(supabase, false);
    return;
  }

  let moved = 0;
  let failed = 0;

  for (const { row, to } of plan) {
    const { error: moveError } = await supabase.storage.from(row.storage_bucket).move(row.storage_path, to);
    if (moveError && !/not found/i.test(moveError.message)) {
      console.error(`❌ move ${row.storage_path}: ${moveError.message}`);
      failed++;
      continue;
    }

    const publicUrl = supabase.storage.from(row.storage_bucket).getPublicUrl(to).data.publicUrl;
    const { error: rowError } = await supabase
      .from("racket_images")
      .update({ storage_path: to, public_url: publicUrl })
      .eq("id", row.id);
    if (rowError) {
      console.error(`❌ update ${row.id}: ${rowError.message}`);
      failed++;
      continue;
    }

    if (row.public_url) {
      await supabase
        .from("rackets")
        .update({ hero_image_url: publicUrl })
        .eq("id", row.racket_id)
        .eq("hero_image_url", row.public_url);
    }

    moved++;
    if (moved % 100 === 0) console.log(`   ${moved}/${plan.length}`);
  }

  console.log(`\nmoved ${moved}   failed ${failed}   already brand-first ${already}`);

  if (pruneOrphans) await prune(supabase, apply);
}

/** Every object in the bucket, depth-first. */
async function listAll(supabase: SupabaseClient, bucket: string, prefix: string, out: string[]): Promise<void> {
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    if (!data || data.length === 0) return;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Supabase returns a row with an id for an object and without one for a
      // prefix, which is the only way to tell a folder from a file here.
      if (entry.id) out.push(path);
      else await listAll(supabase, bucket, path, out);
    }

    if (data.length < 100) return;
    offset += data.length;
  }
}

/**
 * Delete objects no row points at.
 *
 * The whole table is read before a single delete, and the delete set is its
 * complement — never a per-object "is this still referenced?" question, which
 * would race a crawl writing rows underneath it.
 */
async function prune(supabase: SupabaseClient, apply: boolean): Promise<void> {
  const bucket = "racket-images";

  const objects: string[] = [];
  await listAll(supabase, bucket, "", objects);

  const tracked = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("racket_images")
      .select("storage_path")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`racket_images: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as { storage_path: string }[]) tracked.add(row.storage_path);
    if (data.length < 1000) break;
  }

  const orphans = objects.filter((path) => !tracked.has(path));
  console.log(`
${objects.length} objects, ${tracked.size} referenced, ${orphans.length} orphaned`);

  const byFolder = new Map<string, number>();
  for (const path of orphans) byFolder.set(path.split("/")[0], (byFolder.get(path.split("/")[0]) ?? 0) + 1);
  for (const [folder, n] of [...byFolder].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${folder.padEnd(14)} ${String(n).padStart(4)} orphaned`);
  }

  if (orphans.length === 0) return;
  if (!apply) {
    console.log("Dry run. --apply --prune-orphans deletes them.");
    return;
  }

  for (let i = 0; i < orphans.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(orphans.slice(i, i + 100));
    if (error) throw new Error(`remove: ${error.message}`);
  }
  console.log(`deleted ${orphans.length} orphaned object(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
