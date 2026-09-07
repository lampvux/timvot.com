/**
 * venson.vn's racket catalogue, read as catalogue rows rather than as offers.
 *
 *   npx tsx scripts/scraper/venson-catalogue.ts            # crawl and report, write nothing
 *   npx tsx scripts/scraper/venson-catalogue.ts --sync-db  # upsert rackets and variants
 *
 * VS is a Vietnamese brand — the frames say VS, the company is Venson, and this
 * catalogue holds 114 of its rackets under the brand slug `vs`, every one of
 * them from a Vietnamese retailer listing. venson.vn is the brand's own site,
 * and it publishes 42 rackets in one WooCommerce category with the Store API
 * switched on. `images/providers.ts` reads the photographs; this reads the names
 * and the specification, and writes the frames the catalogue does not hold.
 *
 * Why this is not a `sites/` adapter, when the site does quote prices: the same
 * reason fleet.vn is not. Everything in `sites/` reads a *shop* and produces
 * offers, and an offer needs a seller row, a stock state and the nightly sweep
 * that retires what a shop stopped listing. This is a brand property with a
 * list price on it, not one of the four storefronts the price comparison is
 * built from. So the price lands where a manufacturer's price belongs —
 * `rackets.msrp`, and the *regular* price rather than today's sale price — and
 * the racket carries no offer at all until a shop that sells it is scraped.
 *
 * ------------------------------------------------------------------
 * One request for the detail of all 42
 *
 * The other two importers open every product page, because fleet.vn and
 * fz-forza.com have nothing else to offer. This shop's Store API returns the
 * whole product record — the gallery, the description the page renders, and both
 * prices — so the specification is read out of the same payload discovery
 * already walked. Forty-two product details, two requests, and the numbers are
 * the shop's own rather than something recovered from rendered HTML.
 *
 * What the description publishes per racket, where it publishes anything:
 *
 *   Trọng lượng : 4U (82 ± 2g)   → weight_class, and weight_grams from the
 *                                  gram figure where there is one
 *   Điểm cân bằng : 300 ± 3mm    → balance_point_mm, the centre of the tolerance
 *   Mức căng : 24 – 28 Lbs       → max_tension_min_lbs / max_tension_max_lbs;
 *                                  a listing that quotes only kilos is converted
 *   Độ cứng : Cứng               → shaft_flex, through `extractFlex`
 *   Chất liệu : Japan Ultra High Modulus Carbon Graphite → frame_material
 *   Chu vi cán cầm : G5          → the variant's grip_size
 *   Độ dài : 675 mm              → length_mm
 *   Số lỗ gen : 72               → read and reported; there is no column for it,
 *                                  and `string_pattern` is a pattern rather than
 *                                  a count, so inventing one from the other
 *                                  would be a guess dressed as a measurement
 *
 * Nineteen of the 42 publish no specification block at all, and those take the
 * placeholders every other scraped racket in this catalogue already carries from
 * `generate-sql.ts`. The prose is not written to `summary_vi`: it is the brand's
 * sales copy, and the catalogue is meant to read as neutral beside a Court Score
 * that cannot be bought.
 *
 * ------------------------------------------------------------------
 * Which rackets are new is decided by the matcher, not by the id
 *
 * The 114 rows already here are named the way Vietnamese retailers named them,
 * so the id this script would mint is no test of whether the frame is already in
 * the catalogue. The test is `bestMatch`, the same reconciliation
 * `fleet-catalogue.ts` and `yonex-catalogue.ts` run, with the provider's own
 * `titleNoise`, `titleTransform` and `modelAliases` carried into it — those are
 * how the gallery crawler reads this shop's names, and using anything else here
 * would mean the two halves of the import disagreeing about which pages are
 * duplicates.
 *
 * Every catalogue VS row is offered the whole listing; a page some row claims is
 * a frame the catalogue already holds. A page no row claims is one it is
 * missing, and only those are written — minus any whose name still carries a
 * Vietnamese letter after the reduction, because a name this script could not
 * reduce to a model is not a name to put in the catalogue. Those are named in
 * the report instead.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { loadEnv } from "./env";
import { cleanText, fetchWithRetry, JSON_HEADERS, sleep } from "./http";
import { extractFlex, slugify } from "./normalizer";
import { discoverCandidates } from "./images/discover";
import { bestMatch, type MatchCandidate } from "./images/match";
import { providerById, type CatalogueSource } from "./images/providers";
import type { GripSize, ShaftFlex, WeightClass } from "../../src/lib/types";

const PROVIDER_ID = "venson-vn";
const OUTPUT = "scripts/scraper/output/venson-rackets.json";
const USER_AGENT =
  "ShuttlecraftImageBot/1.0 (+https://github.com/shuttlecraft; catalogue image crawler)";

/** A Vietnamese letter. Prose, wherever it survives into a reduced name. */
const VIETNAMESE = /[^\u0000-\u007F]/;

export interface VensonRacket {
  url: string;
  /** The shop's numeric product id, the only stable key it has. */
  externalId: string;
  slug: string;
  /** The listing name with this shop's sales copy and the brand removed. */
  name: string;
  /** The name exactly as the shop prints it, for the report. */
  rawName: string;
  /** The list price, not today's sale price. See the header. */
  price: number;
  weightClass: WeightClass;
  /** Null where the listing published only a grade. */
  weightGrams: number | null;
  gripSize: GripSize;
  balancePointMm: number | null;
  tensionLbs: [number, number] | null;
  holes: number | null;
  lengthMm: number | null;
  materials: string[];
  shaftFlex: ShaftFlex;
  /** Spec lines the description carried that this script does not understand. */
  unparsed: string[];
}

/* ------------------------------------------------------------ the spec block */

/**
 * The description, as lines.
 *
 * WooCommerce stores it as HTML with the entities already encoded, so the tags
 * become line breaks and `cleanText` decodes what is left. The spec block is a
 * run of `label: value` lines, each usually opened with an en dash the shop uses
 * as a bullet.
 */
function descriptionLines(html: string): string[] {
  return html
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map((line) => cleanText(line).replace(/^[-–—•]\s*/, ""))
    .filter(Boolean);
}

/** `4U (82 ± 2g)`, `82±2 (4U)`, `82 ± 2g`, `4U (80 – 85g)`, `4U`. */
function parseWeight(value: string): { weightClass: WeightClass | null; grams: number | null } {
  const grade = /(?:^|[^A-Z0-9])([2-7])U(?:[^A-Z0-9]|$)/i.exec(value);
  // 6U is a real Venson grade and the schema's enum stops at 5U, so a lighter
  // frame lands in the lightest band there is. Naming it in the report is the
  // closest the schema can come; inventing a band would not be.
  const weightClass = grade
    ? ((grade[1] === "6" || grade[1] === "7" ? "5U" : `${grade[1]}U`) as WeightClass)
    : null;

  // The gram figure, which is a tolerance ("82 ± 2g") or a range ("80 – 85g").
  // A grade in parentheses looks like neither, so the digits are only accepted
  // where they land in the range a racket can actually weigh.
  let grams: number | null = null;
  const range = /(\d{2,3})\s*(?:g\b|[±+]\s*-?\s*\d+\s*g?|[-–~]\s*(\d{2,3})\s*g?)/i.exec(value);
  if (range) {
    const low = parseInt(range[1], 10);
    const high = range[2] ? parseInt(range[2], 10) : low;
    const mid = Math.round((low + high) / 2);
    if (mid >= 60 && mid <= 120) grams = mid;
  }

  return { weightClass, grams };
}

/** The weight bands the rest of the pipeline uses (see `generate-sql.ts`). */
function weightClassOf(grams: number): WeightClass {
  if (grams >= 90) return "2U";
  if (grams >= 85) return "3U";
  if (grams >= 80) return "4U";
  return "5U";
}

/** `300 ± 3mm`, `295+-3mm`, `Khoảng 292mm`, `305 - 310 mm`. */
function parseBalanceMm(value: string): number | null {
  const range = /(\d{3})\s*(?:[-–]\s*(\d{3}))?/.exec(value);
  if (!range) return null;
  const low = parseInt(range[1], 10);
  const high = range[2] ? parseInt(range[2], 10) : low;
  const mid = Math.round((low + high) / 2);
  return mid >= 250 && mid <= 340 ? mid : null;
}

/**
 * `24 – 28 Lbs`, `22-30LBS`, `28LBS ~ 12.5kg`, `13.5 kg`.
 *
 * Pounds win wherever the line quotes both, because that is the unit the columns
 * are in and converting a rounded kilo figure back loses a pound either way. A
 * line that quotes only kilos is converted, and a single figure is read as the
 * maximum with the six-pound window `normalizer.extractMaxTension` uses.
 */
function parseTension(value: string): [number, number] | null {
  const lbs = /(\d{2})\s*(?:[-–~]\s*(\d{2})\s*)?lbs?/i.exec(value);
  if (lbs) {
    const low = parseInt(lbs[1], 10);
    const high = lbs[2] ? parseInt(lbs[2], 10) : low;
    if (low >= 12 && high <= 40 && high >= low) {
      return lbs[2] ? [low, high] : [Math.max(12, high - 6), high];
    }
  }

  const kg = /(\d{1,2}(?:[.,]\d)?)\s*kg/i.exec(value);
  if (kg) {
    const max = Math.round(parseFloat(kg[1].replace(",", ".")) * 2.20462);
    if (max >= 18 && max <= 40) return [Math.max(12, max - 6), max];
  }

  return null;
}

/**
 * The materials out of a "Chất liệu" line, and nothing else.
 *
 * The line is either a lay-up in Latin script — "Japan Ultra High Modulus Carbon
 * Graphite", "30T MITSUBISHI CARBON SHEET+HEXAGON BLADE FRAME" — or a Vietnamese
 * sentence describing one, "Sợi carbon chịu nhiệt cao". A segment carrying a
 * Vietnamese letter is prose and is dropped, which is the same test
 * `fleet-catalogue.ts` makes on the same kind of line; what is left is what the
 * frame is made of. A long segment is a sentence written without diacritics.
 */
function parseMaterials(value: string): string[] {
  const out = new Set<string>();
  for (const raw of value.split(/[,;+/]|\.(?:\s|$)/)) {
    const segment = cleanText(raw).replace(/^\(|\)$/g, "").trim();
    if (!segment || segment.length > 48) continue;
    if (!/[A-Za-z]/.test(segment)) continue;
    if (VIETNAMESE.test(segment)) continue;
    out.add(segment);
  }
  return [...out];
}

interface ParsedSpecs {
  weightClass: WeightClass | null;
  weightGrams: number | null;
  gripSize: GripSize | null;
  balancePointMm: number | null;
  tensionLbs: [number, number] | null;
  holes: number | null;
  lengthMm: number | null;
  materials: string[];
  shaftFlex: ShaftFlex | null;
  unparsed: string[];
}

/**
 * Labels this shop publishes that are read and deliberately not used.
 *
 * They are listed rather than ignored so that `unparsed` stays a signal about
 * the shop changing its template, instead of a list of the same twenty lines
 * every run.
 *
 * The brand is this provider by definition. The colour and the product name are
 * things the catalogue keeps elsewhere — on the variant, and in the row's own
 * name. And the rest are the shop's own editorial about how a frame plays
 * ("Loại vợt: Thiên công", "Đối tượng: Người chơi tấn công", every named
 * technology) which would have to be read through a vocabulary of marketing
 * phrases to become `play_style_tags` or `skill_level` — a guess wearing a
 * regex, and the same call `fleet-catalogue.ts` makes about the same copy.
 */
const IGNORED_LABELS =
  /thương hiệu|màu (?:sắc|gỗ)|tên sản phẩm|^sản phẩm|mẫu mã|^loại|phong cách|đối tượng|công nghệ|ưu điểm|đặc điểm|điểm (?:nổi bật|swing)|độ (?:ổn định|bền)|chuyển giao|hiệu suất|chi phí|đổi 1|bảo hành|khuyến mãi/;

/**
 * Read the specification out of one product description.
 *
 * Every label on this shop is written three or four ways, because half the
 * descriptions carry a second spec table machine-translated from the
 * manufacturer's Chinese: weight is "Trọng lượng", "Trọng lượng vợt (không
 * dây)", "Khối lượng" or "Cân nặng"; tension is "Mức căng", "Mức căng dây",
 * "Mức căng lưới tối đa", "Sức căng tối đa", "Lực căng tối đa", "Độ căng" or
 * "Xâu chuỗi"; balance is "Điểm cân bằng", "Độ cân bằng" or "Cân bằng"; the grip
 * is "Chu vi cán cầm", "Chu vi cán vợt", "Kích thước cán" or "Tay cầm". So each
 * fact is matched on the phrase that identifies it rather than on a whole label,
 * and every spelling below was read off a real listing.
 *
 * Balance is tested before tension on purpose: "độ cân bằng" and "độ căng" are
 * one diacritic apart.
 *
 * The first reading of a fact wins, and each is bounded by what it can possibly
 * be — which is what makes the shop's own mislabelling harmless. Windsoul
 * Fengling publishes "Cân nặng: 22-30 lbs", its string tension under the weight
 * label; 22 is not a mass a racket can have, so `parseWeight` returns nothing
 * and the row keeps no weight rather than a wrong one.
 *
 * A `label: value` line that is none of these and none of `IGNORED_LABELS` is
 * kept in `unparsed` and reported, which is how the next spelling gets noticed.
 * Only a short value is: a colon on this shop introduces a paragraph about as
 * often as it introduces a measurement.
 */
function parseSpecs(descriptionHtml: string): ParsedSpecs {
  const specs: ParsedSpecs = {
    weightClass: null,
    weightGrams: null,
    gripSize: null,
    balancePointMm: null,
    tensionLbs: null,
    holes: null,
    lengthMm: null,
    materials: [],
    shaftFlex: null,
    unparsed: [],
  };

  for (const line of descriptionLines(descriptionHtml)) {
    // "Hệ thống 76 lỗ gen" is the one fact stated as a sentence rather than as a
    // label, and "Số lỗ gen: 72" is the same fact with a label.
    const holes = /(?:hệ thống|số lỗ)\D{0,12}?(\d{2,3})\s*lỗ|số\s+lỗ[^:]*:\s*(\d{2,3})/i.exec(line);
    if (holes) {
      specs.holes ??= parseInt(holes[1] ?? holes[2], 10);
      continue;
    }

    const row = /^([^:]{1,48}?)\s*:\s*(.*)$/.exec(line);
    if (!row) continue;
    const label = row[1].toLowerCase();
    const value = cleanText(row[2]);
    if (!value) continue;

    if (/trọng lượng|khối lượng|cân nặng/.test(label)) {
      const weight = parseWeight(value);
      specs.weightClass ??= weight.weightClass;
      specs.weightGrams ??= weight.grams;
    } else if (/cân bằng/.test(label)) {
      specs.balancePointMm ??= parseBalanceMm(value);
    } else if (/(?:mức|sức|lực|độ)\s+căng|căng\s+tối\s+đa|xâu\s+chuỗi/.test(label)) {
      specs.tensionLbs ??= parseTension(value);
    } else if (/độ cứng/.test(label)) {
      specs.shaftFlex ??= extractFlex(value);
    } else if (/chất liệu|vật liệu/.test(label)) {
      if (specs.materials.length === 0) specs.materials = parseMaterials(value);
    } else if (/khung vợt|thân vợt/.test(label)) {
      // The frame and the shaft, each named with its own lay-up: "Khung vợt:
      // 6.8mm Slim Tube + Narrow Fluid Frame". That is the same kind of fact as
      // "Chất liệu", so it lands in the same column — and where the value is a
      // Vietnamese description of the shape rather than a material ("Khung vợt
      // dạng hộp") `parseMaterials` drops it.
      for (const material of parseMaterials(value)) {
        if (!specs.materials.includes(material)) specs.materials.push(material);
      }
    } else if (/chu vi cán|cỡ cán|kích thước cán|tay cầm/.test(label)) {
      const grip = /G([456])/i.exec(value);
      if (grip) specs.gripSize ??= `G${grip[1]}` as GripSize;
    } else if (/độ dài|chiều dài/.test(label)) {
      const mm = /(\d{3})\s*mm/i.exec(value);
      if (mm) specs.lengthMm ??= parseInt(mm[1], 10);
    } else if (IGNORED_LABELS.test(label)) {
      // Read and dropped deliberately. See IGNORED_LABELS.
    } else if (label.length <= 28 && value.length <= 48) {
      specs.unparsed.push(`${row[1]}: ${value}`);
    }
  }

  // A grade is the shop's own answer and always wins; a listing that published
  // only grams gets the band those grams fall in, which is the same reading
  // `generate-sql.ts` makes of every scraped racket.
  if (!specs.weightClass && specs.weightGrams !== null) {
    specs.weightClass = weightClassOf(specs.weightGrams);
  }

  return specs;
}

/* ---------------------------------------------------------------- the shop */

interface StoreProduct {
  id: number;
  name: string;
  permalink: string;
  description?: string;
  prices?: { price?: string; regular_price?: string };
}

/**
 * The shop's product records, keyed by permalink.
 *
 * The same endpoint `discoverCandidates` walks for this provider, resolved the
 * same way — category by slug, because the numeric id is per-install. Discovery
 * keeps the gallery and the cleaned title and drops the rest; this is here for
 * the rest.
 */
async function readStoreProducts(
  origin: string,
  source: Extract<CatalogueSource, { kind: "woocommerce-store" }>,
  timeoutMs: number,
): Promise<Map<string, StoreProduct>> {
  const headers = { ...JSON_HEADERS, "User-Agent": USER_AGENT };

  const catRes = await fetchWithRetry(
    `${origin}/wp-json/wc/store/v1/products/categories?per_page=100`,
    { headers, timeoutMs },
  );
  if (!catRes.ok) throw new Error(`categories: HTTP ${catRes.status}`);
  const categories = JSON.parse(catRes.body) as { id: number; slug: string }[];

  const byUrl = new Map<string, StoreProduct>();
  for (const slug of source.categorySlugs) {
    const category = categories.find((c) => c.slug === slug);
    if (!category) throw new Error(`${slug} is not a category on this shop`);

    const res = await fetchWithRetry(
      `${origin}/wp-json/wc/store/v1/products?per_page=${source.pageSize}&category=${category.id}`,
      { headers, timeoutMs },
    );
    if (!res.ok) throw new Error(`products: HTTP ${res.status}`);
    for (const product of JSON.parse(res.body) as StoreProduct[]) {
      if (!byUrl.has(product.permalink)) byUrl.set(product.permalink, product);
    }
  }

  return byUrl;
}

/* -------------------------------------------------------------------- rows */

function racketOf(candidate: MatchCandidate, product: StoreProduct): VensonRacket {
  const specs = parseSpecs(product.description ?? "");
  const name = candidate.title || cleanText(product.name);

  // The list price. `prices.price` is what the shop charges today and half of
  // these are on sale; `regular_price` is the price the brand asks, which is
  // what `rackets.msrp` means.
  const price = parseInt(product.prices?.regular_price || product.prices?.price || "0", 10);

  return {
    url: candidate.url,
    externalId: String(product.id),
    slug: `vs-${slugify(name)}`.slice(0, 80).replace(/-+$/, ""),
    name,
    rawName: cleanText(product.name),
    price: Number.isFinite(price) ? price : 0,
    weightClass: specs.weightClass ?? "4U",
    weightGrams: specs.weightGrams,
    gripSize: specs.gripSize ?? "G5",
    balancePointMm: specs.balancePointMm,
    tensionLbs: specs.tensionLbs,
    holes: specs.holes,
    lengthMm: specs.lengthMm,
    materials: specs.materials,
    shaftFlex: specs.shaftFlex ?? "medium",
    unparsed: specs.unparsed,
  };
}

/** The `rackets` row this shop's data supports, placeholders included. */
function racketRow(racket: VensonRacket, releaseYear: number) {
  return {
    id: `r-${racket.slug}`,
    slug: racket.slug,
    brand_id: "b-vs",
    name: racket.name,
    release_year: releaseYear,
    balance_point_mm: racket.balancePointMm ?? 295,
    shaft_flex: racket.shaftFlex,
    shaft_diameter_mm: 6.8,
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

function variantRow(racket: VensonRacket) {
  return {
    id: `v-${racket.slug}-${racket.weightClass.toLowerCase()}-${racket.gripSize.toLowerCase()}`,
    racket_id: `r-${racket.slug}`,
    weight_class: racket.weightClass,
    weight_grams: racket.weightGrams ?? 82,
    grip_size: racket.gripSize,
    colourway: null,
    sku: `VS-${racket.externalId}-${racket.weightClass}`,
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
  if (source.kind !== "woocommerce-store") {
    throw new Error(`${PROVIDER_ID} no longer reads a WooCommerce Store API`);
  }

  console.log("=================================================");
  console.log("🏸 Venson (VS) catalogue import");
  console.log("=================================================");
  console.log(`Source      : ${provider.origin}/danh-muc-san-pham/${source.categorySlugs[0]}/`);
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
    delayMs: provider.politenessMs ?? 400,
    refresh: true,
    verbose,
  });
  if (discovery.error) throw new Error(`catalogue unreadable: ${discovery.error}`);
  console.log(
    `📄 ${discovery.candidates.length} racket pages, out of ${discovery.urlsSeen} listings — ` +
      `the rest are a page for several frames, or for no frame at all (see excludeTitle)\n`,
  );

  await sleep(provider.politenessMs ?? 400);
  const products = await readStoreProducts(provider.origin, source, timeoutMs);

  const rackets: VensonRacket[] = [];
  const missing: string[] = [];
  for (const candidate of discovery.candidates) {
    const product = products.get(candidate.url);
    if (!product) {
      missing.push(candidate.url);
      continue;
    }
    rackets.push(racketOf(candidate, product));
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
        `${racket.price > 0 ? `₫${racket.price.toLocaleString("vi-VN")}` : "no price"}`,
    );
  }

  if (missing.length > 0) {
    console.log(
      `\n⚠️  ${missing.length} discovered pages are not in the Store API payload and were ` +
        `skipped: ${missing.join(", ")}`,
    );
  }

  const path = resolve(process.cwd(), OUTPUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      { readAt: new Date().toISOString(), source: provider.origin, rackets, missing },
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
      `⚠️  ${noSpecs.length} listings publish no specification at all and take the ` +
        `placeholders: ${noSpecs.map((r) => r.name).join(", ")}`,
    );
  }
  const noPrice = rackets.filter((r) => r.price <= 0);
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
    // claims neither — the same call the other two importers make.
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
  // finish, so it is not a model name and does not become a row. One listing is
  // like this today — "Venson Rồng văn trắng, VS ACE Power 11 Max Dragon …"
  // opens with its colourway in Vietnamese, which `vensonTitle` keeps
  // deliberately (see the note there on the reel of string it keeps out of the
  // catalogue by keeping a leading Vietnamese run).
  const fresh = unheld.filter((racket) => !VIETNAMESE.test(racket.name));
  const unreduced = unheld.filter((racket) => VIETNAMESE.test(racket.name));

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
  // spelling of a page this import is about to add — "Pofang" where the shop says
  // "Po Fang", "Razor X" where it says "Razor", "FengLing" where it says
  // "Windsoul Fengling". Which of those are the same frame is not knowable from
  // either side, so they are named here rather than merged.
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
    "\nℹ️  These rackets carry the brand's list price as msrp and no offer, because no\n" +
      "   shop in this catalogue was scraped selling them. The app reads\n" +
      "   `lowestPrice ?? msrp`, so they render at the price Venson asks until a\n" +
      "   storefront that stocks them turns up in a nightly run.\n" +
      "   Run `npm run scrape:images -- --provider=venson-vn` afterwards to give the\n" +
      "   new rows their photography.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
