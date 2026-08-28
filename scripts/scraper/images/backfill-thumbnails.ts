/**
 * Give the images already in the bucket the thumbnails they were stored before.
 *
 * `scrape:images` writes a thumbnail beside every object it stores, but only
 * for images it stores *now*. A re-run skips rackets that already have a
 * gallery — that skip is the whole reason the crawler is re-runnable — so the
 * images crawled before thumbnails existed would never get one, and the
 * catalogue grid would keep sending them through the metered optimizer.
 *
 * `--refresh` would fix that by re-crawling every manufacturer site, which is
 * hours of external traffic to re-download bytes we already hold. This reads
 * them out of our own bucket instead: no manufacturer is contacted, nothing is
 * re-matched, and the catalogue rows are untouched apart from the two columns
 * this fills in.
 *
 * Safe to interrupt and re-run. It only ever looks at rows where `thumb_url`
 * is null, so a second pass picks up exactly what the first one did not finish.
 *
 *   npx tsx scripts/scraper/images/backfill-thumbnails.ts --dry-run
 *   npx tsx scripts/scraper/images/backfill-thumbnails.ts --limit=50
 *   npm run images:thumbs
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../env";
import { makeThumbnail } from "./thumbnail";
import { thumbKeyFor } from "./storage";

interface Options {
  dryRun: boolean;
  limit: number;
  concurrency: number;
}

interface Row {
  id: string;
  racket_id: string;
  storage_bucket: string;
  storage_path: string;
  is_hero: boolean;
}

function parseArgs(): Options {
  const flags: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    flags[key] = value === undefined ? true : value;
  }
  return {
    dryRun: Boolean(flags["dry-run"]),
    limit: flags.limit ? parseInt(String(flags.limit), 10) : Infinity,
    // Three at a time is enough to hide the round trips without giving Storage
    // a reason to rate-limit us.
    concurrency: flags.concurrency ? parseInt(String(flags.concurrency), 10) : 3,
  };
}

/** Every image still missing a thumbnail, oldest first. Paged, because
 *  PostgREST caps a response at 1000 rows and says nothing when it truncates. */
async function pendingRows(supabase: SupabaseClient, limit: number): Promise<Row[]> {
  const all: Row[] = [];
  const pageSize = 1000;

  for (let from = 0; all.length < limit; from += pageSize) {
    const { data, error } = await supabase
      .from("racket_images")
      .select("id, racket_id, storage_bucket, storage_path, is_hero")
      .is("thumb_url", null)
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Reading racket_images: ${error.message}`);
    if (!data || data.length === 0) break;

    all.push(...(data as Row[]));
    if (data.length < pageSize) break;
  }

  return all.slice(0, limit === Infinity ? undefined : limit);
}

interface Outcome {
  status: "done" | "skipped" | "failed";
  detail?: string;
  heroThumb?: { racketId: string; url: string };
}

async function backfillOne(
  supabase: SupabaseClient,
  row: Row,
  options: Options,
): Promise<Outcome> {
  const thumbPath = thumbKeyFor(row.storage_path);

  if (options.dryRun) {
    return { status: "skipped", detail: `would write ${row.storage_bucket}/${thumbPath}` };
  }

  // Straight from Storage with the service-role key rather than the public URL:
  // no CDN in the way, so a freshly written object is never a 404, and no
  // egress through the public path.
  const { data: file, error: downloadError } = await supabase.storage
    .from(row.storage_bucket)
    .download(row.storage_path);

  if (downloadError || !file) {
    return { status: "failed", detail: downloadError?.message ?? "no body" };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const thumb = await makeThumbnail(bytes);

  // Null is a real answer, not an error: sharp could not decode the frame, or
  // the source is already smaller than the thumbnail would be. Either way the
  // card falls back to the original, which is what the null column means.
  if (!thumb) return { status: "skipped", detail: "no smaller thumbnail possible" };

  const { error: uploadError } = await supabase.storage
    .from(row.storage_bucket)
    .upload(thumbPath, thumb.body, {
      contentType: thumb.contentType,
      upsert: true,
      cacheControl: "31536000",
    });

  if (uploadError) return { status: "failed", detail: uploadError.message };

  const publicUrl = supabase.storage.from(row.storage_bucket).getPublicUrl(thumbPath)
    .data.publicUrl;

  const { error: updateError } = await supabase
    .from("racket_images")
    .update({ thumb_path: thumbPath, thumb_url: publicUrl })
    .eq("id", row.id);

  if (updateError) return { status: "failed", detail: updateError.message };

  return {
    status: "done",
    heroThumb: row.is_hero ? { racketId: row.racket_id, url: publicUrl } : undefined,
  };
}

async function main() {
  const options = parseArgs();
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
        "   Storage writes and catalogue writes are admin-only under RLS.",
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(url, key);

  console.log("=================================================");
  console.log("🖼  Thumbnail backfill");
  console.log("=================================================");
  console.log(`Mode        : ${options.dryRun ? "dry run" : "apply"}`);
  console.log(`Concurrency : ${options.concurrency}`);
  if (options.limit !== Infinity) console.log(`Limit       : ${options.limit}`);
  console.log("=================================================\n");

  const rows = await pendingRows(supabase, options.limit);
  if (rows.length === 0) {
    console.log("Nothing to do — every stored image already has a thumbnail.");
    return;
  }
  console.log(`${rows.length} image(s) without a thumbnail.\n`);

  const heroThumbs = new Map<string, string>();
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let index = 0;

  async function worker() {
    while (index < rows.length) {
      const row = rows[index++];
      const at = index;
      try {
        const outcome = await backfillOne(supabase, row, options);
        if (outcome.status === "done") {
          done++;
          if (outcome.heroThumb) heroThumbs.set(outcome.heroThumb.racketId, outcome.heroThumb.url);
        } else if (outcome.status === "skipped") {
          skipped++;
        } else {
          failed++;
          console.log(`   ⚠️  ${row.storage_path}: ${outcome.detail}`);
        }
      } catch (err) {
        failed++;
        console.log(`   ⚠️  ${row.storage_path}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (at % 100 === 0 || at === rows.length) {
        console.log(`   ${at}/${rows.length}  done ${done}  skipped ${skipped}  failed ${failed}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, () => worker()),
  );

  // The hero's thumbnail is denormalised onto the racket so a card render needs
  // no join — the same reason `hero_image_url` is there.
  let heroesWritten = 0;
  if (!options.dryRun) {
    for (const [racketId, thumbUrl] of heroThumbs) {
      const { error } = await supabase
        .from("rackets")
        .update({ hero_thumb_url: thumbUrl })
        .eq("id", racketId);
      if (!error) heroesWritten++;
    }
  }

  console.log("\n-------------------------------------------------");
  console.log(`  thumbnails written : ${done}`);
  console.log(`  skipped            : ${skipped}`);
  console.log(`  failed             : ${failed}`);
  console.log(`  hero_thumb_url set : ${heroesWritten}/${heroThumbs.size} rackets`);
  console.log("-------------------------------------------------");

  // A partial run is worth re-running, not worth failing a pipeline over — the
  // rows it did not reach are simply still null next time.
  if (failed > 0) console.log("\nRe-run to retry the failures; finished rows are skipped.");
}

main().catch((err) => {
  console.error("Thumbnail backfill failed:", err);
  process.exit(1);
});
