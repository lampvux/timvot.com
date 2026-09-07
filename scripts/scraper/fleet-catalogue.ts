/**
 * fleet.vn's racket catalogue, read as catalogue rows rather than as offers.
 *
 *   npx tsx scripts/scraper/fleet-catalogue.ts            # crawl and report, write nothing
 *   npx tsx scripts/scraper/fleet-catalogue.ts --sync-db  # upsert rackets and variants
 *
 * Fleet Việt Nam is the brand's own Vietnamese property, and the only Fleet
 * site that answers at all — fleet.com.my, the Malaysian manufacturer, returns
 * 503 to everything. It publishes 120 rackets over eight listing pages at
 * `/san-pham/vot-cau-long/89/page=N`, each with a specification table, a
 * distributor price and photography. `images/providers.ts` reads the
 * photographs; this reads the specification and the names.
 *
 * Why this is not a `sites/` adapter, when the site does quote prices:
 * everything in `sites/` reads a *shop* and produces offers, and an offer needs
 * a seller row, a stock state and a nightly sweep that retires what the shop
 * stopped listing. fleet.vn is a brand property with a distributor's list price
 * on it, not one of the four storefronts the price comparison is built from,
 * and turning it into a fifth seller would put a manufacturer's RRP beside four
 * shops' real prices as though it were one of them. So the price lands where a
 * manufacturer's price belongs — `rackets.msrp` — and the racket carries no
 * offer at all until a shop that actually sells it is scraped.
 *
 * What the site publishes per racket, and what becomes of it:
 *
 *   Trọng lượng : 84 - 89 g   → weight_grams (the midpoint) and its weight_class
 *   Điểm cân bằng : 288 ± 2 mm → balance_point_mm, as measured
 *   Sức căng : 20 - 28 lbs     → max_tension_min_lbs and max_tension_max_lbs
 *   Tính năng : <technologies> → frame_material, and shaft_flex from the
 *                                Vietnamese sentence that follows it
 *   Giá : 1,460,000 VNĐ        → msrp
 *   Số lỗ : 72                 → read and reported; there is no column for it,
 *                                and string_pattern is a pattern rather than a
 *                                count, so inventing one from the other would
 *                                be a guess dressed as a measurement
 *
 * Everything the site does not publish gets the placeholder every other scraped
 * racket in this catalogue already carries, from `generate-sql.ts`:
 * shaft_diameter_mm 6.8, frame_shape isometric, string_pattern 22×21,
 * play_style_tags all-round, skill_level intermediate, grip_size G5, length_mm
 * 675, release_year the year of the crawl. The product copy says more than that
 * — "dành cho người chơi khá & giỏi" is a skill level in plain Vietnamese — but
 * reading it would mean a vocabulary of marketing phrases, which is a guess
 * wearing a regex. `shaft_flex` is the one exception, and only because it goes
 * through `extractFlex`, the same reader the retailer scrape already runs over
 * these same Vietnamese sentences.
 *
 * The prose is not written to `summary_vi` either. It is the distributor's sales
 * copy — "Vợt khá dẻo, khung vợt khỏe … dành cho người chơi khá & giỏi" — and
 * the catalogue is meant to read as neutral beside a Court Score that cannot be
 * bought. A seller's paragraph is not that, whichever seller it is.
 *
 * ------------------------------------------------------------------
 * Which rackets are new is decided by the matcher, not by the id
 *
 * The catalogue already holds 153 Fleet rackets, all of them from Vietnamese
 * retailer listings, and their names are what those listings said. So the id
 * this script would mint is not a reliable test of whether the frame is already
 * here: `r-fleet-woven-ice` and the catalogue's `r-fleet-woven-ice` are the same
 * racket, but so are "Speed FT2000" and the row a retailer scrape recorded as
 * "Speed FT" under `r-fleet-speed-ft`.
 *
 * So the test is `bestMatch`, the same reconciliation `yonex-catalogue.ts` runs
 * for the same reason, with one addition: the provider's own `titleNoise` and
 * `modelAliases` come with it. Those are how the gallery crawler reads this
 * shop's names, and using anything else here would mean the two halves of the
 * Fleet import disagreeing about which pages are duplicates.
 *
 * Every catalogue racket is offered the whole listing, and a listing some row
 * claims is a listing this catalogue already holds. A page no row claims is a
 * racket the catalogue is missing, and only those are written.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

import { loadEnv } from "./env";
import { cleanText, fetchWithRetry, HTML_HEADERS, parseVndPrice, sleep } from "./http";
import { extractFlex, slugify } from "./normalizer";
import { discoverCandidates } from "./images/discover";
import { bestMatch, type MatchCandidate } from "./images/match";
import { providerById } from "./images/providers";

const PROVIDER_ID = "fleet-vn";
const OUTPUT = "scripts/scraper/output/fleet-rackets.json";
const USER_AGENT =
  "ShuttlecraftImageBot/1.0 (+https://github.com/shuttlecraft; catalogue image crawler)";

/** The weight bands the rest of the pipeline uses (see `generate-sql.ts`). */
function weightClassOf(grams: number): "2U" | "3U" | "4U" | "5U" {
  if (grams >= 90) return "2U";
  if (grams >= 85) return "3U";
  if (grams >= 80) return "4U";
  return "5U";
}

/**
 * A Vietnamese letter outside ASCII. What separates the technology names in a
 * "Tính năng" line from the sentence of sales copy that follows them: "Ultra
 * Power Frame, High Modulus Graphite. Vợt khá dẻo, khung vợt khỏe." The first
 * half is the lay-up, the second is prose, and the diacritics are where one
 * stops and the other starts.
 */
const VIETNAMESE = /[^\u0000-\u007F]/;

export interface FleetRacket {
  url: string;
  /** The page's numeric id, which is the only stable key this site has. */
  externalId: string;
  slug: string;
  /** The listing name with the shop's Vietnamese copy and the brand removed. */
  name: string;
  /** The name exactly as the page prints it, for the report. */
  rawName: string;
  price: number;
  weightGrams: number | null;
  balancePointMm: number | null;
  tensionLbs: [number, number] | null;
  holes: number | null;
  materials: string[];
  shaftFlex: string;
  /** Spec lines the page carried that this script does not understand. */
  unparsed: string[];
}

/** `84 - 89 g`, `120 g`, `84-89g`. A range is read as its midpoint. */
function parseGrams(value: string): number | null {
  const range = /(\d{2,3})\s*(?:[-–~]\s*(\d{2,3}))?/.exec(value);
  if (!range) return null;
  const low = parseInt(range[1], 10);
  const high = range[2] ? parseInt(range[2], 10) : low;
  if (!Number.isFinite(low) || low < 50 || low > 200) return null;
  return Math.round((low + high) / 2);
}

/** `288 ± 2 mm`, `285 - 295 mm`, `295 -300 mm`. A tolerance keeps its centre. */
function parseBalanceMm(value: string): number | null {
  const range = /(\d{3})\s*(?:[-–]\s*(\d{3}))?/.exec(value);
  if (!range) return null;
  const low = parseInt(range[1], 10);
  const high = range[2] ? parseInt(range[2], 10) : low;
  const mid = Math.round((low + high) / 2);
  return mid >= 250 && mid <= 340 ? mid : null;
}

/** `20 - 28 lbs`, `20-26`, `30 lbs`. */
function parseTension(value: string): [number, number] | null {
  const range = /(\d{2})\s*(?:[-–]\s*(\d{2}))?/.exec(value);
  if (!range) return null;
  const low = parseInt(range[1], 10);
  const high = range[2] ? parseInt(range[2], 10) : low;
  if (low < 12 || high > 40 || high < low) return null;
  return [low, high];
}

/**
 * The technology names out of a "Tính năng" line, and nothing else.
 *
 * The line is a comma- or plus-separated lay-up followed by a sentence or two
 * of Vietnamese. A segment carrying a Vietnamese letter is prose and is
 * dropped; what is left — "Ultra Power Frame", "High Modulus Graphite", "Nano
 * Epotech Resin Composite" — is what the frame is made of and how it is built.
 * A long segment is dropped as well: past about forty characters it is a
 * sentence written without diacritics, not a material.
 */
function parseMaterials(value: string): string[] {
  const out = new Set<string>();
  for (const raw of value.split(/[,.;+/]/)) {
    const segment = cleanText(raw);
    if (!segment || segment.length > 40) continue;
    if (!/[A-Za-z]/.test(segment)) continue;
    if (VIETNAMESE.test(segment)) continue;
    out.add(segment);
  }
  return [...out];
}

/**
 * Read one product page.
 *
 * The specification is a `<br>`-separated block in the page's first tab, so the
 * separators become newlines before the text is taken — otherwise every line
 * runs into the next and the labels stop anchoring anything.
 */
async function readRacket(
  candidate: MatchCandidate,
  timeoutMs: number,
): Promise<FleetRacket> {
  const res = await fetchWithRetry(candidate.url, {
    headers: { ...HTML_HEADERS, "User-Agent": USER_AGENT },
    timeoutMs,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const $ = cheerio.load(res.body);
  const detail = $("#product-detail");
  if (detail.length === 0) throw new Error("no #product-detail block");

  const rawName = cleanText(detail.find(".pro-name span").eq(1).text());
  const price = parseVndPrice(detail.find(".pro-price span").eq(1).text());

  const content = detail.find(".product-content").first();
  content.find("br").replaceWith("\n");
  const specText = content.text().replace(/\u00A0/g, " ");

  let weightGrams: number | null = null;
  let balancePointMm: number | null = null;
  let tensionLbs: [number, number] | null = null;
  let holes: number | null = null;
  let materials: string[] = [];
  let flexSource = "";
  const unparsed: string[] = [];

  for (const line of specText.split("\n")) {
    const row = /^\s*-?\s*([^:]{1,40}?)\s*:\s*(.*)$/.exec(cleanText(line));
    if (!row) continue;
    const label = row[1].toLowerCase();
    const value = cleanText(row[2]);
    if (!value) continue;

    if (label.startsWith("trọng lượng")) weightGrams = parseGrams(value);
    else if (label.startsWith("điểm cân bằng")) balancePointMm = parseBalanceMm(value);
    else if (label.startsWith("sức căng")) tensionLbs = parseTension(value);
    else if (label.startsWith("số lỗ")) holes = parseInt(value, 10) || null;
    else if (label.startsWith("tính năng")) {
      materials = parseMaterials(value);
      flexSource = value;
    } else unparsed.push(`${row[1]}: ${value}`);
  }

  // The name the matcher saw, which is the listing title with this shop's
  // Vietnamese copy and the brand already taken off it by `titleNoise`.
  const name = candidate.title || rawName;

  return {
    url: candidate.url,
    externalId: new URL(candidate.url).pathname.split("/").filter(Boolean).at(-1) ?? "",
    slug: `fleet-${slugify(name)}`,
    name,
    rawName,
    price,
    weightGrams,
    balancePointMm,
    tensionLbs,
    holes,
    materials,
    // The sales copy is the only place this site says how stiff a frame is, and
    // `extractFlex` is the reader the retailer scrape already runs over the same
    // sentences: "dẻo" is flexible, "cứng" stiff, "siêu cứng" extra-stiff.
    shaftFlex: extractFlex(flexSource),
    unparsed,
  };
}

/** The `rackets` row this site's data supports, placeholders included. */
function racketRow(racket: FleetRacket, releaseYear: number) {
  return {
    id: `r-${racket.slug}`,
    slug: racket.slug,
    brand_id: "b-fleet",
    name: racket.name,
    release_year: releaseYear,
    balance_point_mm: racket.balancePointMm ?? 295,
    shaft_flex: racket.shaftFlex,
    shaft_diameter_mm: 6.8,
    frame_shape: "isometric",
    frame_material: racket.materials.length > 0 ? racket.materials : ["HM Graphite"],
    max_tension_min_lbs: racket.tensionLbs?.[0] ?? 20,
    max_tension_max_lbs: racket.tensionLbs?.[1] ?? 28,
    length_mm: 675,
    string_pattern: "22×21",
    msrp: racket.price,
    currency: "VND",
    play_style_tags: ["all-round"],
    skill_level: "intermediate",
  };
}

function variantRow(racket: FleetRacket) {
  const grams = racket.weightGrams ?? 85;
  const weightClass = weightClassOf(grams);
  return {
    id: `v-${racket.slug}-${weightClass.toLowerCase()}-g5`,
    racket_id: `r-${racket.slug}`,
    weight_class: weightClass,
    weight_grams: grams,
    grip_size: "G5",
    colourway: null,
    sku: `FLEET-${racket.externalId}-${weightClass}`,
  };
}

async function main() {
  loadEnv();
  const timeoutMs = 30000;
  const syncDb = process.argv.includes("--sync-db");
  const verbose = process.argv.includes("--verbose");

  const provider = providerById(PROVIDER_ID);
  if (!provider) throw new Error(`provider ${PROVIDER_ID} is not registered`);

  console.log("=================================================");
  console.log("🏸 Fleet Vietnam catalogue import");
  console.log("=================================================");
  console.log(`Source      : ${provider.origin}/san-pham/vot-cau-long/89`);
  console.log(`Writes      : ${syncDb ? "rackets + racket_variants (upsert)" : "nothing — report only"}`);
  console.log("=================================================\n");

  // The same walk the image crawler makes, so the two agree on what this site
  // publishes and on what each listing is called. `refresh` because a catalogue
  // import reading a cache written by some earlier run is exactly the way the
  // two halves would drift apart.
  const discovery = await discoverCandidates(provider, {
    userAgent: USER_AGENT,
    timeoutMs,
    delayMs: provider.politenessMs ?? 800,
    refresh: true,
    verbose,
  });
  console.log(`📄 ${discovery.candidates.length} racket pages linked from the listing\n`);

  const rackets: FleetRacket[] = [];
  const failed: { url: string; error: string }[] = [];

  for (const [index, candidate] of discovery.candidates.entries()) {
    if (index > 0) await sleep(provider.politenessMs ?? 800);
    try {
      const racket = await readRacket(candidate, timeoutMs);
      rackets.push(racket);
      console.log(
        `   ${String(index + 1).padStart(3)}/${discovery.candidates.length}  ` +
          `${racket.name.slice(0, 30).padEnd(30)} ` +
          `${String(racket.weightGrams ?? "?").padStart(3)}g  ` +
          `bal ${String(racket.balancePointMm ?? "?").padStart(3)}  ` +
          `${(racket.tensionLbs ? `${racket.tensionLbs[0]}-${racket.tensionLbs[1]}` : "?").padStart(5)}lbs  ` +
          `${String(racket.holes ?? "?").padStart(2)} holes  ` +
          `${racket.price > 0 ? `₫${racket.price.toLocaleString("vi-VN")}` : "no price"}`,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ url: candidate.url, error });
      console.log(`   ${candidate.url}: ${error}`);
    }
  }

  const path = resolve(process.cwd(), OUTPUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      { readAt: new Date().toISOString(), source: provider.origin, rackets, failed },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n💾 Wrote ${rackets.length} rackets to ${OUTPUT}`);

  const noSpecs = rackets.filter((r) => !r.weightGrams && !r.balancePointMm && !r.tensionLbs);
  const noPrice = rackets.filter((r) => r.price <= 0);
  if (noSpecs.length > 0) {
    console.log(
      `⚠️  ${noSpecs.length} pages publish no specification at all: ` +
        noSpecs.map((r) => r.name).join(", "),
    );
  }
  if (noPrice.length > 0) {
    console.log(
      `⚠️  ${noPrice.length} pages publish no price ("Liên hệ", or a 0) and get msrp 0: ` +
        noPrice.map((r) => r.name).join(", "),
    );
  }
  // `weight_class` has four bands and they cover 80–94 g, which is every frame
  // meant to be played with. The training rackets are not — Skill Training 01
  // is 120 g of deliberate deadweight — so they land in 2U, the heaviest band
  // there is, and that is the closest the schema can come rather than a reading.
  const offScale = rackets.filter((r) => r.weightGrams !== null && (r.weightGrams < 78 || r.weightGrams > 94));
  if (offScale.length > 0) {
    console.log(
      `⚠️  ${offScale.length} rackets weigh outside the 2U–5U bands and are filed in the nearest one: ` +
        offScale.map((r) => `${r.name} (${r.weightGrams}g)`).join(", "),
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

  // Which of these the catalogue already holds — the matcher's answer, not the
  // id's. See the header: every Fleet row is offered the whole listing, and a
  // page some row claims is a page for a racket that is already here.
  const { data: existingRows, error: existingError } = await supabase
    .from("rackets")
    .select("id, name")
    .eq("brand_id", "b-fleet");
  if (existingError) throw new Error(`reading rackets: ${existingError.message}`);

  const claimed = new Map<string, string>();
  const unclaimed: string[] = [];
  for (const row of existingRows ?? []) {
    let match = bestMatch(row.name, "Fleet", discovery.candidates);
    if (!match && provider.modelAliases) {
      for (const alias of provider.modelAliases(row.name)) {
        match = bestMatch(alias, "Fleet", discovery.candidates);
        if (match) break;
      }
    }
    // A row that matched two different products has not identified either of
    // them, so it claims neither — the same call `yonex-catalogue.ts` makes.
    if (!match || match.rivals.length > 0) {
      unclaimed.push(row.name);
      continue;
    }
    for (const page of [match.candidate, ...match.siblings]) {
      if (!claimed.has(page.url)) claimed.set(page.url, row.name);
    }
  }

  const fresh = rackets.filter((racket) => !claimed.has(racket.url));
  console.log(
    `\n🔎 ${existingRows?.length ?? 0} Fleet rackets in the catalogue already; ` +
      `${rackets.length - fresh.length} of the ${rackets.length} pages are one of them.`,
  );
  if (verbose) {
    for (const racket of rackets) {
      const owner = claimed.get(racket.url);
      if (owner) console.log(`      held  ${racket.name}  →  ${owner}`);
    }
  }

  if (fresh.length === 0) {
    console.log("\nNothing new to write.");
    return;
  }

  const freshPriceless = fresh.filter((racket) => racket.price <= 0);
  console.log(`\n🆕 ${fresh.length} rackets the catalogue does not hold:`);
  for (const racket of fresh) {
    console.log(
      `      ${racket.slug.padEnd(38)} ${racket.price > 0 ? `₫${racket.price.toLocaleString("vi-VN")}` : "—"}`,
    );
  }
  if (freshPriceless.length > 0) {
    console.log(
      `\n⚠️  ${freshPriceless.length} of those quote no price and would be written with msrp 0.\n` +
        "   The app reads `lowestPrice ?? msrp`, so until a shop that sells them is\n" +
        "   scraped they render as ₫0 and sort as the cheapest rackets in the catalogue.",
    );
  }

  // The rows the site does not answer for. Most are discontinued frames Fleet
  // Việt Nam no longer publishes, but some are the truncations the retailer
  // scrape's year rule left behind — "Max Power" where the site says Max Power
  // 8810, "Brave" where it says Brave 6300 — and those now sit beside a fuller
  // row this import is about to add. Which of the four Max Powers the stub was
  // is not knowable from either side, so it is named here rather than merged.
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
    .upsert([{ id: "b-fleet", slug: "fleet", name: "Fleet" }], { onConflict: "id" });
  if (brandError) throw new Error(`brands: ${brandError.message}`);

  // No year is published anywhere on this site, so the crawl's year is used —
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
    "\nℹ️  These rackets carry the distributor's list price as msrp and no offer,\n" +
      "   because no shop in this catalogue was scraped selling them. The app reads\n" +
      "   `lowestPrice ?? msrp`, so they render at the price Fleet Việt Nam asks\n" +
      "   until a storefront that stocks them turns up in a nightly run.\n" +
      "   Run `npm run scrape:images -- --provider=fleet-vn` afterwards to give the\n" +
      "   new rows their photography.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
