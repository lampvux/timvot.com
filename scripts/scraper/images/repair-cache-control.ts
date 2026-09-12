/**
 * Give the stored images the cache lifetime their paths already earn.
 *
 *   npx tsx scripts/scraper/images/repair-cache-control.ts            # report only
 *   npx tsx scripts/scraper/images/repair-cache-control.ts --apply
 *   npx tsx scripts/scraper/images/repair-cache-control.ts --apply --all
 *   npx tsx scripts/scraper/images/repair-cache-control.ts --apply --limit=200
 *
 * READ THIS BEFORE EXPECTING IT TO CHANGE A RESPONSE HEADER.
 *
 * Every object in this bucket is served `Cache-Control: no-cache`, so a
 * catalogue page re-fetches its 24 card thumbnails from Singapore on every
 * view. The obvious diagnosis — that the objects predate `storage.ts` asking
 * for `cacheControl: "31536000"`, and that Supabase writes cache metadata at
 * upload time — is wrong, and this script is what proved it wrong.
 *
 * After a full run the stored metadata reads exactly `max-age=31536000`, and
 * the response still says `no-cache` — on the CDN, on a cache-busted MISS, and
 * on the authenticated endpoint that does not go through the CDN at all. The
 * project's storage tier does not honour per-object `cacheControl`; honouring
 * it is a Smart CDN feature. **No change in this repository can fix the served
 * header.** That is a plan decision, not a code one.
 *
 * What running this still buys:
 *
 *   - The metadata becomes correct, so the day the project moves to a tier
 *     that honours it, every object already carries a one-year lifetime and
 *     nothing has to be re-uploaded to get one.
 *   - It repairs `max-age=max-age=31536000`, which is what
 *     `migrate-supabase-project.ts` wrote on everything it moved between
 *     projects — Supabase stores the rendered header but `upload()` prepends
 *     `max-age=` itself, so copying the stored value back doubled it. That
 *     value is not parseable, so those objects would stay uncached even on a
 *     tier that honours the header. `--all` includes them; the default
 *     thumbnail scope does not.
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

  const after = await fetch(`${publicUrl}?cb=${Date.now()}`, { method: "HEAD" });
  const served = after.headers.get("cache-control") ?? "(none)";
  console.log(
    `\nSample now answers: Cache-Control: ${served} ` +
      `· CF-Cache-Status: ${after.headers.get("cf-cache-status") ?? "(none)"}`,
  );

  if (!served.includes(ONE_YEAR)) {
    // Expected on a tier that does not honour per-object cacheControl. Say so
    // plainly rather than leaving a successful-looking run that changed no
    // response — the metadata is right and the platform is what is left.
    console.log(
      "\nThe stored metadata is now correct, but this project's storage tier " +
        "does not honour it: the response is unchanged. Verify with\n" +
        "  curl -sI '<public url>?cb=1' | grep -i cache-control\n" +
        "Honouring per-object cacheControl is a Smart CDN feature. Nothing in " +
        "this repository can change that header.",
    );
  }

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
