/**
 * Import string packshots from `data/string-images.json` into Supabase.
 *
 *   npx tsx scripts/string-images.ts --dry-run   download and check, write nothing
 *   npx tsx scripts/string-images.ts             upload and point each string at it
 *   npx tsx scripts/string-images.ts --force     also replace strings that already have one
 *   npx tsx scripts/string-images.ts --only=str-bg65,str-yonex-bg80
 *
 * The manifest names, per string, a manufacturer (or retailer) image and the
 * page it came from. Each image is downloaded, its bytes sniffed — a URL
 * ending in .jpg that serves an HTML error page is refused, not stored — and
 * uploaded to the `string-images` bucket under `<brand>/<slug>/`, with the
 * same 400px WebP thumbnail the admin upload makes. The row then records the
 * public URLs, the object key and the source page.
 *
 * A string that already has an image is skipped unless `--force`: staff may
 * have replaced an imported photo by hand, and a re-run must not undo that.
 * Needs SUPABASE_SERVICE_ROLE_KEY — a node script, never the app.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./scraper/env";
import { sha256, sniffContentType, extensionFor, thumbKeyFor } from "./scraper/images/storage";
import { revalidateCatalogue } from "./scraper/revalidate";
import { TAG } from "../src/lib/data/tags";

const BUCKET = "string-images";
const MANIFEST = join(import.meta.dirname, "..", "data", "string-images.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface ManifestEntry {
  string_id: string;
  image_url: string;
  source_page_url: string;
}

const flags = new Set(process.argv.slice(2).filter((arg) => !arg.includes("=")));
const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .filter(Boolean);
const dryRun = flags.has("--dry-run");
const force = flags.has("--force");

async function download(url: string): Promise<{ body: Buffer; contentType: string }> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = sniffContentType(body, response.headers.get("content-type") ?? "");
  if (!contentType) throw new Error("the response is not an image");
  if (body.byteLength < 5_000) throw new Error(`only ${body.byteLength} bytes; not a product photo`);
  return { body, contentType };
}

async function thumbnail(body: Buffer): Promise<Buffer | null> {
  const data = await sharp(body, { failOn: "error" })
    .resize({ width: 400, withoutEnlargement: true, fit: "inside" })
    .webp({ quality: 78 })
    .toBuffer();
  return data.byteLength < body.byteLength ? data : null;
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const manifest = (JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestEntry[]).filter(
    (entry) => !only || only.includes(entry.string_id),
  );
  const { data: rows, error } = await supabase
    .from("strings")
    .select("id, slug, image_path, brand:brands!inner(slug)");
  if (error) throw new Error(`Could not read strings: ${error.message}`);
  const byId = new Map((rows ?? []).map((row) => [String(row.id), row]));

  const report = { stored: 0, skipped: 0, failed: [] as string[] };
  for (const entry of manifest) {
    const row = byId.get(entry.string_id);
    if (!row) {
      report.failed.push(`${entry.string_id}: no such string`);
      continue;
    }
    if (row.image_path && !force) {
      console.log(`·  ${entry.string_id}: already has an image, skipped (use --force)`);
      report.skipped += 1;
      continue;
    }

    try {
      const { body, contentType } = await download(entry.image_url);
      const meta = await sharp(body, { failOn: "error" }).metadata();
      const brand = (Array.isArray(row.brand) ? row.brand[0] : row.brand) as { slug: string };
      const path = `${brand.slug}/${row.slug}/${sha256(body).slice(0, 8)}-import.${extensionFor(contentType)}`;
      const thumb = await thumbnail(body);
      console.log(
        `${dryRun ? "✓ " : "↑ "} ${entry.string_id}: ${meta.width}×${meta.height} ${contentType}, ` +
          `${Math.round(body.byteLength / 1024)} KB → ${BUCKET}/${path}${thumb ? " (+thumb)" : ""}`,
      );
      if (dryRun) {
        report.stored += 1;
        continue;
      }

      const storage = supabase.storage.from(BUCKET);
      const put = await storage.upload(path, body, { contentType, cacheControl: "31536000", upsert: true });
      if (put.error) throw new Error(`upload: ${put.error.message}`);
      let thumbUrl: string | null = null;
      if (thumb) {
        const thumbPath = thumbKeyFor(path);
        const thumbPut = await storage.upload(thumbPath, thumb, {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: true,
        });
        if (thumbPut.error) throw new Error(`thumbnail upload: ${thumbPut.error.message}`);
        thumbUrl = storage.getPublicUrl(thumbPath).data.publicUrl;
      }

      const update = await supabase
        .from("strings")
        .update({
          image_url: storage.getPublicUrl(path).data.publicUrl,
          thumb_url: thumbUrl,
          image_path: path,
          image_source_url: entry.source_page_url,
        })
        .eq("id", entry.string_id);
      if (update.error) throw new Error(`row update: ${update.error.message}`);

      const previous = row.image_path as string | null;
      if (previous && previous !== path) {
        await storage.remove([previous, thumbKeyFor(previous)]);
      }
      report.stored += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`✗  ${entry.string_id}: ${message}`);
      report.failed.push(`${entry.string_id}: ${message}`);
    }
  }

  console.log(
    `\n${dryRun ? "Checked" : "Stored"} ${report.stored}, skipped ${report.skipped}, failed ${report.failed.length}` +
      ` of ${manifest.length}.`,
  );
  for (const failure of report.failed) console.log(`   ${failure}`);
  if (!dryRun && report.stored > 0) await revalidateCatalogue([TAG.strings]);
  if (report.failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
