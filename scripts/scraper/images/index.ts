/**
 * The manufacturer gallery crawler.
 *
 *   npm run scrape:images -- --dry-run          # match and report, store nothing
 *   npm run scrape:images                       # crawl, upload, record
 *   npm run scrape:images -- --provider=yonex --limit=10 --verbose
 *
 * What it does, in order:
 *
 *   1. Reads the rackets it should find images for — from `racket_images`'
 *      sibling tables in Postgres, or from the retailer scrape on disk.
 *   2. Asks each provider's sitemap for its product URLs (cached between runs).
 *   3. Matches racket → product URL on tokens, strictly (see `match.ts`).
 *   4. Opens each matched page, pulls the gallery out of the page's own
 *      structured data, and downloads the full-resolution files.
 *   5. Puts the bytes in Supabase Storage, partitioned by brand, and records
 *      one row per stored object in `racket_images`.
 *
 * The whole thing is resumable and idempotent. Storage keys carry the content
 * hash, `racket_images` is keyed `(racket_id, checksum)`, and rackets that
 * already have images are skipped unless `--refresh` is passed — so an
 * interrupted run is restarted by running it again, not by cleaning up first.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "../env";
import { fetchBinary, fetchWithRetry, HTML_HEADERS, pool, sleep } from "../http";
import { isAllowed, robotsFor } from "../robots";
import { discoverCandidates } from "./discover";
import { EXTRACTORS, PROVIDERS, providersForBrand, uncoveredBrands, type ProviderConfig } from "./providers";
import { bestMatch, type MatchCandidate, type MatchTier } from "./match";
import type { GalleryImage } from "./gallery";
import {
  SupabaseImageStore,
  readDimensions,
  sha256,
  sniffContentType,
  type BucketStrategy,
  type ImageStore,
} from "./storage";
import { makeThumbnail } from "./thumbnail";
import {
  collapseEquivalentRacketTargets,
  type RacketTarget,
} from "./targets";
import {
  resolvePageOwnership,
  type ImageJob,
  type ImageJobOption,
} from "./ownership";
import { BrowserSession } from "./browser";
import type { NormalizedItem } from "../normalizer";
import { revalidateCatalogue } from "../revalidate";
import { TAG } from "../../../src/lib/data/tags";

/**
 * Identify the crawler honestly. A manufacturer looking at their logs should be
 * able to tell what this is and where to complain, and the robots.txt reader
 * needs a name to match groups against.
 */
const USER_AGENT =
  "ShuttlecraftImageBot/1.0 (+https://github.com/shuttlecraft; catalogue image crawler)";

const OUTPUT_FILE = "scripts/scraper/output/racket-images.json";
const SCRAPE_FILE = "scripts/scraper/output/rackets.json";

interface CliOptions {
  providers: string[];
  dryRun: boolean;
  verbose: boolean;
  limit: number;
  maxImages: number;
  /** Cap on colourway pages read per racket. */
  maxPages: number;
  minPixels: number;
  /**
   * A gallery this small is treated as a placeholder, and the next provider
   * covering the brand is asked as well. See `Job.alternatives`.
   */
  minGallery: number;
  bucket: string;
  strategy: BucketStrategy;
  concurrency: number;
  delayMs: number;
  timeoutMs: number;
  refreshSitemaps: boolean;
  /** Re-crawl rackets that already have images. */
  refresh: boolean;
  /** Take a match even when several product URLs score equally. */
  allowAmbiguous: boolean;
  /** Read the racket list from the scrape file rather than Postgres. */
  fromFile: string | null;
  outFile: string | null;
}

function parseArgs(): CliOptions {
  const flags: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    flags[key] = value === undefined ? true : value;
  }

  const providerFlag = String(flags.provider ?? flags.providers ?? "all").toLowerCase();
  const providers =
    providerFlag === "all"
      ? PROVIDERS.map((p) => p.id)
      : providerFlag
          .split(",")
          .map((value) => value.trim())
          .filter((value) => PROVIDERS.some((p) => p.id === value));

  const strategy = String(flags["bucket-strategy"] ?? "shared").toLowerCase();

  return {
    providers,
    dryRun: Boolean(flags["dry-run"]),
    verbose: Boolean(flags.verbose),
    limit: flags.limit ? parseInt(String(flags.limit), 10) : Infinity,
    maxImages: flags["max-images"] ? parseInt(String(flags["max-images"]), 10) : 12,
    maxPages: flags["max-pages"] ? parseInt(String(flags["max-pages"]), 10) : 6,
    // 200×200 keeps out favicons and swatch chips without excluding a
    // legitimately small studio shot.
    minPixels: flags["min-pixels"] ? parseInt(String(flags["min-pixels"]), 10) : 200 * 200,
    // Two: one photograph is a catalogue placeholder, and every site here that
    // genuinely sells a frame publishes at least a second angle of it. Set 0 to
    // switch the second look off and take the first provider's answer always.
    minGallery: flags["min-gallery"] ? parseInt(String(flags["min-gallery"]), 10) : 2,
    bucket: String(flags.bucket ?? process.env.SUPABASE_IMAGE_BUCKET ?? "racket-images"),
    strategy: strategy === "per-provider" ? "per-provider" : "shared",
    concurrency: flags.concurrency ? parseInt(String(flags.concurrency), 10) : 3,
    delayMs: flags.delay ? parseInt(String(flags.delay), 10) : 400,
    timeoutMs: flags.timeout ? parseInt(String(flags.timeout), 10) : 30000,
    refreshSitemaps: Boolean(flags["refresh-sitemaps"]),
    refresh: Boolean(flags.refresh),
    allowAmbiguous: Boolean(flags["allow-ambiguous"]),
    fromFile:
      flags["from-file"] === undefined
        ? null
        : flags["from-file"] === true
          ? SCRAPE_FILE
          : String(flags["from-file"]),
    outFile: (() => {
      if (flags.out === undefined) return OUTPUT_FILE;
      const value = String(flags.out).toLowerCase();
      return value === "none" || value === "false" || value === "" ? null : String(flags.out);
    })(),
  };
}

/* ------------------------------------------------------------ racket list */

/**
 * Read the rackets from Postgres.
 *
 * This is the default because the catalogue is the system of record and its
 * racket ids are what `racket_images.racket_id` has to reference. Falling back
 * to the scrape file is for the case where the catalogue has not been synced
 * yet, and it reconstructs the same ids the sync would have written.
 */
async function racketsFromDb(supabase: SupabaseClient): Promise<RacketTarget[]> {
  const targets: RacketTarget[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("rackets")
      .select("id, slug, name, brand_id, brands(slug, name)")
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Reading rackets: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data as unknown as {
      id: string;
      slug: string;
      name: string;
      brand_id: string;
      brands: { slug: string; name: string } | { slug: string; name: string }[] | null;
    }[]) {
      const brand = Array.isArray(row.brands) ? row.brands[0] : row.brands;
      targets.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        brandSlug: brand?.slug ?? row.brand_id.replace(/^b-/, ""),
        brandName: brand?.name ?? "",
        equivalentIds: [row.id],
      });
    }

    if (data.length < pageSize) break;
  }

  return collapseEquivalentRacketTargets(targets);
}

function racketsFromFile(file: string): RacketTarget[] {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) {
    throw new Error(`No scrape at ${file}. Run \`npm run scrape\` first, or drop --from-file.`);
  }

  const saved = JSON.parse(readFileSync(path, "utf8")) as { items?: NormalizedItem[] };
  const byId = new Map<string, RacketTarget>();

  for (const item of saved.items ?? []) {
    const id = `r-${item.racketSlug}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      slug: item.racketSlug,
      name: item.racketName,
      brandSlug: item.brandSlug,
      brandName: item.brandName,
      equivalentIds: [id],
    });
  }

  return collapseEquivalentRacketTargets([...byId.values()]);
}

/** Racket ids that already carry gallery rows, so a re-run can skip them. */
async function racketsWithImages(supabase: SupabaseClient): Promise<Set<string>> {
  const seen = new Set<string>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("racket_images")
      .select("racket_id")
      .order("racket_id")
      .range(from, from + pageSize - 1);

    if (error) {
      // The table is missing until the migration runs. Say so once, clearly,
      // rather than failing three hundred inserts later.
      if (/does not exist|schema cache/i.test(error.message)) {
        throw new Error(
          "The racket_images table does not exist. Apply the migrations first:\n" +
            "  npm run migrate",
        );
      }
      throw new Error(`Reading racket_images: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    for (const row of data as { racket_id: string }[]) seen.add(row.racket_id);
    if (data.length < pageSize) break;
  }

  return seen;
}

/* ---------------------------------------------------------------- crawling */

interface CrawledImage extends GalleryImage {
  pageUrl: string;
  bytes: Uint8Array;
  contentType: string;
  width: number | null;
  height: number | null;
  /** sha256 of `bytes`, computed once here and reused by the store. */
  checksum: string;
}

interface RacketOutcome {
  racketId: string;
  racketSlug: string;
  racketName: string;
  brandSlug: string;
  provider: string;
  status: "stored" | "no-match" | "ambiguous" | "no-gallery" | "fetch-failed" | "skipped";
  pageUrl?: string;
  matchTier?: MatchTier;
  /** Set when the catalogue name matched nothing and an alias did; the alias used. */
  matchedAs?: string;
  /** Pages in this racket's family that were read (colourway pages included). */
  pagesCrawled?: number;
  candidatesConsidered?: number;
  imagesFound?: number;
  imagesStored?: number;
  detail?: string;
}

/** Fetch a product page and pull its gallery out with the provider's chain. */
async function readGallery(
  provider: ProviderConfig,
  pageUrl: string,
  options: CliOptions,
  browser: BrowserSession | null,
): Promise<{ images: GalleryImage[]; error?: string }> {
  // A browser provider's page is a shell until it hydrates, so there is nothing
  // in the served HTML for an extractor to read.
  if (provider.platform === "browser") {
    if (!browser) return { images: [], error: "no browser session" };
    try {
      // 240px on the short edge: Wix renders its gallery at 273, and the
      // originals behind those are 1750 — this only has to clear the icons.
      const images = await browser.collectImages(pageUrl, 240, options.timeoutMs);
      return { images };
    } catch (err) {
      return { images: [], error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
    }
  }

  const res = await fetchWithRetry(pageUrl, {
    headers: { ...HTML_HEADERS, "User-Agent": USER_AGENT },
    timeoutMs: options.timeoutMs,
    verbose: options.verbose,
  });

  if (!res.ok) return { images: [], error: `HTTP ${res.status}` };

  // A provider that brought its own reader is a site no platform describes.
  for (const extract of provider.extractors ?? EXTRACTORS[provider.platform]) {
    const images = extract(res.body, pageUrl);
    if (images.length > 0) return { images };
  }

  return { images: [] };
}

/**
 * Download one gallery's files.
 *
 * Anything that is not decodable as one of the five image types we accept, or
 * that comes back below `--min-pixels`, is dropped here rather than uploaded
 * and cleaned up later. A bucket full of 88×110 Magento thumbnails looks like a
 * working crawl in the row count and is useless on a spec page.
 *
 * `--max-images` counts *distinct photographs*, which is not the same as
 * counting gallery entries. A Magento product page lists every shot twice —
 * once in the main gallery and once under the colour swatch for the default
 * colourway, at a second URL (`…-05.png` and `…-05_1.png`) holding byte-
 * identical files. Slicing the entry list to the cap before noticing that spent
 * half the budget on copies: NANOFLARE 002 FEEL publishes 18 entries that are
 * 12 distinct photographs, and a cap of 12 entries stored 6 of them, dropping
 * the six `all_*` studio shots that sat past the cut. So the cap is applied
 * after the bytes are hashed, and `maxFetch` bounds the work that dedupe costs.
 */
async function downloadGallery(
  images: (GalleryImage & { pageUrl: string })[],
  options: CliOptions,
  delayMs: number,
): Promise<CrawledImage[]> {
  // Three entries per wanted photograph. Magento's duplication is 2×; the extra
  // headroom covers a page that also carries a video poster or a size chart,
  // and still refuses to walk a gallery of arbitrary length.
  const maxFetch = Number.isFinite(options.maxImages) ? options.maxImages * 3 : images.length;
  const wanted = images.slice(0, maxFetch);

  const downloaded = await pool(wanted, options.concurrency, delayMs, async (image) => {
    try {
      const res = await fetchBinary(image.url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
        },
        timeoutMs: options.timeoutMs,
      });

      if (!res.ok || res.body.byteLength === 0) return null;

      const contentType = sniffContentType(res.body, res.contentType);
      if (!contentType) return null;

      const size = readDimensions(res.body);
      if (size && size.width * size.height < options.minPixels) return null;

      return {
        ...image,
        bytes: res.body,
        contentType,
        width: size?.width ?? null,
        height: size?.height ?? null,
        checksum: sha256(res.body),
      } satisfies CrawledImage;
    } catch {
      return null;
    }
  });

  // First-seen order, keyed on content. Position is the gallery's own ordering,
  // so the copy that survives is the one the manufacturer listed first.
  const unique: CrawledImage[] = [];
  const seen = new Set<string>();
  for (const image of downloaded) {
    if (image === null) continue;
    if (seen.has(image.checksum)) continue;
    seen.add(image.checksum);
    unique.push(image);
    if (unique.length >= options.maxImages) break;
  }

  return unique;
}

/* -------------------------------------------------------------------- main */

export async function crawlImages() {
  const options = parseArgs();
  const startedAt = Date.now();

  loadEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Even a dry run wants the client, to read the racket list and to report what
  // is already stored. Only a --from-file dry run can do without one.
  const needsSupabase = !options.dryRun || !options.fromFile;
  if (needsSupabase && (!supabaseUrl || !serviceRoleKey)) {
    console.error(
      "❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
        "   Storage writes and catalogue writes are admin-only under RLS, so the\n" +
        "   publishable key is rejected. For a match-only pass without any\n" +
        "   credentials, use: npm run scrape:images -- --dry-run --from-file",
    );
    process.exitCode = 1;
    return;
  }

  const supabase =
    supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

  const providers = PROVIDERS.filter((provider) => options.providers.includes(provider.id));

  console.log("=================================================");
  console.log("🖼️  Shuttlecraft manufacturer gallery crawler");
  console.log("=================================================");
  console.log(`Providers   : ${providers.map((p) => p.name).join(", ") || "none"}`);
  console.log(`Source list : ${options.fromFile ? options.fromFile : "Postgres (rackets)"}`);
  console.log(
    `Storage     : ${
      options.dryRun
        ? "dry run — nothing is uploaded"
        : options.strategy === "per-provider"
          ? `Supabase Storage, ${options.bucket}-<provider>`
          : `Supabase Storage, ${options.bucket}/<brand>/…`
    }`,
  );
  console.log(`Per racket  : up to ${options.maxImages} images, min ${options.minPixels} px²`);
  console.log(`Politeness  : ${options.concurrency} in flight, ${options.delayMs}ms apart`);
  console.log("=================================================\n");

  if (providers.length === 0) {
    console.error("❌ No providers selected. Known providers: " + PROVIDERS.map((p) => p.id).join(", "));
    process.exitCode = 1;
    return;
  }

  // --- Racket list ---------------------------------------------------------
  let rackets: RacketTarget[];
  try {
    rackets = options.fromFile ? racketsFromFile(options.fromFile) : await racketsFromDb(supabase!);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  if (rackets.length === 0) {
    console.error(
      "❌ No rackets to work from. Sync the catalogue first (`npm run scrape:sync`),\n" +
        "   or point at the scrape on disk with --from-file.",
    );
    process.exitCode = 1;
    return;
  }

  // A dry run off the scrape file is the one mode that touches no database at
  // all — it exists so the matcher can be reviewed before a project is
  // provisioned, and asking the catalogue what it already has would defeat that.
  const offline = options.dryRun && options.fromFile !== null;

  let alreadyStored = new Set<string>();
  if (supabase && !options.refresh && !offline) {
    try {
      alreadyStored = await racketsWithImages(supabase);
    } catch (err) {
      console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
  }

  const uncovered = uncoveredBrands(rackets.map((racket) => racket.brandSlug));
  const inScope = rackets.filter((racket) => providersForBrand(racket.brandSlug).length > 0);

  console.log(
    `📚 ${rackets.length} rackets in the catalogue; ${inScope.length} belong to a brand a ` +
      `provider covers.`,
  );
  if (uncovered.length > 0) {
    console.log(
      `   ${uncovered.length} brands have no provider and are not attempted: ${uncovered.join(", ")}`,
    );
  }
  if (alreadyStored.size > 0) {
    console.log(`   ${alreadyStored.size} rackets already have images; --refresh to redo them.`);
  }
  console.log();

  // --- Discovery -----------------------------------------------------------
  // Chromium is only started when a selected provider actually needs it, so a
  // run over the HTTP-readable providers never pays for it.
  const needsBrowser = providers.some((provider) => provider.platform === "browser");
  const browser = needsBrowser ? new BrowserSession(USER_AGENT) : null;
  if (browser) {
    console.log("🌐 A selected provider renders client-side; starting Chromium for it.\n");
  }

  const candidatesByProvider = new Map<string, Awaited<ReturnType<typeof discoverCandidates>>>();

  for (const provider of providers) {
    const result = await discoverCandidates(provider, {
      userAgent: USER_AGENT,
      timeoutMs: options.timeoutMs,
      delayMs: options.delayMs,
      refresh: options.refreshSitemaps,
      verbose: options.verbose,
    });
    candidatesByProvider.set(provider.id, result);

    if (result.error) {
      console.log(`⚠️  [${provider.id}] sitemap unreadable: ${result.error}`);
    } else {
      console.log(
        `🗺️  [${provider.id}] ${result.candidates.length} product urls ` +
          `(of ${result.urlsSeen} in the sitemap)${result.fromCache ? " — cached" : ""}`,
      );
    }
  }
  console.log();

  // --- Match ---------------------------------------------------------------
  const proposedJobs: ImageJob[] = [];
  const outcomes: RacketOutcome[] = [];

  for (const racket of inScope) {
    if (
      !options.refresh &&
      racket.equivalentIds.some((racketId) => alreadyStored.has(racketId))
    ) {
      outcomes.push({
        racketId: racket.id,
        racketSlug: racket.slug,
        racketName: racket.name,
        brandSlug: racket.brandSlug,
        provider: "-",
        status: "skipped",
        detail: "already has images",
      });
      continue;
    }

    const matches: ImageJobOption[] = [];
    // A racket is now compared against every provider that covers its brand, so
    // "yonex.co.uk does not sell it either" is only worth reporting when no site
    // had it at all. Held back until the providers are exhausted.
    const misses: RacketOutcome[] = [];

    for (const provider of providersForBrand(racket.brandSlug)) {
      if (!options.providers.includes(provider.id)) continue;

      const discovery = candidatesByProvider.get(provider.id);
      if (!discovery || discovery.candidates.length === 0) continue;

      const brandName = racket.brandName || provider.name;
      let match = bestMatch(racket.name, brandName, discovery.candidates);

      // Only if the name as written found nothing. An alias never displaces a
      // direct match, and it is put through the same comparison — the manufacturer
      // spells the model differently, the bar for accepting a page is unchanged.
      let matchedAs: string | undefined;
      if (!match && provider.modelAliases) {
        for (const alias of provider.modelAliases(racket.name)) {
          match = bestMatch(alias, brandName, discovery.candidates);
          if (match) {
            matchedAs = alias;
            break;
          }
        }
      }

      if (!match) {
        misses.push({
          racketId: racket.id,
          racketSlug: racket.slug,
          racketName: racket.name,
          brandSlug: racket.brandSlug,
          provider: provider.id,
          status: "no-match",
          candidatesConsidered: discovery.candidates.length,
        });
        continue;
      }

      if (match.rivals.length > 0 && !options.allowAmbiguous) {
        misses.push({
          racketId: racket.id,
          racketSlug: racket.slug,
          racketName: racket.name,
          brandSlug: racket.brandSlug,
          provider: provider.id,
          status: "ambiguous",
          pageUrl: match.candidate.url,
          matchTier: match.tier,
          matchedAs,
          detail: `also matched ${match.rivals.map((r) => r.slug).join(", ")}`,
        });
        continue;
      }

      matches.push({
        racket,
        provider,
        pages: [match.candidate, ...match.siblings].slice(0, options.maxPages),
        tier: match.tier,
        matchedAs,
        candidatesConsidered: discovery.candidates.length,
      });
    }

    // The first provider that matched still leads; the rest are only consulted
    // if its gallery comes back thin. See `Job.alternatives`.
    const [primary, ...rest] = matches;
    if (primary) proposedJobs.push({ ...primary, alternatives: rest });
    // One row per racket that nothing could be found for, not one per site.
    else if (misses.length > 0) outcomes.push(misses[0]);
  }

  // Matching one racket at a time is not enough to establish ownership: the
  // short "Astrox 22" and exact "Astrox 22 RX" records both accept the RX
  // page because `RX` is code-like. Resolve every page's competing claims as a
  // set before downloading anything. This is also what makes the database's
  // `(source_page_url, checksum)` uniqueness guard satisfiable.
  const ownership = resolvePageOwnership(proposedJobs);
  const jobs = ownership.jobs;
  const matchedIds = new Set(jobs.map((job) => job.racket.id));
  const rejectedByRacket = new Map(
    ownership.rejected.map((claim) => [claim.racketId, claim]),
  );
  for (const claim of rejectedByRacket.values()) {
    if (matchedIds.has(claim.racketId)) continue;
    const proposed = proposedJobs.find((job) => job.racket.id === claim.racketId);
    if (!proposed) continue;
    outcomes.push({
      racketId: proposed.racket.id,
      racketSlug: proposed.racket.slug,
      racketName: proposed.racket.name,
      brandSlug: proposed.racket.brandSlug,
      provider: proposed.provider.id,
      status: "ambiguous",
      pageUrl: claim.pageUrl,
      matchTier: proposed.tier,
      matchedAs: proposed.matchedAs,
      detail: `source page belongs more exactly to ${claim.winnerRacketSlug}`,
    });
  }

  if (ownership.rejected.length > 0) {
    console.log(
      `🧭 Rejected ${ownership.rejected.length} duplicate source-page claim(s); ` +
        "each manufacturer product page now has one database owner.",
    );
  }

  const matched = jobs.length;
  console.log(
    `🎯 Matched ${matched} rackets to a product page ` +
      `(${jobs.filter((j) => j.tier === "exact").length} exact, ` +
      `${jobs.filter((j) => j.tier === "coded").length} via a SKU-suffixed url).`,
  );
  const viaAlias = jobs.filter((j) => j.matchedAs).length;
  if (viaAlias > 0) {
    console.log(
      `   ${viaAlias} of those matched only after expanding the model code the ` +
        `catalogue uses into the name the manufacturer publishes.`,
    );
  }
  if (options.limit !== Infinity && jobs.length > options.limit) {
    console.log(`   --limit=${options.limit}, so only the first ${options.limit} are crawled.`);
  }
  console.log();

  const queue = options.limit === Infinity ? jobs : jobs.slice(0, options.limit);

  // --- Crawl, store, record ------------------------------------------------
  const store: ImageStore | null = supabase
    ? new SupabaseImageStore({
        client: supabase,
        bucket: options.bucket,
        strategy: options.strategy,
        dryRun: options.dryRun,
      })
    : null;

  if (store && queue.length > 0) {
    console.log(`📦 ${store.describe()}`);
    try {
      await store.prepare(providers.map((provider) => provider.id));
    } catch (err) {
      console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    console.log();
  }

  interface ImageRow {
    id: string;
    racket_id: string;
    provider: string;
    source_url: string;
    source_page_url: string;
    storage_bucket: string;
    storage_path: string;
    public_url: string;
    thumb_path: string | null;
    thumb_url: string | null;
    position: number;
    is_hero: boolean;
    content_type: string;
    bytes: number;
    width: number | null;
    height: number | null;
    checksum: string;
    colourway: string | null;
  }

  const rows: ImageRow[] = [];
  const heroByRacket = new Map<string, string>();
  const heroThumbByRacket = new Map<string, string>();
  let storedImages = 0;
  let thumbnailsMade = 0;
  let duplicateImages = 0;
  let done = 0;

  /** One provider's answer for one racket: what it published, and what we got. */
  interface Attempt {
    job: ImageJobOption;
    allowedPages: MatchCandidate[];
    images: (GalleryImage & { pageUrl: string })[];
    files: CrawledImage[];
    failures: string[];
  }

  /** Read one provider's pages for one racket and download what they carry. */
  const attemptProvider = async (job: ImageJobOption): Promise<Attempt> => {
    const robots = await robotsFor(job.provider.origin, USER_AGENT);
    const delayMs = Math.max(options.delayMs, job.provider.politenessMs ?? 0, robots.crawlDelayMs);

    const allowedPages = job.pages.filter((page) => isAllowed(robots, page.url));
    if (allowedPages.length === 0) {
      return { job, allowedPages, images: [], files: [], failures: [] };
    }

    // Read every page of the racket's family and pool their galleries. Each
    // page's images keep the page they came from, so `source_page_url` still
    // points at where a given photograph was actually published.
    const perPage: (GalleryImage & { pageUrl: string })[][] = [];
    const failures: string[] = [];

    for (const page of allowedPages) {
      // A candidate that already carries its gallery came from a shop API that
      // returned the images with the product, so there is nothing left to
      // fetch — the whole provider costs five requests, not one per racket.
      if (page.images && page.images.length > 0) {
        perPage.push(page.images.map((image) => ({ ...image, pageUrl: page.url })));
        continue;
      }

      await sleep(delayMs);
      const { images: found, error } = await readGallery(job.provider, page.url, options, browser);
      if (error) {
        failures.push(`${page.url}: ${error}`);
        continue;
      }
      if (found.length > 0) perPage.push(found.map((image) => ({ ...image, pageUrl: page.url })));
    }

    // Interleave rather than concatenate. `--max-images` is a per-racket cap,
    // and a racket sold in seven colours has seven pages of five shots; taking
    // them in page order would spend the whole budget on the first two colours
    // and store nothing at all of the other five. Round-robin means the cap
    // trims the tail of each colour's gallery instead of whole colours.
    const images: (GalleryImage & { pageUrl: string })[] = [];
    for (let rank = 0; perPage.some((page) => rank < page.length); rank++) {
      for (const page of perPage) if (rank < page.length) images.push(page[rank]);
    }

    const files = images.length === 0 ? [] : await downloadGallery(images, options, delayMs);
    return { job, allowedPages, images, files, failures };
  };

  for (const queued of queue) {
    let best = await attemptProvider(queued);

    // A gallery this thin is a placeholder page, not a listing, and the site
    // declared after this one may be the one that actually sells the frame.
    // Only then is it asked, and only a richer answer displaces this one.
    for (const alternative of queued.alternatives) {
      if (best.files.length >= options.minGallery) break;
      const other = await attemptProvider(alternative);
      if (other.files.length > best.files.length) best = other;
    }

    const { job, allowedPages, images, files, failures } = best;

    if (allowedPages.length === 0) {
      outcomes.push({
        racketId: job.racket.id,
        racketSlug: job.racket.slug,
        racketName: job.racket.name,
        brandSlug: job.racket.brandSlug,
        provider: job.provider.id,
        status: "skipped",
        pageUrl: job.pages[0].url,
        detail: "robots.txt disallows this url",
      });
      continue;
    }

    if (images.length === 0) {
      outcomes.push({
        racketId: job.racket.id,
        racketSlug: job.racket.slug,
        racketName: job.racket.name,
        brandSlug: job.racket.brandSlug,
        provider: job.provider.id,
        status: failures.length === allowedPages.length ? "fetch-failed" : "no-gallery",
        pageUrl: allowedPages[0].url,
        pagesCrawled: allowedPages.length,
        matchTier: job.tier,
        matchedAs: job.matchedAs,
        detail:
          failures.length > 0
            ? failures.join("; ")
            : "the page carries no structured product images",
      });
      continue;
    }

    let stored = 0;

    // Per racket, not global: the same photograph legitimately appears under
    // two rackets when a manufacturer reuses a technology diagram, and the
    // table's unique key is (racket_id, checksum) for that reason.
    const seenHere = new Set<string>();

    for (const file of files) {
      // `downloadGallery` has already dropped the duplicates within this page's
      // gallery — manufacturers publish the same photograph twice on one page,
      // once in the main gallery and once under the default colour swatch. This
      // guard catches the case it cannot see: the same shot arriving from two
      // different colourway *pages* of the same racket.
      const { checksum } = file;
      if (seenHere.has(checksum)) {
        duplicateImages++;
        continue;
      }
      seenHere.add(checksum);

      try {
        // Made from bytes already in memory, so this costs one pass over an
        // image we downloaded anyway. Null when sharp cannot decode the frame
        // or the result would not be smaller — both fall back to the original.
        const thumb = await makeThumbnail(file.bytes);

        const object = await store!.put({
          provider: job.provider.id,
          brandSlug: job.racket.brandSlug,
          racketSlug: job.racket.slug,
          position: stored,
          body: file.bytes,
          contentType: file.contentType,
          checksum,
          thumb,
        });

        const isHero = stored === 0;
        if (isHero) {
          heroByRacket.set(job.racket.id, object.publicUrl);
          if (object.thumbUrl) heroThumbByRacket.set(job.racket.id, object.thumbUrl);
        }
        if (thumb) thumbnailsMade++;

        rows.push({
          id: `img-${job.racket.slug}-${object.checksum.slice(0, 12)}`,
          racket_id: job.racket.id,
          provider: job.provider.id,
          source_url: file.url,
          source_page_url: file.pageUrl,
          storage_bucket: object.bucket,
          storage_path: object.path,
          public_url: object.publicUrl,
          thumb_path: object.thumbPath,
          thumb_url: object.thumbUrl,
          position: stored,
          is_hero: isHero,
          content_type: object.contentType,
          bytes: object.bytes,
          width: file.width,
          height: file.height,
          checksum: object.checksum,
          colourway: file.colourway ?? null,
        });

        stored++;
        storedImages++;
      } catch (err) {
        if (options.verbose) {
          console.log(`   ⚠️  ${job.racket.slug}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    outcomes.push({
      racketId: job.racket.id,
      racketSlug: job.racket.slug,
      racketName: job.racket.name,
      brandSlug: job.racket.brandSlug,
      provider: job.provider.id,
      status: stored > 0 ? "stored" : "no-gallery",
      pageUrl: allowedPages[0].url,
      pagesCrawled: allowedPages.length,
      matchTier: job.tier,
      matchedAs: job.matchedAs,
      candidatesConsidered: job.candidatesConsidered,
      imagesFound: images.length,
      imagesStored: stored,
    });

    done++;
    if (options.verbose || done % 25 === 0) {
      console.log(
        `   ${String(done).padStart(4)}/${queue.length}  ${job.racket.slug.padEnd(34)} ` +
          `${String(stored).padStart(2)} images  ${allowedPages[0].url}`,
      );
    }
  }

  await browser?.close();

  // --- Write the rows ------------------------------------------------------
  if (supabase && !options.dryRun && rows.length > 0) {
    console.log(`\n📡 Recording ${rows.length} images in racket_images…`);

    // A re-crawl *replaces* a racket's gallery rather than adding to it.
    //
    // Without this the run half-fails on its second pass. `racket_images` has a
    // partial unique index allowing one hero per racket, and a re-crawl that
    // finds a different lead photograph — which is what happens the moment a
    // provider changes source, as Yonex just did — inserts a second is_hero row
    // and the whole 500-row batch is rejected on the constraint.
    //
    // Replacing also fixes the quieter problem: rows whose photograph the
    // manufacturer has since removed, or which a tightened matcher no longer
    // produces, used to linger in the table with their objects orphaned in the
    // bucket. The old objects are deleted here, before the new rows land.
    const touched = [...new Set(rows.map((row) => row.racket_id))];
    const keep = new Set(rows.map((row) => `${row.racket_id}|${row.checksum}`));

    for (let i = 0; i < touched.length; i += 200) {
      const ids = touched.slice(i, i + 200);

      const { data: existing, error: readError } = await supabase
        .from("racket_images")
        .select("id, racket_id, checksum, storage_bucket, storage_path, thumb_path")
        .in("racket_id", ids);

      if (readError) {
        console.error(`❌ racket_images (read): ${readError.message}`);
        process.exitCode = 1;
        break;
      }

      // Clear the hero flag across the whole group first. Doing it before the
      // upsert is what makes the new hero insertable; the rows that survive get
      // their flag set again by the upsert a moment later.
      const { error: clearError } = await supabase
        .from("racket_images")
        .update({ is_hero: false })
        .in("racket_id", ids);
      if (clearError) {
        console.error(`❌ racket_images (clear hero): ${clearError.message}`);
        process.exitCode = 1;
        break;
      }

      const stale = (existing ?? []).filter(
        (row) => !keep.has(`${row.racket_id}|${row.checksum}`),
      );
      if (stale.length === 0) continue;

      const byBucket = new Map<string, string[]>();
      for (const row of stale) {
        const paths = [row.storage_path, row.thumb_path].filter(
          (path): path is string => Boolean(path),
        );
        byBucket.set(row.storage_bucket, [
          ...(byBucket.get(row.storage_bucket) ?? []),
          ...paths,
        ]);
      }
      for (const [bucket, paths] of byBucket) {
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error && options.verbose) console.log(`   ⚠️  ${bucket}: ${error.message}`);
      }

      const { error: deleteError } = await supabase
        .from("racket_images")
        .delete()
        .in("id", stale.map((row) => row.id));
      if (deleteError) {
        console.error(`❌ racket_images (delete stale): ${deleteError.message}`);
        process.exitCode = 1;
        break;
      }

      console.log(`   replaced ${stale.length} superseded image(s) across ${ids.length} rackets`);
    }

    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("racket_images")
        .upsert(batch, { onConflict: "racket_id,checksum" });
      if (error) {
        console.error(`❌ racket_images: ${error.message}`);
        process.exitCode = 1;
        break;
      }
    }

    // Drop rackets that dropped out of the catalogue entirely.
    //
    // The replace above only reaches rackets this run produced rows for. A
    // racket the matcher *stops* matching — because a provider changed source,
    // or because the matcher got stricter, both of which happened here — would
    // otherwise keep its old gallery forever, quietly attributing photographs
    // to a page that no longer claims them.
    //
    // Only a comprehensive run may prune, and the test is deliberately strict:
    // a `--provider=yonex --limit=5` run has no business deleting Victor's
    // rows just because it did not look at them.
    const comprehensive =
      options.refresh &&
      options.limit === Infinity &&
      PROVIDERS.every((provider) => options.providers.includes(provider.id));

    if (comprehensive) {
      const covered = new Set(touched);
      const orphans = new Map<string, { bucket: string; path: string }[]>();

      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("racket_images")
          .select("racket_id, storage_bucket, storage_path, thumb_path")
          .order("racket_id")
          .range(from, from + 999);
        if (error || !data || data.length === 0) break;

        for (const row of data as {
          racket_id: string;
          storage_bucket: string;
          storage_path: string;
          thumb_path: string | null;
        }[]) {
          if (covered.has(row.racket_id)) continue;
          const list = orphans.get(row.racket_id) ?? [];
          list.push({ bucket: row.storage_bucket, path: row.storage_path });
          if (row.thumb_path) list.push({ bucket: row.storage_bucket, path: row.thumb_path });
          orphans.set(row.racket_id, list);
        }
        if (data.length < 1000) break;
      }

      if (orphans.size > 0) {
        const byBucket = new Map<string, string[]>();
        for (const objects of orphans.values()) {
          for (const object of objects) {
            byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.path]);
          }
        }
        for (const [bucket, paths] of byBucket) {
          await supabase.storage.from(bucket).remove(paths);
        }

        const ids = [...orphans.keys()];
        await supabase.from("racket_images").delete().in("racket_id", ids);
        await supabase.from("rackets").update({ hero_image_url: null }).in("id", ids);

        console.log(
          `   pruned ${[...orphans.values()].flat().length} image(s) from ${ids.length} racket(s) ` +
            `that no longer match a product page`,
        );
      }
    }

    // The hero is denormalised onto the racket so a card render needs no join.
    // Written one at a time because it is an update of existing rows, not an
    // upsert — an upsert here would need every not-null column of `rackets`.
    let heroesWritten = 0;
    for (const [racketId, url] of heroByRacket) {
      const { error } = await supabase
        .from("rackets")
        .update({
          hero_image_url: url,
          // Null when this hero produced no thumbnail, which is also what the
          // column should say — the card falls back to the full-size image.
          hero_thumb_url: heroThumbByRacket.get(racketId) ?? null,
        })
        .eq("id", racketId);
      if (!error) heroesWritten++;
    }
    console.log(
      `   hero_image_url set on ${heroesWritten}/${heroByRacket.size} rackets, ` +
        `${heroThumbByRacket.size} with a thumbnail`,
    );
  }

  // --- Report --------------------------------------------------------------
  const byStatus = new Map<string, number>();
  for (const outcome of outcomes) byStatus.set(outcome.status, (byStatus.get(outcome.status) ?? 0) + 1);

  console.log("\n-------------------------------------------------");
  console.log("📊 Gallery crawl summary");
  console.log("-------------------------------------------------");
  for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(14)} ${String(count).padStart(5)} rackets`);
  }
  console.log(`  ${"images".padEnd(14)} ${String(storedImages).padStart(5)} stored`);
  if (duplicateImages > 0) {
    console.log(`  ${"".padEnd(14)} ${String(duplicateImages).padStart(5)} skipped as byte-identical duplicates`);
  }

  const withGallery = outcomes.filter((o) => o.status === "stored").length;
  if (queue.length > 0) {
    console.log(
      `\n  ${withGallery}/${queue.length} crawled rackets came back with a gallery ` +
        `(${((withGallery / queue.length) * 100).toFixed(0)}%).`,
    );
  }

  const noMatch = outcomes.filter((o) => o.status === "no-match").length;
  if (noMatch > 0) {
    console.log(
      `  ${noMatch} rackets had no product page on their manufacturer's site. That is expected:\n` +
        `  these catalogues carry region-specific and discontinued models the manufacturer no\n` +
        `  longer publishes, and the matcher refuses a near-miss rather than storing the wrong\n` +
        `  racket's photographs.`,
    );
  }
  console.log("-------------------------------------------------");

  if (options.outFile) {
    const outPath = resolve(process.cwd(), options.outFile);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          crawledAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          dryRun: options.dryRun,
          storage: { bucket: options.bucket, strategy: options.strategy },
          providers: providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            origin: provider.origin,
            platform: provider.platform,
            candidates: candidatesByProvider.get(provider.id)?.candidates.length ?? 0,
          })),
          uncoveredBrands: uncovered,
          totals: {
            racketsConsidered: inScope.length,
            racketsMatched: matched,
            racketsCrawled: queue.length,
            imagesStored: storedImages,
          },
          outcomes,
          images: rows,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\n💾 Wrote the run report to ${options.outFile}`);
  }

  if (options.dryRun) {
    console.log("\nℹ️  Dry run: nothing was uploaded and no rows were written.");
  } else if (supabase && rows.length > 0 && !process.exitCode) {
    // Catalogue data is cached and prerendered. Publishing the rows without
    // evicting this tag leaves listing/detail pages showing the previous
    // ownership until the six-hour safety-net revalidation runs.
    await revalidateCatalogue([TAG.rackets]);
  }
}

const invokedDirectly =
  process.argv[1]?.replace(/\\/g, "/").endsWith("images/index.ts") ||
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  crawlImages().catch((err) => {
    console.error("Image crawler failed:", err);
    process.exit(1);
  });
}
