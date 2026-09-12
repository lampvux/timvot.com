/**
 * Give the stored images the cache lifetime their paths already earn.
 *
 *   npx tsx scripts/scraper/images/repair-cache-control.ts            # report only
 *   npx tsx scripts/scraper/images/repair-cache-control.ts --apply
 *   npx tsx scripts/scraper/images/repair-cache-control.ts --apply --all
 *   npx tsx scripts/scraper/images/repair-cache-control.ts --apply --limit=200
 *
 * The problem. `storage.ts` asks for `cacheControl: "31536000"` on every
 * upload, and the live public response says:
 *
 *     Cache-Control: no-cache
 *     CF-Cache-Status: MISS
 *
 * on every object sampled, anywhere in the bucket. The objects predate that
 * setting, and Supabase writes cache metadata at upload time — so asking for
 * it now does nothing for what is already there.
 *
 * What it costs. A catalogue page renders 24 cards from this bucket, and the
 * card thumbnails are served `unoptimized` straight from it. At ~9 KB each
 * that is ~220 KB re-fetched from the Singapore origin on every page view, by
 * every visitor, on every visit — never served from the CDN edge, never read
 * from the browser cache. It is the single largest repeat-visit cost on the
 * site and it is metadata, not bytes.
 *
 * Why a long TTL is safe here rather than merely convenient: every path
 * carries a content hash (`00-34d533a5-thumb.webp`). A changed image is a
 * changed key, so a year-long cache can never serve a stale picture — the
 * worst case is an orphaned object nobody references.
 *
 * How. Supabase's public API has no metadata-only update, so each object is
 * read and written back with `upsert`. Thumbnails only by default: they are
 * the hot path, ~9 KB each, and the originals are an order of magnitude more
 * bytes for a page nobody has opened yet. `--all` includes them.
 *
 * Reports and changes nothing unless `--apply` is passed. Needs
 * SUPABASE_SERVICE_ROLE_KEY: the bucket is public-read, admin-write.
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../env";

const BUCKET = "racket-images";
const ONE_YEAR = "31536000";
/** What a repaired object should answer with. */
const WANTED = `max-age=${ONE_YEAR}`;

const PAGE = 1000;
/** Objects repaired at once. Each is a read and a write, so this is a
 *  politeness bound on the storage API rather than a memory one. */
const CONCURRENCY = 6;

interface Options {
  apply: boolean;
  all: boolean;
  limit: number;
  verbose: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const limit = Number(value("limit") ?? Number.POSITIVE_INFINITY);
  return {
    apply: args.includes("--apply"),
    all: args.includes("--all"),
    limit: Number.isFinite(limit) ? limit : Number.POSITIVE_INFINITY,
    verbose: args.includes("--verbose"),
  };
}

/** Every object path in the bucket, walked depth-first. Storage `list` is one
 *  directory at a time, and this bucket is nested brand/model/file. */
async function listAll(
  supabase: SupabaseClient,
  prefix = "",
): Promise<string[]> {
  const found: string[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });

    if (error) throw new Error(`list ${prefix || "/"}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder comes back with no id. Storage has no real directories, so
      // this is the only thing that distinguishes one.
      if (entry.id === null) found.push(...(await listAll(supabase, path)));
      else found.push(path);
    }

    if (data.length < PAGE) break;
  }

  return found;
}

/** Read `path` and write it back unchanged, with the cache metadata set. */
async function repair(
  supabase: SupabaseClient,
  path: string,
): Promise<{ path: string; ok: boolean; error?: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    return { path, ok: false, error: error?.message ?? "download returned nothing" };
  }

  const body = Buffer.from(await data.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, {
      // Same bytes, same key, new metadata. `upsert` is the only way to reach
      // an existing object's cacheControl through the public API.
      upsert: true,
      contentType: data.type || undefined,
      cacheControl: ONE_YEAR,
    });

  if (uploadError) return { path, ok: false, error: uploadError.message };
  return { path, ok: true };
}

async function pooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= tasks.length) return;
        results[index] = await tasks[index]();
      }
    }),
  );
  return results;
}

async function main() {
  loadEnv();
  const options = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
        `The ${BUCKET} bucket is public-read and admin-write; an anon key cannot rewrite it.`,
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Listing ${BUCKET}…`);
  const all = await listAll(supabase);
  const targets = (options.all ? all : all.filter((p) => p.includes("-thumb.")))
    .slice(0, options.limit);

  console.log(
    `${all.length} objects · ${targets.length} in scope ` +
      `(${options.all ? "all" : "thumbnails only"})`,
  );

  // Check one before doing anything: if the bucket already answers correctly
  // there is nothing to repair, and re-uploading it all would be pure cost.
  const sample = targets[0];
  if (!sample) {
    console.log("Nothing in scope.");
    return;
  }

  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(sample).data.publicUrl;
  const head = await fetch(publicUrl, { method: "HEAD" });
  const current = head.headers.get("cache-control") ?? "(none)";
  console.log(`\nSample: ${sample}\n  now:  Cache-Control: ${current}\n  want: Cache-Control: ${WANTED}`);

  if (current.includes(ONE_YEAR)) {
    console.log("\nAlready repaired. Nothing to do.");
    return;
  }

  if (!options.apply) {
    console.log(
      `\n--apply not passed: nothing written.\n` +
        `Would rewrite ${targets.length} object(s), same bytes, cacheControl=${ONE_YEAR}.`,
    );
    return;
  }

  console.log(`\nRepairing ${targets.length} object(s)…`);
  let done = 0;
  const results = await pooled(
    targets.map((path) => async () => {
      const result = await repair(supabase, path);
      done += 1;
      if (options.verbose || done % 250 === 0)
        console.log(`  ${done}/${targets.length}`);
      return result;
    }),
    CONCURRENCY,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} repaired · ${failed.length} failed`);
  for (const f of failed.slice(0, 20)) console.error(`  ${f.path}: ${f.error}`);

  // The CDN still holds the old response until its own entry expires, so the
  // check below can legitimately disagree for a while.
  const after = await fetch(publicUrl, { method: "HEAD", cache: "no-store" });
  console.log(
    `\nSample now answers: Cache-Control: ${after.headers.get("cache-control") ?? "(none)"} ` +
      `· CF-Cache-Status: ${after.headers.get("cf-cache-status") ?? "(none)"}`,
  );

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
