/**
 * vssports.vn's racket catalogue, read as catalogue rows rather than as offers.
 *
 *   npx tsx scripts/scraper/vssports-catalogue.ts            # crawl and report, write nothing
 *   npx tsx scripts/scraper/vssports-catalogue.ts --sync-db  # upsert rackets and variants
 *
 * The second VS source, and the wider of the two. `venson-catalogue.ts` reads
 * the brand's own WooCommerce property, which publishes 42 rackets; VS Sports
 * publishes 121 over seven pages of one category — the licensed Kimetsu no
 * Yaiba and One Piece frames, the whole Challenger and Blade numbering, the
 * Titan line, the Youlong colours — and this catalogue holds 134 VS rows, most
 * of which neither site had a page for until now. `images/providers.ts` reads
 * the photographs; this reads the names, the price and the specification, and
 * writes the frames the catalogue does not hold.
 *
 * Why this is not a `sites/` adapter, when the site does quote prices: the same
 * reason venson.vn and fleet.vn are not. Everything in `sites/` reads a *shop*
 * and produces offers, and an offer needs a seller row, a stock state and the
 * nightly sweep that retires what a shop stopped listing. This is the brand's
 * store with a list price on it, not one of the four storefronts the price
 * comparison is built from. So the price lands where a manufacturer's price
 * belongs — `rackets.msrp` — and the racket carries no offer at all until a shop
 * that sells it is scraped.
 *
 * ------------------------------------------------------------------
 * One request per product, and no API to have asked instead
 *
 * venson.vn has the WooCommerce Store API switched on, so its whole import is
 * two requests. This shop is a Bizweb store whose theme answers 404 to every
 * JSON endpoint the platform normally exposes, so the listing is walked as
 * rendered HTML by `discoverCandidates` and each product page is then opened
 * once. Seven listing pages and 121 product pages, 400 ms apart.
 *
 * What each page carries, and where:
 *
 *   [itemprop="price"]   the price in dong, as an integer. Exactly one node per
 *                        page — there is no regular/sale split on this shop, so
 *                        unlike venson.vn there is no choice to make about which
 *                        of the two `rackets.msrp` should hold.
 *   .variant-sku         "VS168-168", the shop's own code. The only stable key a
 *                        page has: the permalink is the title slugified and
 *                        changes when the copy does.
 *   #tab-1               the description, and inside it the `label: value` spec
 *                        block that `vs-specs.ts` reads. Every one of the 121
 *                        publishes one, which is the other thing this site has
 *                        over venson.vn, where nineteen of 42 publish nothing.
 *
 * The prose is not written to `summary_vi`: it is the shop's sales copy, and the
 * catalogue is meant to read as neutral beside a Court Score that cannot be
 * bought.
 *
 * ------------------------------------------------------------------
 * A "Set" is a bundle, and its price is not the frame's
 *
 * Seven listings are titled "Set Vợt cầu lông VS …" — a frame sold with a bag
 * and a grip. The frame is what the catalogue holds, so the "Set" comes off the
 * name (`titleNoise`), but the price stays behind: 1.850.000 ₫ buys the Dragon
 * *and* the bag, and writing that into `msrp` would quietly overstate the frame
 * by whatever the bag costs. So a bundle contributes its specification and its
 * photography and no price, and is named in the report.
 *
 * That is the same state 57 rackets in this catalogue are already in, and the
 * same one four of this shop's own listings arrive in — the Youlong colours are
 * published at no price at all. The app reads `lowestPrice ?? msrp`, so any of
 * them renders at whatever a storefront turns out to charge, once one is
 * scraped selling it.
 *
 * ------------------------------------------------------------------
 * Which rackets are new is decided by the matcher, not by the id
 *
 * The rows already here are named the way Vietnamese retailers named them, so
 * the id this script would mint is no test of whether the frame is already in
 * the catalogue. The test is `bestMatch`, the same reconciliation the other
 * three importers run, with the provider's own `titleNoise`, `titleTransform`
 * and `modelAliases` carried into it — those are how the gallery crawler reads
 * this shop's names, and using anything else here would mean the two halves of
 * the import disagreeing about which pages are duplicates.
 *
 * Every catalogue VS row is offered the whole listing; a page some row claims is
 * a frame the catalogue already holds. A page no row claims is one it is
 * missing, and only those are written — minus any whose name still carries a
 * Vietnamese letter after the reduction, because a name this script could not
 * reduce to a model is not a name to put in the catalogue.
 *
 * Two pages can also reduce to one name, which venson.vn never does: the shop
 * sells the Dragon both on its own and as a set, and both are titled "Dragon"
 * once the bundle word is off. They are one racket and are written once, with
 * the frame's own page preferred over the bundle's.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

import { loadEnv } from "./env";
import { cleanText, fetchWithRetry, HTML_HEADERS, pool } from "./http";
import { slugify } from "./normalizer";
import { parseSpecs, VIETNAMESE } from "./vs-specs";
import { discoverCandidates } from "./images/discover";
import { bestMatch, type MatchCandidate } from "./images/match";
import { providerById } from "./images/providers";
import type { GripSize, ShaftFlex, WeightClass } from "../../src/lib/types";

const PROVIDER_ID = "vssports-vn";
const OUTPUT = "scripts/scraper/output/vssports-rackets.json";
const USER_AGENT =
  "ShuttlecraftImageBot/1.0 (+https://github.com/shuttlecraft; catalogue image crawler)";

/** A listing sold as a frame plus a bag and a grip. See the header. */
const BUNDLE_TITLE = /^\s*set\b/i;

export interface VssportsRacket {
  url: string;
  /** The shop's own product code, the only stable key it has. */
  externalId: string;
  slug: string;
  /** The listing name with this shop's category, brand and badges removed. */
  name: string;
  /** The name exactly as the shop prints it, for the report. */
  rawName: string;
  /** Zero where the listing quotes no price, and for a bundle. See the header. */
  price: number;
  /** Whether the listing is a frame-plus-accessories set. */
  bundle: boolean;
  weightClass: WeightClass;
  /** Null where the listing published only a grade. */
  weightGrams: number | null;
  gripSize: GripSize;
  balancePointMm: number | null;
  tensionLbs: [number, number] | null;
  shaftDiameterMm: number | null;
  holes: number | null;
  lengthMm: number | null;
  materials: string[];
  shaftFlex: ShaftFlex;
  /** Spec lines the description carried that this script does not understand. */
  unparsed: string[];
}

/* ------------------------------------------------------------- the product page */

interface ProductPage {
  price: number;
  sku: string;
  descriptionHtml: string;
}

/**
 * The three things a product page is opened for.
 *
 * The price is read from the microdata rather than from the rendered
 * "750.000 ₫", because the shop already publishes it as an integer for its own
 * schema.org block and parsing a formatted string back is a way to be wrong
 * about a thousands separator. The description is taken from the first tab only:
 * the second is the returns policy, which is the same paragraph on all 121 pages
 * and carries a `label: value` line of its own.
 */
export function parseProductPage(html: string): ProductPage {
  const $ = cheerio.load(html);

  const price = parseInt($('[itemprop="price"]').first().attr("content") ?? "0", 10);
  const sku = cleanText($(".variant-sku").first().attr("content") ?? "");
  const descriptionHtml = $("#tab-1 .product_getcontent").first().html() ?? "";

  return { price: Number.isFinite(price) ? price : 0, sku, descriptionHtml };
}

/* -------------------------------------------------------------------- rows */

function racketOf(candidate: MatchCandidate, rawName: string, page: ProductPage): VssportsRacket {
  const specs = parseSpecs(page.descriptionHtml);
  const name = candidate.title || cleanText(rawName);
  const bundle = BUNDLE_TITLE.test(rawName);

  return {
    url: candidate.url,
    externalId: page.sku,
    slug: `vs-${slugify(name)}`.slice(0, 80).replace(/-+$/, ""),
    name,
    rawName: cleanText(rawName),
    // A bundle's price buys the bag as well, so it is not this frame's. See the
    // header.
    price: bundle ? 0 : page.price,
    bundle,
    weightClass: specs.weightClass ?? "4U",
    weightGrams: specs.weightGrams,
    gripSize: specs.gripSize ?? "G5",
    balancePointMm: specs.balancePointMm,
    tensionLbs: specs.tensionLbs,
    shaftDiameterMm: specs.shaftDiameterMm,
    holes: specs.holes,
    lengthMm: specs.lengthMm,
    materials: specs.materials,
    shaftFlex: specs.shaftFlex ?? "medium",
    unparsed: specs.unparsed,
  };
}

/** How much a listing actually told us, for choosing between two that agree. */
function specCount(racket: VssportsRacket): number {
  return [
    racket.weightGrams,
    racket.balancePointMm,
    racket.tensionLbs,
    racket.shaftDiameterMm,
    racket.lengthMm,
    racket.holes,
    racket.materials.length > 0 ? racket.materials : null,
  ].filter((value) => value !== null).length;
}

/** The `rackets` row this shop's data supports, placeholders included. */
function racketRow(racket: VssportsRacket, releaseYear: number) {
  return {
    id: `r-${racket.slug}`,
    slug: racket.slug,
    brand_id: "b-vs",
    name: racket.name,
    release_year: releaseYear,
    balance_point_mm: racket.balancePointMm ?? 295,
    shaft_flex: racket.shaftFlex,
    shaft_diameter_mm: racket.shaftDiameterMm ?? 6.8,
    frame_shape: "isometric",
    frame_material: racket.materials.length > 0 ? racket.materials : ["HM Graphite"],
    max_tension_min_lbs: racket.tensionLbs?.[0] ?? 20,
    max_tension_max_lbs: racket.tensionLbs?.[1] ?? 28,
    length_mm: racket.lengthMm ?? 675,
    string_pattern: "22×21",
    msrp: racket.price,
    currency: "VND",
    play_style_tags: ["all-round"],
    skill_level: "intermediate",
  };
}

function variantRow(racket: VssportsRacket) {
  return {
    id: `v-${racket.slug}-${racket.weightClass.toLowerCase()}-${racket.gripSize.toLowerCase()}`,
    racket_id: `r-${racket.slug}`,
    weight_class: racket.weightClass,
    weight_grams: racket.weightGrams ?? 82,
    grip_size: racket.gripSize,
    colourway: null,
    // The shop's own code where it published one, and the slug where it did not,
    // so two variants can never collide on a blank.
    sku: racket.externalId ? `VS-${racket.externalId}` : `VS-${racket.slug}`,
  };
}

/* -------------------------------------------------------------------- main */

async function main() {
  loadEnv();
  const timeoutMs = 30000;
  const syncDb = process.argv.includes("--sync-db");
  const verbose = process.argv.includes("--verbose");

  const provider = providerById(PROVIDER_ID);
  if (!provider) throw new Error(`provider ${PROVIDER_ID} is not registered`);
  const source = Array.isArray(provider.catalogue) ? provider.catalogue[0] : provider.catalogue;
  if (source.kind !== "category-pagination") {
    throw new Error(`${PROVIDER_ID} no longer walks a rendered category listing`);
  }
  const delayMs = provider.politenessMs ?? 400;

  console.log("=================================================");
  console.log("🏸 VS Sports catalogue import");
  console.log("=================================================");
  console.log(`Source      : ${source.url}`);
  console.log(
    `Writes      : ${syncDb ? "rackets + racket_variants (upsert)" : "nothing — report only"}`,
  );
  console.log("=================================================\n");

  // The same walk the image crawler makes, so the two agree on what this shop
  // publishes and on what each listing is called. `refresh` because a catalogue
  // import reading a cache some earlier run wrote is how the two halves drift.
  const discovery = await discoverCandidates(provider, {
    userAgent: USER_AGENT,
    timeoutMs,
    delayMs,
    refresh: true,
    verbose,
  });
  if (discovery.error) throw new Error(`catalogue unreadable: ${discovery.error}`);
  console.log(`📄 ${discovery.candidates.length} racket pages across the listing\n`);

  // One GET per product. A page that will not load costs that page and nothing
  // else — `pool` throws out of the whole run on the first rejection, which on a
  // 121-page walk would mean losing 120 good reads to one bad one.
  const failures: string[] = [];
  const pages = await pool(
    discovery.candidates,
    3,
    delayMs,
    async (candidate): Promise<{ page: ProductPage; rawTitle: string } | null> => {
      try {
        const res = await fetchWithRetry(candidate.url, {
          headers: { ...HTML_HEADERS, "User-Agent": USER_AGENT },
          timeoutMs,
        });
        if (!res.ok) {
          failures.push(`${candidate.url}: HTTP ${res.status}`);
          return null;
        }
        const $ = cheerio.load(res.body);
        return {
          page: parseProductPage(res.body),
          // The raw name, for the report and for the bundle test — the cleaned
          // one has already had "Set" taken off it.
          rawTitle: cleanText($('meta[property="og:title"]').attr("content") ?? candidate.title ?? ""),
        };
      } catch (err) {
        failures.push(`${candidate.url}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
  );

  const rackets: VssportsRacket[] = [];
  for (const [index, read] of pages.entries()) {
    if (!read) continue;
    rackets.push(racketOf(discovery.candidates[index], read.rawTitle, read.page));
  }

  for (const [index, racket] of rackets.entries()) {
    console.log(
      `   ${String(index + 1).padStart(3)}/${rackets.length}  ` +
        `${racket.name.slice(0, 26).padEnd(26)} ` +
        `${racket.weightClass}  ` +
        `${String(racket.weightGrams ?? "?").padStart(3)}g  ` +
        `bal ${String(racket.balancePointMm ?? "?").padStart(3)}  ` +
        `${(racket.tensionLbs ? `${racket.tensionLbs[0]}-${racket.tensionLbs[1]}` : "?").padStart(5)}lbs  ` +
        `${racket.gripSize}  ` +
        `${String(racket.holes ?? "?").padStart(2)} holes  ` +
        `${racket.price > 0 ? `₫${racket.price.toLocaleString("vi-VN")}` : racket.bundle ? "bundle" : "no price"}`,
    );
  }

  if (failures.length > 0) {
    console.log(`\n⚠️  ${failures.length} product pages could not be read: ${failures.join("; ")}`);
  }

  const path = resolve(process.cwd(), OUTPUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      { readAt: new Date().toISOString(), source: provider.origin, rackets, failures },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n💾 Wrote ${rackets.length} rackets to ${OUTPUT}`);

  const noSpecs = rackets.filter(
    (r) => !r.weightGrams && !r.balancePointMm && !r.tensionLbs && r.materials.length === 0,
  );
  if (noSpecs.length > 0) {
    console.log(
      `⚠️  ${noSpecs.length} listings publish no specification this script can read and take the ` +
        `placeholders: ${noSpecs.map((r) => r.name).join(", ")}`,
    );
  }
  const bundles = rackets.filter((r) => r.bundle);
  if (bundles.length > 0) {
    console.log(
      `ℹ️  ${bundles.length} listings are a frame sold with a bag and a grip, so their price is ` +
        `not the frame's and is not written: ${bundles.map((r) => r.name).join(", ")}`,
    );
  }
  const noPrice = rackets.filter((r) => r.price <= 0 && !r.bundle);
  if (noPrice.length > 0) {
    console.log(
      `⚠️  ${noPrice.length} publish no price and would be written with msrp 0: ` +
        noPrice.map((r) => r.name).join(", "),
    );
  }
  for (const racket of rackets) {
    if (racket.unparsed.length > 0) {
      console.log(`⚠️  ${racket.name}: unrecognised ${racket.unparsed.join("; ")}`);
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(
      "\nℹ️  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set,\n" +
        "   so the catalogue could not be read and nothing can be compared against it.",
    );
    process.exitCode = syncDb ? 1 : 0;
    return;
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: existingRows, error: existingError } = await supabase
    .from("rackets")
    .select("id, name")
    .eq("brand_id", "b-vs");
  if (existingError) throw new Error(`reading rackets: ${existingError.message}`);

  const claimed = new Map<string, string>();
  const unclaimed: string[] = [];
  for (const row of existingRows ?? []) {
    let match = bestMatch(row.name, "VS", discovery.candidates);
    if (!match && provider.modelAliases) {
      for (const alias of provider.modelAliases(row.name)) {
        match = bestMatch(alias, "VS", discovery.candidates);
        if (match) break;
      }
    }
    // A row that matched two different products has identified neither, so it
    // claims neither — the same call the other importers make.
    if (!match || match.rivals.length > 0) {
      unclaimed.push(row.name);
      continue;
    }
    for (const page of [match.candidate, ...match.siblings]) {
      if (!claimed.has(page.url)) claimed.set(page.url, row.name);
    }
  }

  const unheld = rackets.filter((racket) => !claimed.has(racket.url));
  // A name that still carries a Vietnamese letter is one the reduction could not
  // finish, so it is not a model name and does not become a row.
  const reduced = unheld.filter((racket) => !VIETNAMESE.test(racket.name));
  const unreduced = unheld.filter((racket) => VIETNAMESE.test(racket.name));

  // Two pages of one frame — the bundle and the frame's own listing — mint one
  // id, so they have to become one row rather than two writes racing for it.
  // The frame's own page wins, and between two of the same kind the one that
  // published more of the specification does.
  const bySlug = new Map<string, VssportsRacket>();
  const merged: string[] = [];
  for (const racket of [...reduced].sort(
    (a, b) => Number(a.bundle) - Number(b.bundle) || specCount(b) - specCount(a),
  )) {
    const held = bySlug.get(racket.slug);
    if (held) {
      merged.push(`${racket.slug}: kept ${held.url}, dropped ${racket.url}`);
      continue;
    }
    bySlug.set(racket.slug, racket);
  }
  const fresh = [...bySlug.values()];

  console.log(
    `\n🔎 ${existingRows?.length ?? 0} VS rackets in the catalogue already; ` +
      `${rackets.length - unheld.length} of the ${rackets.length} pages are one of them.`,
  );
  if (verbose) {
    for (const racket of rackets) {
      const owner = claimed.get(racket.url);
      if (owner) console.log(`      held  ${racket.name}  →  ${owner}`);
    }
  }

  if (merged.length > 0) {
    console.log(`\n🔗 ${merged.length} pages reduce to a frame another page already is:`);
    for (const line of merged) console.log(`      ${line}`);
  }

  if (unreduced.length > 0) {
    console.log(
      `\n⏭️  ${unreduced.length} pages reduce to a name that is still partly Vietnamese, and ` +
        `are not written:`,
    );
    for (const racket of unreduced) console.log(`      ${racket.name}  (${racket.url})`);
  }

  if (fresh.length === 0) {
    console.log("\nNothing new to write.");
    return;
  }

  console.log(`\n🆕 ${fresh.length} rackets the catalogue does not hold:`);
  for (const racket of fresh) {
    console.log(
      `      ${racket.slug.padEnd(34)} ` +
        `${racket.price > 0 ? `₫${racket.price.toLocaleString("vi-VN")}` : "—"}`,
    );
  }

  // The rows this shop does not answer for. Most are discontinued frames and
  // retailer colourway rows VS no longer publishes; some are a fuller or thinner
  // spelling of a page this import is about to add — "Challenger 800" where the
  // shop says "Challenger VS800", "Thunder" where it says "Thunder 100", "Kungfu
  // Rabbit" where it says "Kongfu Rabbit". Which of those are the same frame is
  // not knowable from either side, so they are named here rather than merged.
  if (unclaimed.length > 0) {
    console.log(
      `\n↩️  ${unclaimed.length} catalogue rows match no page on the site and are left alone:`,
    );
    console.log(`      ${unclaimed.sort((a, b) => a.localeCompare(b)).join(", ")}`);
  }

  if (!syncDb) {
    console.log("\nℹ️  Nothing was written. Re-run with --sync-db to upsert the rows.");
    return;
  }

  const { error: brandError } = await supabase
    .from("brands")
    .upsert([{ id: "b-vs", slug: "vs", name: "VS" }], { onConflict: "id" });
  if (brandError) throw new Error(`brands: ${brandError.message}`);

  // No year is published anywhere on this shop, so the crawl's year is used —
  // the same rule `generate-sql.ts` applies to every scraped racket.
  const thisYear = new Date().getFullYear();

  const racketRows = fresh.map((racket) => racketRow(racket, thisYear));
  const { error: racketError } = await supabase
    .from("rackets")
    .upsert(racketRows, { onConflict: "id" });
  if (racketError) throw new Error(`rackets: ${racketError.message}`);

  const variantRows = fresh.map(variantRow);
  const { error: variantError } = await supabase
    .from("racket_variants")
    .upsert(variantRows, { onConflict: "id" });
  if (variantError) throw new Error(`racket_variants: ${variantError.message}`);

  console.log(`\n📡 Upserted ${racketRows.length} rackets and ${variantRows.length} variants.`);
  console.log(
    "\nℹ️  These rackets carry the shop's list price as msrp and no offer, because no\n" +
      "   storefront in this catalogue was scraped selling them. The app reads\n" +
      "   `lowestPrice ?? msrp`, so they render at the price VS Sports asks until a\n" +
      "   shop that stocks them turns up in a nightly run.\n" +
      "   Run `npm run scrape:images -- --provider=vssports-vn` afterwards to give the\n" +
      "   new rows their photography.",
  );
}

const invokedDirectly =
  process.argv[1]?.replace(/\\/g, "/").endsWith("vssports-catalogue.ts") ||
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
