import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "./env";

import { scrapeVnb } from "./sites/vnb";
import { scrapeShopee } from "./sites/shopee";
import { scrapeWooCommerce, WOO_SITES } from "./sites/woocommerce";
import { normalizeScrapedProduct, slugify, type NormalizedItem } from "./normalizer";
import { canonicalName } from "./colourway";
import { verifyScrape, printVerificationReport, type SiteVerification } from "./verify";
import { revalidateCatalogue } from "./revalidate";
import { describeBudget, walkSites } from "./guard";
import {
  annotateSkippedSites,
  renderConsoleSummary,
  renderRunSummary,
  runVerdict,
  siteStatus,
  writeStepSummary,
} from "./report";
import type { ScraperResult, ScrapedProduct, ScraperSource, ScraperOptions } from "./types";

const ALL_SOURCES: ScraperSource[] = ["vnb", "qvbadminton", "fbshop", "hvshop", "shopee"];

/**
 * What `--site=all` means. Shopee is deliberately not in it: the endpoint is
 * gated behind device attestation and answers 403 to every request, so keeping
 * it in the default set made every scheduled run end with a failure line and
 * a non-zero exit code that meant nothing. It is still reachable with
 * `--site=shopee` for the day access is granted.
 */
const DEFAULT_SOURCES: ScraperSource[] = ["vnb", "qvbadminton", "fbshop", "hvshop"];

interface CliOptions {
  sites: ScraperSource[];
  dryRun: boolean;
  syncDb: boolean;
  verbose: boolean;
  /** `Infinity` unless --pages is given. */
  maxPages: number;
  verify: boolean;
  sampleSize: number;
  outFile: string | null;
  /** Path to a saved scrape to re-verify instead of scraping. */
  verifyOnly: string | null;
  concurrency: number;
  delayMs: number;
  /** Pause offers a full walk no longer found. Off for partial walks. */
  retireStale: boolean;
  /** Retire even when the sweep would pause most of a seller's catalogue. */
  forceRetire: boolean;
  /** Per-shop budget in ms. `Infinity` waits for as long as a shop takes. */
  siteTimeoutMs: number;
  /** Go red the moment any one shop fails, the way the run used to. */
  failOnSiteError: boolean;
}

function parseArgs(): CliOptions {
  const flags: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      flags[key] = value === undefined ? true : value;
    }
  }

  const siteFlag = String(flags.site ?? flags.sites ?? "all").toLowerCase();
  const sites =
    siteFlag === "all"
      ? DEFAULT_SOURCES
      : (siteFlag.split(",").map((s) => s.trim()) as ScraperSource[]).filter((s) =>
          ALL_SOURCES.includes(s),
        );

  return {
    sites,
    dryRun: Boolean(flags["dry-run"]),
    syncDb: Boolean(flags["sync-db"]),
    verbose: Boolean(flags.verbose),
    // Default is the whole catalogue; --pages=N caps it for a quick run.
    maxPages: flags.pages ? parseInt(String(flags.pages), 10) : Infinity,
    verify: flags.verify !== "false" && flags["no-verify"] !== true,
    sampleSize: flags.sample ? parseInt(String(flags.sample), 10) : 5,
    outFile: (() => {
      if (flags.out === undefined) return "scripts/scraper/output/rackets.json";
      const value = String(flags.out).toLowerCase();
      return value === "false" || value === "none" || value === "" ? null : String(flags.out);
    })(),
    verifyOnly:
      flags["verify-only"] === undefined
        ? null
        : flags["verify-only"] === true
          ? "scripts/scraper/output/rackets.json"
          : String(flags["verify-only"]),
    concurrency: flags.concurrency ? parseInt(String(flags.concurrency), 10) : 4,
    delayMs: flags.delay ? parseInt(String(flags.delay), 10) : 150,
    // Only a complete walk knows what is missing. After `--pages=3`, almost
    // everything is "missing", and sweeping would pause the whole catalogue.
    retireStale: !flags.pages && flags["no-retire"] !== true,
    forceRetire: flags["force-retire"] === true,
    // A shop that stops answering mid-walk blocks every shop queued behind it
    // for as long as its own retries last, which on a bad night is longer than
    // the whole run. 30 minutes is several times the slowest healthy walk.
    // `--site-timeout=0` waits indefinitely.
    siteTimeoutMs: (() => {
      if (flags["site-timeout"] === undefined) return 30 * 60 * 1000;
      const seconds = parseInt(String(flags["site-timeout"]), 10);
      if (!Number.isFinite(seconds) || seconds <= 0) return Infinity;
      return seconds * 1000;
    })(),
    failOnSiteError: flags["fail-on-site-error"] === true,
  };
}

/**
 * Re-run the browser verification against a scrape already on disk. Walking the
 * four catalogues takes minutes; re-checking them in a browser should not
 * require doing that again.
 */
async function runVerifyOnly(file: string, sampleSize: number) {
  const path = resolve(process.cwd(), file);
  console.log(`🔎 Verifying the saved scrape at ${file}\n`);

  const saved = JSON.parse(readFileSync(path, "utf8")) as {
    sources?: { source: ScraperSource; itemsCount: number; pagesFetched?: number; reportedTotal?: number }[];
    items?: NormalizedItem[];
  };

  const items = saved.items ?? [];
  if (items.length === 0) {
    console.error("❌ That file contains no items.");
    process.exitCode = 1;
    return;
  }

  // Rebuild the per-source results the verifier expects from the saved items.
  const bySource = new Map<ScraperSource, ScrapedProduct[]>();
  for (const item of items) {
    const list = bySource.get(item.scraped.source) ?? [];
    list.push(item.scraped);
    bySource.set(item.scraped.source, list);
  }

  const results: ScraperResult[] = [...bySource.entries()].map(([source, products]) => {
    const meta = saved.sources?.find((s) => s.source === source);
    return {
      source,
      success: true,
      itemsCount: products.length,
      products,
      durationMs: 0,
      pagesFetched: meta?.pagesFetched,
      reportedTotal: meta?.reportedTotal,
    };
  });

  const verifications = await verifyScrape(results, { sampleSize, verbose: true });
  printVerificationReport(verifications);

  const parsed = JSON.parse(readFileSync(path, "utf8"));
  parsed.verification = verifications;
  writeFileSync(path, JSON.stringify(parsed, null, 2), "utf8");
  console.log(`💾 Verification results folded back into ${file}`);
}

async function runSite(source: ScraperSource, options: ScraperOptions): Promise<ScraperResult> {
  switch (source) {
    case "vnb":
      return scrapeVnb(options);
    case "fbshop":
    case "qvbadminton":
    case "hvshop":
      return scrapeWooCommerce(WOO_SITES[source], options);
    case "shopee":
      return scrapeShopee(options);
  }
}

/**
 * The same model reaches us under several spellings — "THRUSTER RYUGA CLS" from
 * one shop, "Thruster Ryuga CLS" from another, "thruster ryuga cls" from a
 * third. They already collapse to one slug because slugs are lowercased, but
 * the display name has to be chosen rather than left to whichever listing was
 * scraped last. Pick one per racket and apply it to every item in the group.
 */
function applyCanonicalNames(items: NormalizedItem[]): void {
  const namesBySlug = new Map<string, string[]>();
  for (const item of items) {
    const list = namesBySlug.get(item.racketSlug) ?? [];
    list.push(item.racketName);
    namesBySlug.set(item.racketSlug, list);
  }

  const chosen = new Map<string, string>();
  for (const [slug, names] of namesBySlug) chosen.set(slug, canonicalName(names));

  for (const item of items) {
    item.racketName = chosen.get(item.racketSlug) ?? item.racketName;
  }
}

/**
 * Not every shop bothers to name the colour. "Astrox 77 Play Limited" arrives
 * from one retailer as "Light Beige" and from another with no colour at all —
 * the same frame, in the same weight and grip. Left alone that becomes two
 * variants, one of them a phantom with a null colourway.
 *
 * So where a racket/weight/grip group names exactly one colour, the unnamed
 * listings in that group adopt it. Where the group names two or more, the
 * unnamed listing genuinely could be any of them and stays unspecified rather
 * than being assigned a colour it may not have.
 */
function reconcileColourways(items: NormalizedItem[]): number {
  const groups = new Map<string, NormalizedItem[]>();
  for (const item of items) {
    const key = `${item.racketSlug}|${item.weightClass}|${item.gripSize}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  let filled = 0;
  for (const group of groups.values()) {
    const named = [...new Set(group.map((i) => i.colourway).filter(Boolean))] as string[];
    if (named.length !== 1) continue;

    for (const item of group) {
      if (item.colourway) continue;
      item.colourway = named[0];
      item.variantId = variantIdFor(item);
      filled++;
    }
  }
  return filled;
}

/** The variant key: one racket, one weight, one grip, one colour. */
function variantIdFor(item: NormalizedItem): string {
  const colourSlug = item.colourway ? slugify(item.colourway).slice(0, 24).replace(/-+$/, "") : "";
  return [`v-${item.racketSlug}`, item.weightClass, item.gripSize, colourSlug]
    .filter(Boolean)
    .join("-")
    .toLowerCase();
}

/**
 * One racket sold by two shops is two offers, not two rackets — dedupe within a
 * source by the site's own product id, and report cross-source overlap so the
 * catalogue count is honest.
 */
function dedupe(products: ScrapedProduct[]): ScrapedProduct[] {
  const seen = new Map<string, ScrapedProduct>();
  for (const product of products) {
    const key = `${product.source}:${product.externalId ?? product.url}`;
    if (!seen.has(key)) seen.set(key, product);
  }
  return [...seen.values()];
}

export async function runScrapers() {
  const options = parseArgs();
  const startedAt = Date.now();

  if (options.verifyOnly) {
    await runVerifyOnly(options.verifyOnly, options.sampleSize);
    return;
  }

  console.log("=================================================");
  console.log("🏸 Shuttlecraft Multi-Site Racket Scraper");
  console.log("=================================================");
  console.log(`Sites       : ${options.sites.join(", ")}`);
  console.log(`Page limit  : ${options.maxPages === Infinity ? "all pages" : options.maxPages}`);
  console.log(`Verify      : ${options.verify ? `yes (browser, ${options.sampleSize}/site)` : "no"}`);
  console.log(
    `Sync to DB  : ${options.syncDb ? "yes" : "no"}` +
      (options.syncDb
        ? options.retireStale
          ? " (stale offers will be paused)"
          : " (stale offers left alone — partial walk)"
        : ""),
  );
  console.log(`Output      : ${options.outFile ?? "none"}`);
  console.log(
    `Per shop    : ${
      Number.isFinite(options.siteTimeoutMs)
        ? `${describeBudget(options.siteTimeoutMs)} budget, then skipped`
        : "no time limit"
    }` +
      (options.failOnSiteError
        ? " (one failure fails the run)"
        : " (a failure skips that shop only)"),
  );
  console.log("=================================================\n");

  const results = await walkSites(
    options.sites,
    (source, signal) =>
      runSite(source, {
        maxPages: options.maxPages,
        verbose: options.verbose,
        concurrency: options.concurrency,
        delayMs: options.delayMs,
        signal,
      }),
    {
      timeoutMs: options.siteTimeoutMs,
      onStart: (source) => console.log(`🔄 [${source.toUpperCase()}] scraping…`),
      onResult: printSiteResult,
    },
  );

  const allProducts = dedupe(results.flatMap((r) => r.products));
  const normalized: NormalizedItem[] = allProducts.map(normalizeScrapedProduct);
  applyCanonicalNames(normalized);
  const colourwaysFilled = reconcileColourways(normalized);

  // --- Summary ------------------------------------------------------------
  const byBrand = new Map<string, number>();
  for (const item of normalized) byBrand.set(item.brandName, (byBrand.get(item.brandName) ?? 0) + 1);
  const uniqueRackets = new Set(normalized.map((i) => i.racketSlug));
  const uniqueVariants = new Set(normalized.map((i) => i.variantId));
  const withColour = normalized.filter((i) => i.colourway).length;
  const prices = normalized.map((i) => i.price).sort((a, b) => a - b);

  console.log("\n-------------------------------------------------");
  console.log("📊 Scrape summary");
  console.log("-------------------------------------------------");
  console.log(renderConsoleSummary(results));
  console.log(`  ${"TOTAL".padEnd(12)} ${String(allProducts.length).padStart(5)} offers`);
  console.log(`  ${"".padEnd(12)} ${String(uniqueVariants.size).padStart(5)} variants (weight × grip × colour)`);
  console.log(`  ${"".padEnd(12)} ${String(uniqueRackets.size).padStart(5)} distinct racket models`);
  console.log(
    `  ${"".padEnd(12)} ${String(withColour).padStart(5)} listings carry a colourway ` +
      `(folded into variants, not separate models)`,
  );
  if (colourwaysFilled > 0) {
    console.log(
      `  ${"".padEnd(12)} ${String(colourwaysFilled).padStart(5)} of those inherited their colour from a ` +
        `sibling listing of the same variant`,
    );
  }

  if (prices.length > 0) {
    const median = prices[Math.floor(prices.length / 2)];
    const fmt = (n: number) => `₫${n.toLocaleString("de-DE")}`;
    console.log(
      `  Price range: ${fmt(prices[0])} – ${fmt(prices[prices.length - 1])} (median ${fmt(median)})`,
    );
  }

  const topBrands = [...byBrand.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log("\n  Brands found:");
  for (const [name, count] of topBrands) {
    console.log(`    ${name.padEnd(14)} ${count}`);
  }
  const otherCount = byBrand.get("Other") ?? 0;
  if (otherCount > 0) {
    console.log(`\n  ⚠️  ${otherCount} products (${((otherCount / normalized.length) * 100).toFixed(1)}%) did not match a known brand.`);
  }
  console.log("-------------------------------------------------\n");

  if (options.verbose && normalized.length > 0) {
    console.log("Sample normalized items:");
    console.dir(
      normalized.slice(0, 3).map((i) => ({
        brand: i.brandName,
        model: i.racketName,
        slug: i.racketSlug,
        price: i.price,
        url: i.scraped.url,
      })),
      { depth: null },
    );
    console.log();
  }

  // --- Output --------------------------------------------------------------
  // Written before verification, not after. A full walk of these catalogues
  // takes minutes; a browser that fails to start must not throw that away.
  const writeOutput = (verifications: SiteVerification[] | null) => {
    if (!options.outFile) return;
    const outPath = resolve(process.cwd(), options.outFile);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          scrapedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          sources: results.map((r) => ({
            source: r.source,
            success: r.success,
            itemsCount: r.itemsCount,
            pagesFetched: r.pagesFetched,
            reportedTotal: r.reportedTotal,
            skippedNonRacket: r.skippedNonRacket,
            error: r.error,
            notes: r.notes,
          })),
          verification: verifications,
          totals: {
            offers: allProducts.length,
            distinctRackets: uniqueRackets.size,
            brands: Object.fromEntries(byBrand),
          },
          items: normalized,
        },
        null,
        2,
      ),
      "utf8",
    );
  };

  writeOutput(null);
  if (options.outFile) console.log(`💾 Wrote ${normalized.length} items to ${options.outFile}`);

  // --- Browser verification ------------------------------------------------
  if (options.verify) {
    try {
      const verifications = await verifyScrape(results, {
        sampleSize: options.sampleSize,
        verbose: true,
      });
      printVerificationReport(verifications);
      // Fold the verification into the file we already wrote.
      writeOutput(verifications);
    } catch (err) {
      console.error(
        `\n⚠️  Browser verification could not run: ` +
          `${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
      console.error(
        `   The scrape itself is unaffected and is saved. Re-run verification on its own with:\n` +
          `     npm run scrape -- --verify-only${options.outFile ? `=${options.outFile}` : ""}`,
      );
      // Deliberately not an exit code. Verification is a second opinion on a
      // scrape that is already written, and a Chromium that would not start is
      // no reason to skip the sync, the audit and the backup that follow.
    }
  }

  // --- Optional DB sync ----------------------------------------------------
  if (options.syncDb) {
    const synced = await syncToSupabase(normalized, results, options);
    // Only when the sync itself reported clean: revalidating after a partial
    // write would publish a half-updated catalogue rather than hold the last
    // good one until the next run. A skipped shop is not a partial write —
    // the shops that did answer wrote everything they had.
    if (synced) {
      await revalidateCatalogue();
    } else {
      process.exitCode = 1;
    }
  } else if (!options.dryRun) {
    console.log("ℹ️  Not syncing to the database. Re-run with --sync-db to write offers.");
  }

  // --- The report, and the one verdict that reaches the exit code ----------
  const skipped = results.filter((r) => siteStatus(r) === "skipped");
  if (skipped.length > 0) {
    console.log(
      `\n⏭️  ${skipped.length} of ${results.length} shop(s) skipped: ` +
        `${skipped.map((r) => r.source).join(", ")}. Their offers keep the prices they ` +
        `last published; nothing was retired for them.`,
    );
  }

  annotateSkippedSites(results);
  writeStepSummary(
    renderRunSummary(results, {
      offers: allProducts.length,
      variants: uniqueVariants.size,
      rackets: uniqueRackets.size,
      colourwaysFilled,
    }),
  );

  const verdict = runVerdict(results, { strict: options.failOnSiteError });
  if (verdict.failed) {
    console.error(`\n❌ ${verdict.reason}`);
    process.exitCode = 1;
  }
}

function printSiteResult(result: ScraperResult): void {
  const label = result.source.toUpperCase();
  const seconds = (result.durationMs / 1000).toFixed(1);

  if (result.success) {
    console.log(
      `✅ [${label}] ${result.itemsCount} rackets from ` +
        `${result.pagesFetched ?? "?"} pages in ${seconds}s` +
        (result.reportedTotal ? ` (site reports ${result.reportedTotal} in category)` : "") +
        (result.skippedNonRacket ? `, ${result.skippedNonRacket} accessories skipped` : ""),
    );
    for (const note of result.notes ?? []) console.log(`   ℹ️  ${note}`);
    return;
  }

  console.log(
    `⏭️  [${label}] ${result.timedOut ? "timed out" : "failed"} after ${seconds}s — ` +
      `skipping this shop`,
  );
  if (result.error) console.log(`   ${result.error}`);
  if (result.itemsCount > 0) {
    console.log(`   ${result.itemsCount} rackets were read before it stopped and are kept.`);
  }
  console.log(
    `   The remaining shops carry on, and nothing is retired for ${result.source} — a shop ` +
      `we could not walk tells us nothing about what it has stopped selling.`,
  );
}

/**
 * Push a scrape into Postgres.
 *
 * This is written to be run again tomorrow, and the day after, without
 * damaging what it wrote today. Two rules follow from that:
 *
 *  - **The scraper owns prices and stock; it does not own the catalogue.** A
 *    listing title says nothing about balance point, frame material or a
 *    seller's rating, so the parent rows below are inserted when they are new
 *    and left alone when they already exist. Every run used to upsert them in
 *    full, which meant a nightly price refresh reset each racket's balance
 *    point to the placeholder 295 mm, its frame material to ["HM Graphite"]
 *    and its release year to the current one, and stamped every seller back to
 *    tier 'verified', rating 4.8, 500 orders.
 *  - **An offer that vanished from a shop is not an offer.** After a complete
 *    walk, offers from the sellers we just walked that were not seen this run
 *    are paused and zeroed, rather than left advertising last month's price as
 *    live. A partial walk (`--pages=N`) never sweeps: it has not seen enough
 *    of the catalogue to know what is missing.
 */
async function syncToSupabase(
  items: NormalizedItem[],
  results: ScraperResult[],
  options: CliOptions,
): Promise<boolean> {
  loadEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "❌ Cannot sync: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
        "   Catalogue writes are admin-only under RLS, so the publishable key will not work.",
    );
    return false;
  }

  console.log(`📡 Syncing ${items.length} offers to Supabase…`);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const today = new Date().toISOString().slice(0, 10);

  // Reported at the end rather than thrown at the first error: a table that
  // fails is worth recording without abandoning the tables after it.
  let ok = true;

  // Deduplicate the parent rows so a 3.000-offer scrape is a handful of upserts
  // rather than 3.000 round-trips per table.
  const brands = new Map<string, { id: string; slug: string; name: string }>();
  const rackets = new Map<string, Record<string, unknown>>();
  const variants = new Map<string, Record<string, unknown>>();
  const sellers = new Map<string, Record<string, unknown>>();
  const offers: Record<string, unknown>[] = [];
  const pricePoints = new Map<string, Record<string, unknown>>();

  for (const item of items) {
    brands.set(item.brandSlug, {
      id: `b-${item.brandSlug}`,
      slug: item.brandSlug,
      name: item.brandName,
    });

    const racketId = `r-${item.racketSlug}`;
    if (!rackets.has(racketId)) {
      rackets.set(racketId, {
        id: racketId,
        slug: item.racketSlug,
        brand_id: `b-${item.brandSlug}`,
        name: item.racketName,
        release_year: new Date().getFullYear(),
        balance_point_mm: item.specs.balancePointMm ?? 295,
        shaft_flex: item.specs.shaftFlex ?? "medium",
        shaft_diameter_mm: 6.8,
        frame_shape: "isometric",
        frame_material: ["HM Graphite"],
        max_tension_min_lbs: item.specs.maxTensionLbs?.[0] ?? 20,
        max_tension_max_lbs: item.specs.maxTensionLbs?.[1] ?? 28,
        length_mm: 675,
        string_pattern: "22×21",
        msrp: item.msrp,
        currency: "VND",
        play_style_tags: ["all-round"],
        skill_level: "intermediate",
      });
    }

    variants.set(item.variantId, {
      id: item.variantId,
      racket_id: racketId,
      weight_class: item.weightClass,
      weight_grams:
        item.weightClass === "2U" ? 92 : item.weightClass === "3U" ? 87 : item.weightClass === "5U" ? 77 : 82,
      grip_size: item.gripSize,
      colourway: item.colourway,
      sku: [
        item.brandSlug.toUpperCase(),
        item.racketSlug.slice(0, 12).toUpperCase(),
        item.weightClass,
        item.colourway ? slugify(item.colourway).slice(0, 10).toUpperCase() : null,
      ]
        .filter(Boolean)
        .join("-"),
    });

    sellers.set(item.sellerSlug, {
      id: item.sellerSlug,
      slug: item.sellerSlug.replace(/^s-/, ""),
      name: `${item.scraped.source.toUpperCase()} Store`,
      tier: "verified",
      city: "TP. Hồ Chí Minh",
      rating: 4.8,
      orders_count: 500,
      since: 2020,
    });

    offers.push({
      id: `o-${item.scraped.source}-${item.scraped.externalId ?? item.racketSlug}`,
      variant_id: item.variantId,
      racket_id: racketId,
      seller_id: item.sellerSlug,
      price: item.price,
      currency: "VND",
      qty_available: item.qtyAvailable,
      condition: "new",
      status: item.inStock ? "live" : "paused",
      updated_at: new Date().toISOString(),
    });

    // One price point per variant per day; keep the lowest offer seen.
    const key = `${item.variantId}|${today}`;
    const existing = pricePoints.get(key);
    if (!existing || (existing.price as number) > item.price) {
      pricePoints.set(key, { variant_id: item.variantId, observed_on: today, price: item.price });
    }
  }

  const chunk = <T,>(rows: T[], size = 500): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
  };

  // --- Catalogue rows: insert when new, never overwrite --------------------
  // `ignoreDuplicates` is ON CONFLICT DO NOTHING. That is the whole point: the
  // specs and seller fields in these payloads are placeholders good enough to
  // create a row that does not exist yet, and nowhere near good enough to
  // replace one that does.
  const catalogue: [string, Record<string, unknown>[]][] = [
    ["brands", [...brands.values()]],
    ["sellers", [...sellers.values()]],
    ["rackets", [...rackets.values()]],
    ["racket_variants", [...variants.values()]],
  ];

  for (const [table, rows] of catalogue) {
    let offered = 0;
    for (const batch of chunk(rows)) {
      const { error } = await supabase
        .from(table)
        .upsert(batch, { onConflict: "id", ignoreDuplicates: true });
      if (error) {
        console.error(`❌ ${table}: ${error.message}`);
        // Offers reference every one of these tables; carrying on would just
        // produce a wall of foreign-key errors.
        return false;
      }
      offered += batch.length;
    }
    console.log(`   ${table.padEnd(16)} ${offered} rows offered, existing rows untouched`);
  }

  // --- Price history: one point per variant per day, the lowest seen --------
  // This runs several times a day, so fold in what is already recorded for
  // today before writing. Without it the last run of the day wins rather than
  // the cheapest, and the "lowest price today" claim quietly stops being true.
  const observedVariants = [...pricePoints.values()].map((p) => String(p.variant_id));
  for (const batch of chunk(observedVariants, 200)) {
    const { data, error } = await supabase
      .from("price_points")
      .select("variant_id, price")
      .eq("observed_on", today)
      .in("variant_id", batch);
    if (error) {
      // Only folding in what is already recorded for today, which is a
      // refinement of the price we are about to write — not a reason to skip
      // writing prices and stock at all.
      console.error(`❌ price_points (read): ${error.message}`);
      ok = false;
      break;
    }
    for (const row of data ?? []) {
      const ours = pricePoints.get(`${row.variant_id}|${today}`);
      if (ours && Number(row.price) < Number(ours.price)) ours.price = Number(row.price);
    }
  }

  // --- Prices and stock: these the scraper does own -------------------------
  const priced: [string, Record<string, unknown>[], string][] = [
    ["offers", offers, "id"],
    ["price_points", [...pricePoints.values()], "variant_id,observed_on"],
  ];

  for (const [table, rows, onConflict] of priced) {
    let written = 0;
    for (const batch of chunk(rows)) {
      const { error } = await supabase.from(table).upsert(batch, { onConflict });
      if (error) {
        console.error(`❌ ${table}: ${error.message}`);
        ok = false;
        break;
      }
      written += batch.length;
    }
    console.log(`   ${table.padEnd(16)} ${written}/${rows.length} rows written`);
  }

  // --- Retire what the shops no longer list --------------------------------
  // The one thing that must not run after a failed write. The sweep pauses
  // offers this run did not see; doing that when the offer writes only partly
  // landed would pause rows whose replacements never arrived.
  if (!ok) {
    console.warn(
      "   stale offers     left as they are — a write failed earlier in this sync, and " +
        "pausing offers whose replacements may not have landed would empty the board",
    );
    return false;
  }

  const seenOfferIds = new Set(offers.map((o) => String(o.id)));
  const retired = await retireUnseenOffers(supabase, results, seenOfferIds, options);

  console.log("🎉 DB sync finished.");
  return retired;
}

/**
 * Pause the offers a seller no longer lists.
 *
 * Only sellers this run actually walked are considered, and only after a full
 * walk: a source that failed, returned nothing, or was capped with `--pages`
 * tells us nothing about what it has stopped selling.
 *
 * The rows are paused and zeroed rather than deleted, so the price history
 * hanging off the variant survives and a listing that comes back tomorrow is
 * one upsert away from live again.
 */
async function retireUnseenOffers(
  supabase: SupabaseClient,
  results: ScraperResult[],
  seenOfferIds: Set<string>,
  options: CliOptions,
): Promise<boolean> {
  if (!options.retireStale) {
    console.log(
      "   stale offers     left as they are " +
        "(a partial walk cannot tell a delisted racket from an unvisited page)",
    );
    return true;
  }

  // Only the sellers this run actually walked. A shop that was skipped keeps
  // every offer it has: we did not see its catalogue, so we know nothing about
  // what it has stopped selling.
  const walked = results.filter((r) => r.success && r.itemsCount > 0);
  if (walked.length === 0) return true;

  const stamp = new Date().toISOString();
  let ok = true;

  for (const result of walked) {
    const sellerId = `s-${result.source}`;

    const existing: string[] = [];
    let readFailed = false;
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("offers")
        .select("id")
        .eq("seller_id", sellerId)
        .eq("status", "live")
        .range(from, from + pageSize - 1);
      if (error) {
        // One seller's read failing says nothing about the next seller's, so
        // record it and move on rather than abandoning the whole sweep.
        console.error(`❌ offers (read for ${sellerId}): ${error.message}`);
        ok = false;
        readFailed = true;
        break;
      }
      for (const row of data ?? []) existing.push(String(row.id));
      if (!data || data.length < pageSize) break;
    }
    if (readFailed) continue;

    const stale = existing.filter((id) => !seenOfferIds.has(id));
    if (stale.length === 0) {
      console.log(`   ${sellerId.padEnd(16)} nothing to retire`);
      continue;
    }

    // A shop that changed its theme overnight looks exactly like a shop that
    // delisted everything. Refuse the sweep when it would take out most of the
    // seller's board and say so, rather than emptying the catalogue unattended.
    const share = stale.length / existing.length;
    if (share > 0.5 && !options.forceRetire) {
      console.warn(
        `   ⚠️  ${sellerId}: ${stale.length}/${existing.length} live offers went unseen ` +
          `(${Math.round(share * 100)}%). That looks like a broken scrape rather than a ` +
          `delisting, so nothing was paused. Check the source, then re-run with ` +
          `--force-retire if it is real.`,
      );
      continue;
    }

    let paused = 0;
    for (let i = 0; i < stale.length; i += 200) {
      const batch = stale.slice(i, i + 200);
      const { error } = await supabase
        .from("offers")
        .update({ status: "paused", qty_available: 0, updated_at: stamp })
        .in("id", batch);
      if (error) {
        console.error(`❌ offers (retire ${sellerId}): ${error.message}`);
        ok = false;
        break;
      }
      paused += batch.length;
    }
    console.log(`   ${sellerId.padEnd(16)} ${paused} offers no longer listed — paused`);
  }

  return ok;
}

const invokedDirectly =
  process.argv[1]?.replace(/\\/g, "/").endsWith("scraper/index.ts") ||
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  runScrapers().catch((err) => {
    console.error("Scraper engine failed:", err);
    process.exit(1);
  });
}
