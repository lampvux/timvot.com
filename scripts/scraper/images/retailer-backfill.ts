import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import sharp from "sharp";
import { loadEnv } from "../env";
import { pool, sleep } from "../http";
import { isAllowed, robotsFor } from "../robots";
import { revalidateCatalogue } from "../revalidate";
import { TAG } from "../../../src/lib/data/tags";
import { collapseEquivalentRacketTargets, type RacketTarget } from "./targets";
import { SupabaseImageStore, sha256, sniffContentType } from "./storage";
import { makeThumbnail } from "./thumbnail";
import { assertWatermarkReady, watermarkConfig, WatermarkRemover } from "./watermark";
import {
  RETAILERS, discoverRetailer, interleaveRetailerImages,
  parseRetailerGallery, planRetailerTargets, retailerModelKey, retailerUrl,
  type Retailer, type RetailerDiscovery, type RetailerTarget,
} from "./retailers";

const USER_AGENT = "ShuttlecraftImageBot/1.0 (+https://github.com/shuttlecraft; retailer gallery backfill)";
const DEFAULT_PLAN = "scripts/scraper/output/retailer-image-plan.json";
const DEFAULT_REPORT = "scripts/scraper/output/retailer-image-report.json";
const MAX_BYTES = 15 * 1024 * 1024;

interface InventoryRacket {
  id: string; slug: string; name: string;
  hero_image_url: string | null; hero_thumb_url: string | null;
  brands: { slug: string; name: string };
}
interface InventoryImage {
  id: string; racket_id: string; provider: string; source_page_url: string;
  public_url: string | null; thumb_url: string | null; checksum: string;
  is_hero: boolean; position: number; admin_managed: boolean;
}
export interface RetailerPlan {
  version: 1; id: string; createdAt: string; project: string;
  discoveries: RetailerDiscovery[]; targets: RetailerTarget[];
  before: InventoryRacket[];
}
interface ImageEvidence {
  site: Retailer; pageUrl: string; sourceUrl: string; checksum: string;
  width: number; height: number; bytes: number;
  duplicateOf?: string; publicUrl?: string;
  sourceChecksum?: string;
  processingId?: string;
  originalPath?: string;
  cleanedPath?: string;
  /** False when the remover verified the photograph carried no overlay. */
  watermarkRemoved?: boolean;
  detections?: number;
  /** Non-zero when an overlay survived the repaint: removal was incomplete. */
  residual?: number;
}
interface SourceOutcome {
  site: Retailer; pagesMatched: number; imagesFound: number; validImages: number;
  status: "no-match" | "unavailable" | "no-gallery" | "validated" | "partial";
  errors: string[];
}
interface TargetOutcome {
  racketId: string; racketSlug: string;
  status: "skipped-existing" | "no-images" | "validated" | "stored" | "partial" | "failed";
  sources: SourceOutcome[]; images: ImageEvidence[];
  inserted: number; galleryCount?: number; error?: string;
}
interface BackfillReport {
  planId: string; project: string; mode: "validate" | "apply";
  processingId: string;
  updatedAt: string; results: TargetOutcome[];
}

function save(file: string, value: unknown) {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function backfillOptions(args: string[]) {
  const values: Record<string, string | boolean> = {};
  const known = new Set(["apply", "validate", "plan", "out", "limit", "max-images-per-site", "concurrency", "reuse-discovery", "remove-watermarks"]);
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match || !known.has(match[1])) throw new Error(`Unknown argument: ${arg}`);
    values[match[1]] = match[2] ?? true;
  }
  function positive(key: string, fallback: number) {
    if (values[key] === undefined) return fallback;
    const value = Number(values[key]);
    if (typeof values[key] !== "string" || !Number.isSafeInteger(value) || value < 1) throw new Error(`--${key} requires a positive integer`);
    return value;
  }
  for (const key of ["apply", "validate", "reuse-discovery", "remove-watermarks"]) {
    if (values[key] !== undefined && values[key] !== true) throw new Error(`--${key} does not take a value`);
  }
  for (const key of ["plan", "out"]) {
    if (values[key] !== undefined && (typeof values[key] !== "string" || !values[key])) throw new Error(`--${key} requires a file path`);
  }
  if (values.apply && values.validate) throw new Error("Choose --apply or --validate");
  if ((values.apply || values.validate) && !values.plan) throw new Error("First create a dry-run plan, then pass --plan=<file> with --apply or --validate");
  if (values["remove-watermarks"] && !values.apply && !values.validate) throw new Error("--remove-watermarks requires --validate or --apply with a plan");
  return {
    apply: values.apply === true, validate: values.validate === true,
    plan: typeof values.plan === "string" ? values.plan : null,
    out: typeof values.out === "string" ? values.out : null,
    limit: positive("limit", Infinity), maxPerSite: positive("max-images-per-site", 12),
    concurrency: positive("concurrency", 3), reuseDiscovery: values["reuse-discovery"] === true,
    removeWatermarks: values["remove-watermarks"] === true,
  };
}

async function readAll<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from(table).select(columns).order("id").range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data as T[]);
    if (data.length < 1000) return rows;
  }
}

/** Redirects, body size, timeout and host limits apply to every request, including images. */
export function retailerReader(site: Retailer) {
  let dispatch: Promise<void> = Promise.resolve();
  async function read(raw: string, image = false): Promise<{ bytes: Uint8Array; headers: Headers }> {
    let url = retailerUrl(raw, site, image);
    if (!url) throw new Error("Refused URL outside the retailer allowlist");
    for (let redirects = 0; redirects <= 4; redirects++) {
      const policy = await robotsFor(url, USER_AGENT);
      if (!isAllowed(policy, url)) throw new Error(`robots.txt disallows ${url}`);
      const ready = dispatch.then(() => sleep(Math.max(180, policy.crawlDelayMs)));
      dispatch = ready.catch(() => {});
      await ready;
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: image ? "image/*" : "text/html,application/json", "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8" },
          redirect: "manual", signal: AbortSignal.timeout(25_000),
        });
        if ((response.status !== 429 && response.status < 500) || attempt === 2) break;
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        await sleep(Math.max(1000 * 2 ** attempt, Math.min(30_000, (retryAfter || 0) * 1000)));
      }
      if (!response) throw new Error("No response");
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        url = location ? retailerUrl(new URL(location, url).href, site, image) : null;
        if (!url) throw new Error("Refused redirect outside the retailer allowlist");
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}: ${url}`);
      }
      if (Number(response.headers.get("content-length")) > MAX_BYTES) {
        await response.body?.cancel();
        throw new Error("Response exceeds 15 MB");
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty response body");
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > MAX_BYTES) { await reader.cancel(); throw new Error("Response exceeds 15 MB"); }
        chunks.push(chunk.value);
      }
      return { bytes: Buffer.concat(chunks), headers: response.headers };
    }
    throw new Error("Too many redirects");
  }
  return {
    binary: (url: string) => read(url, true),
    page: async (url: string) => {
      const response = await read(url);
      return { body: Buffer.from(response.bytes).toString("utf8"), headers: response.headers };
    },
  };
}

async function createPlan(db: SupabaseClient, project: string, reuseDiscovery: boolean): Promise<RetailerPlan> {
  const [rackets, images] = await Promise.all([
    readAll<InventoryRacket>(db, "rackets", "id,slug,name,hero_image_url,hero_thumb_url,brands(slug,name)"),
    readAll<InventoryImage>(db, "racket_images", "id,racket_id,source_page_url"),
  ]);
  const targets: RacketTarget[] = collapseEquivalentRacketTargets(rackets.map((row) => ({
    id: row.id, slug: row.slug, name: row.name, brandSlug: row.brands.slug, brandName: row.brands.name, equivalentIds: [row.id],
  })));
  const discoveries = await Promise.all(RETAILERS.map(async (site) => {
    const file = `scripts/scraper/output/retailer-discovery-${site}.json`;
    if (reuseDiscovery && existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, "utf8")) as RetailerDiscovery;
      if (cached.complete && cached.site === site) { console.log(`${site}: reusing ${cached.products.length} products`); return cached; }
    }
    console.log(`${site}: discovering public catalogue`);
    const titleHints = site === "fbshop" && existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as RetailerDiscovery).products
      : [];
    const result = await discoverRetailer(site, retailerReader(site).page, { deferProductPages: true, titleHints });
    save(file, result);
    console.log(`${site}: ${result.products.length} products, ${result.pagesRead} pages, ${result.complete ? "complete" : result.error}`);
    return result;
  }));
  const planned = planRetailerTargets(targets, new Set(images.map((row) => row.racket_id)), discoveries, new Map(images.map((row) => [row.source_page_url, row.racket_id])));
  const ids = new Set(planned.flatMap((target) => target.equivalentIds));
  return { version: 1, id: randomUUID(), createdAt: new Date().toISOString(), project, discoveries, targets: planned, before: rackets.filter((row) => ids.has(row.id)) };
}

const IMAGE_COLUMNS = "id,racket_id,provider,source_page_url,public_url,thumb_url,checksum,is_hero,position,admin_managed";

export function canResumeRetailerGallery(rows: InventoryImage[], planId: string): boolean {
  return rows.every((row) => !row.admin_managed && row.id.startsWith(`retail-${planId}-`) && RETAILERS.some((site) => row.provider === `retailer-${site}`));
}

export function assertCompleteRetailerPlan(plan: Pick<RetailerPlan, "discoveries" | "targets">) {
  for (const site of RETAILERS) {
    if (!plan.discoveries.some((source) => source.site === site && source.complete)) throw new Error(`Complete ${site} discovery before applying this plan`);
    if (plan.targets.some((target) => !target.sites.some((source) => source.site === site && source.discoveryComplete))) throw new Error(`Plan is missing ${site} coverage for a target`);
  }
}

export async function runRetailerBackfill(args = process.argv.slice(2)) {
  const options = backfillOptions(args);
  loadEnv();
  // Fail before creating buckets or writing rows if the requested editor
  // cannot run. The checked config carries the remover's real identity, so
  // the gallery id follows the templates and thresholds that produced it.
  const editorConfig = options.removeWatermarks ? await assertWatermarkReady(watermarkConfig()) : null;
  const watermarkRemover = editorConfig ? new WatermarkRemover(editorConfig) : null;
  const processingId = watermarkRemover?.processingId ?? "original";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const project = new URL(url).hostname;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!options.plan) {
    const plan = await createPlan(db, project, options.reuseDiscovery);
    save(options.out ?? DEFAULT_PLAN, plan);
    const matched = plan.targets.filter((target) => target.sites.some((site) => site.pages.length));
    console.log(JSON.stringify({ plan: options.out ?? DEFAULT_PLAN, missing: plan.targets.length, matched: matched.length, multipleSources: matched.filter((target) => target.sites.filter((site) => site.pages.length).length > 1).length, sites: plan.discoveries.map(({ site, products, complete, error }) => ({ site, products: products.length, complete, error })) }, null, 2));
    return;
  }
  const plan = JSON.parse(readFileSync(options.plan, "utf8")) as RetailerPlan;
  if (plan.version !== 1 || plan.project !== project || !Array.isArray(plan.targets)) throw new Error("Plan version or Supabase project does not match");
  if (options.apply) assertCompleteRetailerPlan(plan);
  if (!options.apply && !options.validate) throw new Error("Use --validate or --apply with an existing plan");
  const mode = options.apply ? "apply" : "validate";
  const runId = `${plan.id}-${processingId}`;
  const output = options.out ?? (options.removeWatermarks
    ? `scripts/scraper/output/retailer-image-${mode}-cleaned.json`
    : options.apply ? DEFAULT_REPORT : "scripts/scraper/output/retailer-image-validation.json");
  let report: BackfillReport = { planId: plan.id, processingId, project, mode, updatedAt: new Date().toISOString(), results: [] };
  if (existsSync(output)) {
    const saved = JSON.parse(readFileSync(output, "utf8")) as BackfillReport;
    if (saved.planId === plan.id && saved.mode === mode && (saved.processingId ?? "original") === processingId) report = saved;
  }
  const readers = Object.fromEntries(RETAILERS.map((site) => [site, retailerReader(site)])) as Record<Retailer, ReturnType<typeof retailerReader>>;
  const store = new SupabaseImageStore({ client: db, bucket: process.env.SUPABASE_IMAGE_BUCKET ?? "racket-images", strategy: "shared", dryRun: !options.apply });
  if (options.apply) await store.prepare(RETAILERS.map((site) => `retailer-${site}`));
  const finished = new Set(report.results.filter((result) => ["stored", "validated", "no-images", "skipped-existing"].includes(result.status) && !result.sources.some((source) => source.errors.length)).map((result) => result.racketId));
  const queue = plan.targets.filter((target) => !finished.has(target.id) && (!options.validate || target.sites.some((source) => source.pages.length))).slice(0, options.limit);
  let done = 0;
  console.log(`${mode}: ${queue.length} missing-gallery targets; all four retailers; up to ${options.maxPerSite} images per source; processing=${processingId}`);
  await pool(queue, options.concurrency, 0, async (target) => {
    const result: TargetOutcome = { racketId: target.id, racketSlug: target.slug, status: "no-images", sources: [], images: [], inserted: 0 };
    const existingRows = async () => {
      const { data, error } = await db.from("racket_images").select(IMAGE_COLUMNS).in("racket_id", target.equivalentIds);
      if (error) throw new Error(error.message);
      return data as InventoryImage[];
    };
    try {
      const existing = await existingRows();
      if (!canResumeRetailerGallery(existing, runId)) {
        result.status = "skipped-existing";
        return;
      }
      const groups: { evidence: ImageEvidence; body: Uint8Array; contentType: string }[][] = [];
      for (const source of target.sites) {
        const sourceResult: SourceOutcome = { site: source.site, pagesMatched: source.pages.length, imagesFound: 0, validImages: 0, status: source.error ? "unavailable" : "no-match", errors: source.error ? [source.error] : [] };
        result.sources.push(sourceResult);
        const group: typeof groups[number] = [];
        groups.push(group);
        const urls = new Set<string>();
        const checksums = new Set<string>();
        for (const page of source.pages) {
          try {
            let gallery = page.images;
            if (!gallery.length) {
              const response = await readers[source.site].page(page.url);
              const title = cheerio.load(response.body)("h1").first().text().trim();
              if (retailerModelKey(title, target.brandSlug) !== page.modelKey) throw new Error(`Product title changed: ${page.url}`);
              gallery = parseRetailerGallery(response.body, page.url, source.site);
            }
            sourceResult.imagesFound += gallery.length;
            for (const image of gallery) {
              if (group.length >= options.maxPerSite) break;
              if (urls.has(image.url)) continue;
              urls.add(image.url);
              try {
                const response = await readers[source.site].binary(image.url);
                const contentType = sniffContentType(response.bytes, "");
                if (!contentType) throw new Error("Not a supported raster image");
                const metadata = await sharp(response.bytes, { limitInputPixels: 40_000_000 }).metadata();
                if (!metadata.width || !metadata.height || metadata.width * metadata.height < 40_000) throw new Error("Image below 40,000 pixels");
                // Force a decode. A plausible header alone does not prove the image is usable.
                await sharp(response.bytes, { limitInputPixels: 40_000_000 }).resize(8, 8).raw().toBuffer();
                const sourceChecksum = sha256(response.bytes);
                if (checksums.has(sourceChecksum)) continue;
                // The shop is passed through so the remover matches only that
                // shop's overlay templates against the photograph.
                const edit = watermarkRemover ? await watermarkRemover.remove(response.bytes, source.site) : null;
                checksums.add(sourceChecksum);
                const body = edit?.body ?? response.bytes;
                group.push({ body, contentType: edit?.contentType ?? contentType, evidence: {
                  site: source.site, pageUrl: page.url, sourceUrl: image.url,
                  checksum: edit?.checksum ?? sourceChecksum, sourceChecksum, processingId,
                  width: edit?.width ?? metadata.width, height: edit?.height ?? metadata.height, bytes: body.length,
                  ...(edit ? {
                    originalPath: edit.originalPath,
                    ...(edit.cleanedPath ? { cleanedPath: edit.cleanedPath } : {}),
                    watermarkRemoved: edit.changed, detections: edit.detections,
                    ...(edit.residual ? { residual: edit.residual } : {}),
                  } : {}),
                } });
                sourceResult.validImages++;
              } catch (error) { sourceResult.errors.push(`${image.url}: ${error instanceof Error ? error.message : String(error)}`); }
            }
          } catch (error) { sourceResult.errors.push(error instanceof Error ? error.message : String(error)); }
        }
        if (source.pages.length) sourceResult.status = sourceResult.errors.length ? "partial" : group.length ? "validated" : "no-gallery";
      }
      const files = interleaveRetailerImages(groups, options.maxPerSite);
      const seen = new Map(existing.filter((image) => image.racket_id === target.id).map((image) => [image.checksum, image.public_url ?? image.id]));
      const hasErrors = result.sources.some((source) => source.errors.length > 0);
      if (options.apply && !canResumeRetailerGallery(await existingRows(), runId)) {
        result.status = "skipped-existing";
        return;
      }
      let position = Math.max(-1, ...existing.map((image) => image.position)) + 1;
      for (const file of files) {
        result.images.push(file.evidence);
        const previous = seen.get(file.evidence.checksum);
        if (previous) { file.evidence.duplicateOf = previous; continue; }
        seen.set(file.evidence.checksum, file.evidence.sourceUrl);
        if (!options.apply) continue;
        const thumbnail = await makeThumbnail(file.body);
        const object = await store.put({ provider: `retailer-${file.evidence.site}`, brandSlug: target.brandSlug, racketSlug: target.slug, position, body: file.body, contentType: file.contentType, checksum: file.evidence.checksum, thumb: thumbnail });
        file.evidence.publicUrl = object.publicUrl;
        const { error } = await db.from("racket_images").insert({
          id: `retail-${runId}-${target.id}-${object.checksum.slice(0, 16)}`,
          racket_id: target.id, provider: `retailer-${file.evidence.site}`,
          source_url: file.evidence.sourceUrl, source_page_url: file.evidence.pageUrl,
          storage_bucket: object.bucket, storage_path: object.path, public_url: object.publicUrl,
          thumb_path: object.thumbPath, thumb_url: object.thumbUrl, position,
          is_hero: false, content_type: object.contentType, bytes: object.bytes,
          width: file.evidence.width, height: file.evidence.height, checksum: object.checksum,
        });
        if (error) throw new Error(`Recording gallery: ${error.message}`);
        result.inserted++;
        position++;
      }
      if (options.apply) {
        const stored = (await existingRows()).filter((image) => image.racket_id === target.id);
        result.galleryCount = stored.length;
        if (stored.length && canResumeRetailerGallery(stored, runId)) {
          const hero = stored.find((image) => image.is_hero) ?? stored.toSorted((a, b) => a.position - b.position)[0];
          if (!hero.is_hero) {
            const { error: heroError } = await db.from("racket_images").update({ is_hero: true }).eq("id", hero.id).eq("admin_managed", false);
            if (heroError) throw new Error(`Setting gallery hero: ${heroError.message}`);
          }
          // A resumed insert may already have elected a hero before its pointer
          // update failed. Retry that pointer too, without overwriting a staff edit.
          const previousHero = plan.before.find((row) => row.id === target.id)?.hero_image_url;
          const update = db.from("rackets").update({ hero_image_url: hero.public_url, hero_thumb_url: hero.thumb_url }).eq("id", target.id);
          const { error: pointerError } = previousHero ? await update.eq("hero_image_url", previousHero) : await update.is("hero_image_url", null);
          if (pointerError) throw new Error(`Setting racket hero: ${pointerError.message}`);
        }
        result.status = hasErrors ? "partial" : stored.length ? "stored" : "no-images";
      } else result.status = hasErrors ? "partial" : files.length ? "validated" : "no-images";
    } catch (error) {
      result.status = "failed";
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      report.results = report.results.filter((previous) => previous.racketId !== result.racketId);
      report.results.push(result);
      report.updatedAt = new Date().toISOString();
      save(output, report);
      done++;
      if (result.images.length || result.error || done % 50 === 0) console.log(`${done}/${queue.length} ${target.slug}: ${result.status}, ${result.inserted} inserted, ${result.images.length} validated${result.error ? ` (${result.error})` : ""}`);
    }
  });
  const summary = report.results.reduce<Record<string, number>>((counts, result) => { counts[result.status] = (counts[result.status] ?? 0) + 1; return counts; }, {});
  const images = report.results.flatMap((result) => result.images);
  console.log(JSON.stringify({
    report: output, summary,
    storedGalleryRows: report.results.reduce((sum, result) => sum + (result.galleryCount ?? 0), 0),
    ...(watermarkRemover ? {
      watermarks: {
        repainted: images.filter((image) => image.watermarkRemoved).length,
        noOverlayFound: images.filter((image) => image.watermarkRemoved === false).length,
        // Named rather than silently shipped: inspect these before publishing.
        incompleteRemovals: images.filter((image) => image.residual).map((image) => image.sourceUrl),
      },
    } : {}),
  }, null, 2));
  if (options.apply && report.results.some((result) => (result.galleryCount ?? 0) > 0)) await revalidateCatalogue([TAG.rackets]);
  if (report.results.some((result) => result.status === "failed" || result.status === "partial")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runRetailerBackfill().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
