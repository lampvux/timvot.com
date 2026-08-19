import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { loadEnv } from "./env";

import { scrapeVnb } from "./sites/vnb";
import { scrapeShopee } from "./sites/shopee";
import { scrapeWooCommerce, WOO_SITES } from "./sites/woocommerce";
import { normalizeScrapedProduct, slugify, type NormalizedItem } from "./normalizer";
import { canonicalName } from "./colourway";
import { verifyScrape, printVerificationReport, type SiteVerification } from "./verify";
import type { ScraperResult, ScrapedProduct, ScraperSource, ScraperOptions } from "./types";

const ALL_SOURCES: ScraperSource[] = ["vnb", "qvbadminton", "fbshop", "hvshop", "shopee"];

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
      ? ALL_SOURCES
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
  console.log(`Sync to DB  : ${options.syncDb ? "yes" : "no"}`);
  console.log(`Output      : ${options.outFile ?? "none"}`);
  console.log("=================================================\n");

  const results: ScraperResult[] = [];

  for (const source of options.sites) {
    console.log(`🔄 [${source.toUpperCase()}] scraping…`);
    const result = await runSite(source, {
      maxPages: options.maxPages,
      verbose: options.verbose,
      concurrency: options.concurrency,
      delayMs: options.delayMs,
    });
    results.push(result);

    const seconds = (result.durationMs / 1000).toFixed(1);
    if (result.success) {
      console.log(
        `✅ [${source.toUpperCase()}] ${result.itemsCount} rackets from ` +
          `${result.pagesFetched ?? "?"} pages in ${seconds}s` +
          (result.reportedTotal ? ` (site reports ${result.reportedTotal} in category)` : "") +
          (result.skippedNonRacket ? `, ${result.skippedNonRacket} accessories skipped` : ""),
      );
      for (const note of result.notes ?? []) console.log(`   ℹ️  ${note}`);
    } else {
      console.log(`❌ [${source.toUpperCase()}] failed after ${seconds}s`);
      if (result.error) console.log(`   ${result.error}`);
    }
  }

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
  for (const result of results) {
    console.log(
      `  ${result.source.padEnd(12)} ${String(result.itemsCount).padStart(5)} products` +
        (result.success ? "" : "   (FAILED — see error above)"),
    );
  }
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
      process.exitCode = 1;
    }
  }

  // --- Optional DB sync ----------------------------------------------------
  if (options.syncDb) {
    await syncToSupabase(normalized);
  } else if (!options.dryRun) {
    console.log("ℹ️  Not syncing to the database. Re-run with --sync-db to write offers.");
  }

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    console.log(
      `\n⚠️  ${failed.length} source(s) failed: ${failed.map((f) => f.source).join(", ")}`,
    );
  }
}

async function syncToSupabase(items: NormalizedItem[]) {
  loadEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "❌ Cannot sync: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
        "   Catalogue writes are admin-only under RLS, so the publishable key will not work.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`📡 Syncing ${items.length} offers to Supabase…`);
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const today = new Date().toISOString().slice(0, 10);

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

  const steps: [string, string, Record<string, unknown>[], string][] = [
    ["brands", "id", [...brands.values()], "id"],
    ["sellers", "id", [...sellers.values()], "id"],
    ["rackets", "id", [...rackets.values()], "id"],
    ["racket_variants", "id", [...variants.values()], "id"],
    ["offers", "id", offers, "id"],
    ["price_points", "variant_id,observed_on", [...pricePoints.values()], "variant_id,observed_on"],
  ];

  for (const [table, , rows, onConflict] of steps) {
    let written = 0;
    for (const batch of chunk(rows)) {
      const { error } = await supabase.from(table).upsert(batch, { onConflict });
      if (error) {
        console.error(`❌ ${table}: ${error.message}`);
        process.exitCode = 1;
        break;
      }
      written += batch.length;
    }
    console.log(`   ${table.padEnd(16)} ${written}/${rows.length} rows`);
  }

  console.log("🎉 DB sync finished.");
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
