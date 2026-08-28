/**
 * yonex.com's racket catalogue, read as catalogue rows rather than as offers.
 *
 *   npx tsx scripts/scraper/yonex-catalogue.ts            # crawl and report, write nothing
 *   npx tsx scripts/scraper/yonex-catalogue.ts --sync-db  # insert the rackets we do not hold
 *
 * The sibling of `forza-catalogue.ts`, and here for the same reason. Everything
 * in `sites/` reads a shop and produces offers, with a racket implied behind
 * each one. This reads the manufacturer, which quotes no price at all, so what
 * it yields is rackets with no offers.
 *
 * Why it exists: the gallery crawler matches 66 of the 77 racquets yonex.com
 * publishes to a racket this catalogue already holds. The other 11 are frames
 * no Vietnamese retailer in the scrape stocks — the aluminium Muscle Power and
 * B-series beginners' frames, the two Isometric TR training racquets, the E13
 * pair and the Muscle Power 2 Junior — so there was no row for their
 * photography to hang off, and `scrape:images` reported them as unmatched every
 * run. This writes those rows.
 *
 * ------------------------------------------------------------------
 * What Yonex publishes per racket, and what becomes of it
 *
 *   Frame: Aluminum          → frame_material, with Shaft, deduplicated
 *   Shaft: Graphite, Nylon   → frame_material
 *   Flex: Medium             → shaft_flex (only two of the 11 print this line)
 *   Weight / Grip:
 *     3U (Avg. 88g) G4,5     → weight_class, weight_grams, grip_size
 *   Stringing Advice:
 *     3U: 16 - 20 lbs        → max_tension_min_lbs, max_tension_max_lbs
 *   Length: 21 in.           → length_mm (only the junior and the TR pair)
 *   Color(s): White / Red    → the variant colourway
 *   Item Code: MP2           → the variant sku, verbatim
 *
 * ------------------------------------------------------------------
 * What it does not publish
 *
 * Everything else takes the placeholder every other scraped racket in this
 * catalogue already carries, unchanged since the first scrape and set in
 * `scripts/scraper/index.ts`: shaft_diameter_mm 6.8, string_pattern 22×21,
 * play_style_tags all-round, skill_level intermediate, release_year the year of
 * the crawl. 3025 of the catalogue's 3037 rackets carry the flat 295 mm balance
 * point for the same reason, and these 11 join them — Yonex publishes balance
 * for none of its frames, on any of its three sites.
 *
 * Two placeholders are worth naming rather than burying:
 *
 *   frame_shape  isometric is the pipeline's default *and* the correct answer
 *                here: Isometric is Yonex's own head shape, on every frame it
 *                sells. This is the one racket in the catalogue where the
 *                default happens to be a reading.
 *
 *   msrp         0, and reported at the end of the run. yonex.com publishes no
 *                price for any of these — there is no price block on the page
 *                at all — and the catalogue's money is VND. Converting a US
 *                sticker price through a rate this script invented would be a
 *                lie about money rather than a rough spec, which is the line
 *                `forza-catalogue.ts` drew for the same reason.
 *
 * A racket already in the catalogue is never touched: it came in from a
 * retailer listing and carries a real price and a real offer, and upserting a
 * spec sheet with msrp 0 over the top of that would replace a quoted price with
 * silence. Only rows that do not exist are written.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

import { loadEnv } from "./env";
import { fetchWithRetry, HTML_HEADERS, sleep } from "./http";
import { slugify } from "./normalizer";
import { bestMatch, slugOfUrl, type MatchCandidate } from "./images/match";

const LISTING = "https://www.yonex.com/badminton/racquets";
const OUTPUT = "scripts/scraper/output/yonex-rackets.json";
const USER_AGENT =
  "ShuttlecraftImageBot/1.0 (+https://github.com/shuttlecraft; catalogue image crawler)";

/** The listing is 7 pages of 12; the stop is a page that adds nothing new. */
const MAX_PAGES = 30;

/**
 * The manufacturer's own casing, made consistent enough to sit beside the rest
 * of the catalogue.
 *
 * Yonex prints every product name in capitals — "MUSCLE POWER 2", "ISOMETRIC TR
 * 1" — while the catalogue holds "Muscle Power 22" and "Isometric Lite 3",
 * because those came in from Vietnamese retailers. Left alone, one brand's
 * rackets would shout at each other across a comparison table.
 *
 * So a word is title-cased and a code is left alone. A token carrying a digit
 * is a model number (7000, E13, 88S). A token of one or two letters is a
 * designation (B, E, LT, TR, S, D). And a token of three or more letters with
 * no vowel in it is an initialism — MDM in "B 7000 MDM" — which title case
 * would otherwise turn into the word "Mdm".
 */
function displayName(raw: string): string {
  const fixSegment = (segment: string): string => {
    if (/\d/.test(segment)) return segment;
    if (segment.length <= 2) return segment;
    if (!/[aeiou]/i.test(segment)) return segment;
    if (segment !== segment.toUpperCase()) return segment;
    return segment[0] + segment.slice(1).toLowerCase();
  };

  return raw
    .split(/\s+/)
    .map((token) => (/\d/.test(token) ? token : token.split("-").map(fixSegment).join("-")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The weight bands the rest of the pipeline uses (see `generate-sql.ts`). */
function weightClassOf(grams: number): "2U" | "3U" | "4U" | "5U" {
  if (grams >= 90) return "2U";
  if (grams >= 85) return "3U";
  if (grams >= 80) return "4U";
  return "5U";
}

/**
 * Yonex's scale of flex, as printed, mapped onto the `shaft_flex` enum.
 *
 * Yonex writes four of these and the enum holds four, but only two of the words
 * are the same. "Hi-Flex" is the flexible end of Yonex's range, not a stiff one
 * — the name describes how much flex the shaft has, not how much it resists —
 * and "Extra Stiff" is the enum's `extra-stiff` with a space. Casing is Yonex's
 * own and varies by page: "STIFF" on ARCSABER 11 PRO, "Stiff" on ASTROX 88 D.
 */
const FLEX: Record<string, string> = {
  "hi-flex": "flexible",
  flexible: "flexible",
  medium: "medium",
  stiff: "stiff",
  "extra stiff": "extra-stiff",
  "extra-stiff": "extra-stiff",
};

/**
 * What one "Weight / Grip" line says.
 *
 * Yonex writes this four ways, and three of them are a measurement:
 *
 *   3U (Avg. 88g) G4,5       a class and an average
 *   (Avg. 150g) G4, 5        an average with no class — the TR training frames
 *   2U (93g) G5              an average without the word, and on MUSCLE POWER
 *                            5 LT it is filed under "Recommended String"
 *   U (105g and below) G4    a **ceiling**, and the only weight the aluminium
 *                            frames carry
 *
 * The last one is not a measurement and is marked `estimated`. The number kept
 * is the 105 Yonex printed rather than a midpoint this script invented: every
 * value here is a guess about a racket that weighs *at most* 105 g, and only
 * one of them is traceable to the page. `weight_class` has no U, and U is the
 * heaviest of Yonex's classes, so it lands in 2U.
 */
function parseWeight(cell: string): {
  weightClass: "2U" | "3U" | "4U" | "5U" | null;
  grams: number | null;
  estimated: boolean;
} {
  const ceiling = /\bU\s*\(\s*(\d{2,3})\s*g\s*and\s*below/i.exec(cell);
  if (ceiling) {
    return { weightClass: "2U", grams: parseInt(ceiling[1], 10), estimated: true };
  }

  // Class and grams together, so a page listing two builds ("4U (Avg.83g) G5,
  // 63U (Avg.88g)") cannot pair the class of one with the weight of the other.
  // "Avg." is written with a colon on ASTROX NEXTAGE and nowhere else.
  const paired = /([2345])U\s*\(\s*(?:Avg[.:]?\s*)?(\d{2,3})\s*g/i.exec(cell);
  if (paired) {
    return {
      weightClass: `${paired[1]}U` as "2U" | "3U" | "4U" | "5U",
      grams: parseInt(paired[2], 10),
      estimated: false,
    };
  }

  const grams = /\(\s*(?:Avg[.:]?\s*)?(\d{2,3})\s*g/i.exec(cell);
  if (grams) {
    return { weightClass: null, grams: parseInt(grams[1], 10), estimated: false };
  }

  // A class and its grip sizes, with no weight at all: "4U5,6", "4U5/6, 3U4/5/6".
  // The class is real and worth keeping; the grams stay null and the variant
  // falls back to the band default, exactly as a spec-less scrape does.
  const classOnly = /([2345])U(?!\s*\()/i.exec(cell);
  if (classOnly) {
    return {
      weightClass: `${classOnly[1]}U` as "2U" | "3U" | "4U" | "5U",
      grams: null,
      estimated: false,
    };
  }

  return { weightClass: null, grams: null, estimated: false };
}

export interface YonexRacket {
  url: string;
  slug: string;
  name: string;
  itemCode: string | null;
  /** The class Yonex printed, where it printed one. */
  weightClass: "2U" | "3U" | "4U" | "5U" | null;
  weightGrams: number | null;
  /** True when `weightGrams` is the U-class estimate rather than a printed average. */
  weightEstimated: boolean;
  gripSize: "G4" | "G5" | "G6" | null;
  flex: string | null;
  tensionLbs: [number, number] | null;
  lengthMm: number | null;
  materials: string[];
  colour: string | null;
  /** Spec lines the page printed that this parser did not understand. */
  unparsed: string[];
}

/** Walk the paginated category listing for product urls and their names. */
async function readListing(timeoutMs: number): Promise<{ url: string; name: string }[]> {
  const byUrl = new Map<string, string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? LISTING : `${LISTING}?p=${page}`;
    if (page > 1) await sleep(400);

    const res = await fetchWithRetry(url, {
      headers: { ...HTML_HEADERS, "User-Agent": USER_AGENT },
      timeoutMs,
    });
    if (!res.ok) break;

    const $ = cheerio.load(res.body);
    let fresh = 0;

    $("a.product-item-link").each((_, el) => {
      const href = $(el).attr("href");
      const name = $(el).text().replace(/\s+/g, " ").trim();
      if (!href || !name) return;
      const clean = href.split(/[?#]/)[0].replace(/\/+$/, "");
      if (byUrl.has(clean)) return;
      byUrl.set(clean, name);
      fresh++;
    });

    if (fresh === 0) break;
  }

  return [...byUrl].map(([url, name]) => ({ url, name }));
}

/**
 * Read one product page's spec table.
 *
 * The table is a flat run of `th`/`td` pairs, and which key a value sits under
 * is not reliable — MUSCLE POWER 5 LT prints its weight under "Recommended
 * String" rather than "Weight / Grip". So the keys are collected, and the
 * values that carry a recognisable measurement are read by shape wherever they
 * landed.
 */
async function readRacket(url: string, listedName: string, timeoutMs: number): Promise<YonexRacket> {
  const res = await fetchWithRetry(url, {
    headers: { ...HTML_HEADERS, "User-Agent": USER_AGENT },
    timeoutMs,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const $ = cheerio.load(res.body);
  const cells: string[] = [];
  $("th, td").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) cells.push(text);
  });

  const spec = new Map<string, string>();
  for (let i = 0; i + 1 < cells.length; i += 2) spec.set(cells[i], cells[i + 1]);

  const get = (key: string): string | null => spec.get(key) ?? null;

  // The weight lives in its own cell, and reading it out of the whole table
  // would pick up any stray "88g" in the marketing copy. MUSCLE POWER 5 LT is
  // the one page that files it under "Recommended String" instead.
  const weightCell = get("Weight / Grip") ?? get("Recommended String") ?? "";
  const { weightClass, grams: weightGrams, estimated } = parseWeight(weightCell);

  // "G4,5" · "G4, 5" · "G5". The smallest is the one variant recorded.
  const gripMatch = /G\s*([456])/.exec(weightCell);
  const gripSize = gripMatch ? (`G${gripMatch[1]}` as "G4" | "G5" | "G6") : null;

  const tension = /(\d{2})\s*[-–]\s*(\d{2})\s*lbs/i.exec(get("Stringing Advice") ?? "");

  // "21 in." on the junior; "10 mm longer" on the two TR training frames,
  // which is stated relative to the 675 mm every other frame here is.
  const inches = /(\d{2})\s*in\./i.exec(get("Length") ?? "");
  const longerMm = /(\d+)\s*mm\s+longer/i.exec(get("Length") ?? "");
  const lengthMm = inches
    ? Math.round(parseInt(inches[1], 10) * 25.4)
    : longerMm
      ? 675 + parseInt(longerMm[1], 10)
      : null;

  const materials = [...new Set(
    [get("Frame"), get("Shaft")]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.split(/\s*,\s*/))
      .map((value) => value.trim())
      .filter(Boolean),
  )];

  const flexRaw = get("Flex");
  const flex = flexRaw ? (FLEX[flexRaw.toLowerCase().replace(/\s+/g, " ").trim()] ?? null) : null;

  const unparsed: string[] = [];
  const lengthRaw = get("Length");
  if (lengthRaw && lengthMm === null) unparsed.push(`Length: ${lengthRaw}`);
  if (flexRaw && !flex) unparsed.push(`Flex: ${flexRaw}`);
  if (weightCell && weightGrams === null && weightClass === null) {
    unparsed.push(`Weight / Grip: ${weightCell}`);
  }

  const name = displayName(listedName);

  return {
    url,
    slug: `yonex-${slugify(name)}`,
    name,
    itemCode: get("Item Code"),
    weightClass,
    weightGrams,
    weightEstimated: estimated,
    gripSize,
    flex,
    tensionLbs: tension ? [parseInt(tension[1], 10), parseInt(tension[2], 10)] : null,
    lengthMm,
    materials,
    colour: get("Color(s)"),
    unparsed,
  };
}

/** The `rackets` row this site's data supports, placeholders included. */
function racketRow(racket: YonexRacket, releaseYear: number) {
  return {
    id: `r-${racket.slug}`,
    slug: racket.slug,
    brand_id: "b-yonex",
    name: racket.name,
    release_year: releaseYear,
    balance_point_mm: 295,
    shaft_flex: racket.flex ?? "medium",
    shaft_diameter_mm: 6.8,
    // Isometric is Yonex's own head shape, and the pipeline default. See the
    // file header: the only place where the two agree by more than luck.
    frame_shape: "isometric",
    frame_material: racket.materials.length > 0 ? racket.materials : ["HM Graphite"],
    max_tension_min_lbs: racket.tensionLbs?.[0] ?? 20,
    max_tension_max_lbs: racket.tensionLbs?.[1] ?? 28,
    length_mm: racket.lengthMm ?? 675,
    string_pattern: "22×21",
    msrp: 0,
    currency: "VND",
    play_style_tags: ["all-round"],
    skill_level: "intermediate",
  };
}

function variantRow(racket: YonexRacket) {
  const grams = racket.weightGrams ?? 82;
  // The manufacturer's own class where it printed one; the band the weight
  // falls in otherwise — which is all the TR training frames give us.
  const weightClass = racket.weightClass ?? weightClassOf(grams);
  const gripSize = racket.gripSize ?? "G5";
  return {
    id: `v-${racket.slug}-${weightClass.toLowerCase()}-${gripSize.toLowerCase()}`,
    racket_id: `r-${racket.slug}`,
    weight_class: weightClass,
    weight_grams: grams,
    grip_size: gripSize,
    // Yonex prints several colours on one page; the variant records the first,
    // and the gallery crawler records each colourway against its photograph.
    colourway: racket.colour?.split(/\s*,\s*/)[0]?.trim() ?? null,
    sku: racket.itemCode ?? `YONEX-${racket.slug.slice(0, 12).toUpperCase()}-${weightClass}`,
  };
}

async function main() {
  loadEnv();
  const timeoutMs = 30000;
  const syncDb = process.argv.includes("--sync-db");

  console.log("=================================================");
  console.log("🏸 Yonex catalogue import");
  console.log("=================================================");
  console.log(`Source      : ${LISTING}`);
  console.log(`Writes      : ${syncDb ? "rackets + racket_variants (new rows only)" : "nothing — report only"}`);
  console.log("=================================================\n");

  const listed = await readListing(timeoutMs);
  console.log(`📄 ${listed.length} racquets linked from the listing\n`);

  const rackets: YonexRacket[] = [];
  for (const [index, entry] of listed.entries()) {
    if (index > 0) await sleep(400);
    try {
      const racket = await readRacket(entry.url, entry.name, timeoutMs);
      rackets.push(racket);
      console.log(
        `   ${String(index + 1).padStart(2)}/${listed.length}  ${racket.name.padEnd(24)} ` +
          `${(racket.itemCode ?? "—").padEnd(9)} ` +
          `${String(racket.weightGrams ?? "?").padStart(3)}g${racket.weightEstimated ? "~" : " "} ` +
          `${(racket.gripSize ?? "?").padEnd(2)}  ` +
          `${racket.tensionLbs ? `${racket.tensionLbs[0]}-${racket.tensionLbs[1]}lbs` : "?lbs"}  ` +
          `flex ${(racket.flex ?? "—").padEnd(8)} ${racket.materials.join("/") || "—"}`,
      );
    } catch (err) {
      console.log(`   ${entry.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const path = resolve(process.cwd(), OUTPUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ readAt: new Date().toISOString(), source: LISTING, rackets }, null, 2),
    "utf8",
  );
  console.log(`\n💾 Wrote ${rackets.length} racquets to ${OUTPUT}`);

  for (const racket of rackets.filter((r) => r.unparsed.length > 0)) {
    console.log(`⚠️  ${racket.name}: unrecognised ${racket.unparsed.join(", ")}`);
  }

  if (!syncDb) {
    console.log("\nℹ️  Nothing was written. Re-run with --sync-db to insert the missing rows.");
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("\n❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exitCode = 1;
    return;
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Which of these the catalogue already holds is a *matching* question, not an
  // id lookup, and getting that wrong writes duplicates.
  //
  // The id is minted from Yonex's spelling of the name, and the catalogue's
  // spelling came from Vietnamese retailers. Yonex prints "ASTROX 88 S PRO", so
  // the id would be `r-yonex-astrox-88-s-pro`; the catalogue holds the same
  // frame as "Astrox 88S Pro", which is `r-yonex-astrox-88s-pro`. An `in("id")`
  // check calls those two different rackets and inserts a second row for a
  // frame that is already here — seven of them, the whole ASTROX 88 D/S family
  // plus NANOFLARE 1000 Z. Which is exactly the pair of spellings `match.ts`
  // was taught to reconcile, so this asks it rather than guessing again.
  const { data: heldRows, error: heldError } = await supabase
    .from("rackets")
    .select("id, name, brand_id")
    .eq("brand_id", "b-yonex");
  if (heldError) throw new Error(`reading rackets: ${heldError.message}`);

  const candidates: MatchCandidate[] = rackets.map((racket) => ({
    url: racket.url,
    slug: slugOfUrl(racket.url),
    title: racket.name,
  }));

  const claimed = new Set<string>();
  for (const row of heldRows ?? []) {
    const best = bestMatch(row.name as string, "Yonex", candidates);
    if (!best || best.rivals.length > 0) continue;
    for (const page of [best.candidate, ...best.siblings]) claimed.add(page.url);
  }

  const fresh = rackets.filter((racket) => !claimed.has(racket.url));
  const existing = rackets.length - fresh.length;

  console.log(`\n↩️  ${existing} already in the catalogue under its own name, left untouched.`);
  if (fresh.length === 0) {
    console.log("Nothing new to write.");
    return;
  }

  console.log(`\n🆕 ${fresh.length} to insert:`);
  for (const racket of fresh) console.log(`      ${racket.name}  (r-${racket.slug})`);

  const thisYear = new Date().getFullYear();
  const racketRows = fresh.map((racket) => racketRow(racket, thisYear));
  const { error: racketError } = await supabase
    .from("rackets")
    .upsert(racketRows, { onConflict: "id" });
  if (racketError) throw new Error(`rackets: ${racketError.message}`);

  const { error: variantError } = await supabase
    .from("racket_variants")
    .upsert(fresh.map(variantRow), { onConflict: "id" });
  if (variantError) throw new Error(`racket_variants: ${variantError.message}`);

  console.log(`\n✅ Inserted ${fresh.length} rackets and ${fresh.length} variants.`);

  const estimated = fresh.filter((racket) => racket.weightEstimated);
  if (estimated.length > 0) {
    console.log(
      `\n⚠️  ${estimated.length} carry an estimated weight: Yonex prints only ` +
        `"U (105g and below)" for them, so the weight recorded is that ceiling ` +
        `and the class is 2U — a bound Yonex printed, not a measurement.`,
    );
    console.log(`      ${estimated.map((r) => r.name).join(", ")}`);
  }
  console.log(
    `\n⚠️  All ${fresh.length} are written with msrp 0, which the app renders as "₫0". ` +
      `yonex.com quotes no price for any of them and the catalogue's money is VND; ` +
      `a converted US sticker price would be invented, not read.`,
  );
  console.log(
    `\n   Balance point is the flat 295 mm that 3025 of the catalogue's other ` +
      `rackets already carry — Yonex publishes balance for no frame on any of its sites.`,
  );
  console.log(`\n   Next: npm run scrape:images -- --provider=yonex,yonex-uk,yonex-jp`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
