/**
 * fz-forza.com's racket catalogue, read as catalogue rows rather than as offers.
 *
 *   npx tsx scripts/scraper/forza-catalogue.ts            # crawl and report, write nothing
 *   npx tsx scripts/scraper/forza-catalogue.ts --sync-db  # upsert rackets and variants
 *
 * Why this is not a `sites/` adapter: everything in `sites/` reads a *shop* and
 * produces `NormalizedItem`s, each of which is an offer — a price, a seller, a
 * stock count — with a racket implied behind it. fz-forza.com is the
 * manufacturer's own site and sells nothing. It publishes the specification FZ
 * Forza prints on the frame and no price at all, so what it yields is rackets
 * with no offers, and forcing that through the offer pipeline would mean
 * inventing a seller and a price for every one of them.
 *
 * What the site publishes per racket, and what becomes of it:
 *
 *   Item no. FZ262671   → the variant sku, verbatim
 *   WEIGHT: 86g +/-2    → weight_grams, and the weight_class it falls in
 *   BALANCE: M          → balance_point_mm, through the mapping in BALANCE_MM
 *   FLEXIBILITY: M      → shaft_flex
 *   REC. TENSION: 36    → max_tension_min_lbs and max_tension_max_lbs, both
 *   SHAFT / FRAME       → frame_material
 *
 * What it does not publish gets the same placeholder every other scraped racket
 * in this catalogue already carries — `generate-sql.ts` has filled these the
 * same way since the first scrape: shaft_diameter_mm 6.8, frame_shape
 * isometric, string_pattern 22×21, play_style_tags all-round, skill_level
 * intermediate, grip_size G5. HOLES is read and reported but has no column;
 * string_pattern is a pattern, not a count, and inventing one from the other
 * would be a guess dressed as a measurement.
 *
 * And one field it does not publish has no honest placeholder: **msrp**. FZ
 * Forza lists no prices, no Vietnamese retailer in this catalogue stocks 27 of
 * these 29 frames, and a made-up price is a lie about money rather than a rough
 * spec. They are written with msrp 0, which the app currently renders as "₫0".
 * The run says so at the end rather than leaving it to be discovered.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

import { loadEnv } from "./env";
import { cleanText, fetchWithRetry, HTML_HEADERS, sleep } from "./http";
import { slugify } from "./normalizer";

const LISTING = "https://fz-forza.com/badminton/rackets/";
const OUTPUT = "scripts/scraper/output/forza-rackets.json";
const USER_AGENT =
  "ShuttlecraftImageBot/1.0 (+https://github.com/shuttlecraft; catalogue image crawler)";

/**
 * FZ Forza publishes balance as a class, not a measurement, so this is a
 * mapping and not a reading. The three points are the middle of the bands the
 * Balance Ruler already draws over 280–305 mm, and they are the same kind of
 * estimate as the flat 295 every spec-less racket in this catalogue carries
 * today — but keyed to what the manufacturer actually says, which the 295 is
 * not. A page that omits the line keeps the 295.
 */
const BALANCE_MM: Record<string, number> = {
  HL: 288,
  M: 295,
  HH: 302,
};

/** FZ Forza's scale, as printed: flexible, medium, stiff, very stiff. */
const FLEX: Record<string, string> = {
  F: "flexible",
  M: "medium",
  S: "stiff",
  VS: "extra-stiff",
};

/**
 * The manufacturer's own casing, made consistent enough to sit beside the rest
 * of the catalogue.
 *
 * FZ Forza titles some families in capitals ("PRECISION TI-88S", "AERO POWER
 * 876") and others in title case ("K-Power 36 M", "Speed Light 90"), and the
 * two rackets this catalogue already holds came from Vietnamese retailers as
 * "Precision TI-X1". Left alone, one brand's rackets would shout at each other
 * across a comparison table.
 *
 * So a word in capitals is title-cased, and everything that is not a word is
 * left exactly as it was: a token carrying a digit is a model code (TI-88S,
 * TI-X1, 876), and a token of one or two letters is an initialism (HT, VS, S,
 * M). "Master" keeps its trailing S or M capitalised, which is FZ's way of
 * marking the stiff and medium builds of one frame — the same S and M that
 * stand alone in "K-Power 36 S".
 */
function displayName(raw: string): string {
  const fixSegment = (segment: string): string => {
    if (/\d/.test(segment)) return segment;
    if (segment.length <= 2) return segment;
    if (segment !== segment.toUpperCase()) return segment;
    return segment[0] + segment.slice(1).toLowerCase();
  };

  return raw
    .split(/\s+/)
    .map((token) => (/\d/.test(token) ? token : token.split("-").map(fixSegment).join("-")))
    .join(" ")
    .replace(/\bMaster([sm])\b/g, (_, letter: string) => `Master${letter.toUpperCase()}`);
}

/** The weight bands the rest of the pipeline uses (see `generate-sql.ts`). */
function weightClassOf(grams: number): "2U" | "3U" | "4U" | "5U" {
  if (grams >= 90) return "2U";
  if (grams >= 85) return "3U";
  if (grams >= 80) return "4U";
  return "5U";
}

export interface ForzaRacket {
  url: string;
  slug: string;
  name: string;
  itemNo: string | null;
  weightGrams: number | null;
  balanceClass: string | null;
  flexClass: string | null;
  holes: number | null;
  recTensionLbs: number | null;
  materials: string[];
  colour: string | null;
  images: string[];
  /** Spec values the page carried that this script does not understand. */
  unparsed: string[];
}

/** Every racket page linked from the listing, with the name the tile shows. */
async function readListing(timeoutMs: number): Promise<{ url: string; name: string }[]> {
  const res = await fetchWithRetry(LISTING, {
    headers: { ...HTML_HEADERS, "User-Agent": USER_AGENT },
    timeoutMs,
  });
  if (!res.ok) throw new Error(`listing: HTTP ${res.status}`);

  const $ = cheerio.load(res.body);
  const out = new Map<string, string>();

  // The listing is a Modula gallery: the link is an empty anchor laid over the
  // tile, and the name sits beside it in the tile's caption.
  $("a.modula-simple-link").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!/^https:\/\/fz-forza\.com\/badminton\/rackets\/.+/.test(href)) return;
    const url = href.replace(/\/+$/, "");
    if (out.has(url)) return;
    const caption = $(el).closest(".modula-item").find(".jtg-description").first().text();
    out.set(url, cleanText(caption).replace(/^FZ\s+/i, ""));
  });

  return [...out.entries()].map(([url, name]) => ({ url, name }));
}

/** One racket page: the name it titles itself, its specs, its photographs. */
async function readRacket(
  url: string,
  fallbackName: string,
  timeoutMs: number,
): Promise<ForzaRacket> {
  const res = await fetchWithRetry(url, {
    headers: { ...HTML_HEADERS, "User-Agent": USER_AGENT },
    timeoutMs,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const $ = cheerio.load(res.body);

  // "K-Power 36 M - FZ FORZA". The model name contains hyphens of its own, so
  // the suffix comes off as a whole rather than by splitting on the separator.
  //
  // The trailing year on five of these — "Speed Light 100 2026", "HT Power 36
  // MasterS 2026" — stays in the name, and it took a collision to see why. FZ
  // keeps last season's page up beside this one, so the site publishes both a
  // 2025 and a 2026 HT Power 36 MasterS: same model name, two editions, two
  // pages, different photography. Strip the year and the two become one name
  // pointing at two products, which is precisely the case `match.ts` refuses to
  // guess at. The year is what tells them apart, and the manufacturer's own
  // page title is where it comes from.
  const title = cleanText($("title").first().text()).replace(/\s*[-–]\s*FZ FORZA\s*$/i, "");
  const name = displayName(title || fallbackName);

  $("script, style").remove();
  const text = cleanText($("body").text());

  const spec = (pattern: RegExp): string | null => {
    const match = pattern.exec(text);
    return match ? cleanText(match[1]) : null;
  };

  // The weight line is labelled "WEIGHT:" on most pages and "HEIGHT:" on a few
  // — the site's own typo, in the same block, always followed by a gram value.
  const weightRaw = spec(/(?:WEIGHT|HEIGHT):\s*([0-9]+)\s*g/i);
  const itemNo = spec(/Item no\.\s*([A-Z0-9]+)/i);
  const balance = spec(/BALANCE:\s*([A-Za-z]{1,2})\b/);
  const flex = spec(/FLEXIBILITY:\s*([A-Za-z]{1,2})\b/);
  const holes = spec(/HOLES:\s*([0-9]+)/i);
  const tension = spec(/REC\.\s*TENSION:\s*([0-9]+)/i);
  const shaft = spec(/SHAFT:\s*([^:]{1,40}?)\s*(?:FRAME|Color|Power rating)/i);
  const frame = spec(/FRAME:\s*([^:]{1,40}?)\s*(?:Color|Power rating|SHAFT)/i);
  const colour = spec(/Color:\s*([^:]{1,40}?)\s*(?:Power rating|Back to all)/i);

  const unparsed: string[] = [];
  if (balance && !(balance.toUpperCase() in BALANCE_MM)) unparsed.push(`BALANCE: ${balance}`);
  if (flex && !(flex.toUpperCase() in FLEX)) unparsed.push(`FLEXIBILITY: ${flex}`);

  // The photographs are the uploads named after the item number the page itself
  // prints — FZ262671_1001_K-POWER36-M_100. Everything else under /uploads/ on
  // the page is the logo or a technology badge. They are served through
  // Jetpack's photon host with a resize query; the origin URL behind that is the
  // untouched upload.
  const images = new Set<string>();
  for (const match of res.body.matchAll(
    /https?:\/\/(?:i\d\.wp\.com\/)?fz-forza\.com(\/wp-content\/uploads\/[^"'\s)?]*FZ\d+_[^"'\s)?]*)/gi,
  )) {
    images.add(`https://fz-forza.com${match[1]}`);
  }

  return {
    url,
    slug: `forza-${slugify(name)}`,
    name,
    itemNo,
    weightGrams: weightRaw ? parseInt(weightRaw, 10) : null,
    balanceClass: balance ? balance.toUpperCase() : null,
    flexClass: flex ? flex.toUpperCase() : null,
    holes: holes ? parseInt(holes, 10) : null,
    recTensionLbs: tension ? parseInt(tension, 10) : null,
    // Shaft and frame are usually the same lay-up; listing "30T graphite"
    // twice would read as two materials.
    materials: [...new Set([shaft, frame].filter((value): value is string => Boolean(value)))],
    colour,
    images: [...images].sort(),
    unparsed,
  };
}

/** The `rackets` row this site's data supports, placeholders included. */
function racketRow(racket: ForzaRacket, releaseYear: number) {
  const tension = racket.recTensionLbs;
  return {
    id: `r-${racket.slug}`,
    slug: racket.slug,
    brand_id: "b-forza",
    name: racket.name,
    release_year: releaseYear,
    balance_point_mm: BALANCE_MM[racket.balanceClass ?? ""] ?? 295,
    shaft_flex: FLEX[racket.flexClass ?? ""] ?? "medium",
    shaft_diameter_mm: 6.8,
    frame_shape: "isometric",
    frame_material: racket.materials.length > 0 ? racket.materials : ["HM Graphite"],
    max_tension_min_lbs: tension ?? 20,
    max_tension_max_lbs: tension ?? 28,
    length_mm: 675,
    string_pattern: "22×21",
    msrp: 0,
    currency: "VND",
    play_style_tags: ["all-round"],
    skill_level: "intermediate",
  };
}

function variantRow(racket: ForzaRacket) {
  const grams = racket.weightGrams ?? 82;
  const weightClass = weightClassOf(grams);
  return {
    id: `v-${racket.slug}-${weightClass.toLowerCase()}-g5`,
    racket_id: `r-${racket.slug}`,
    weight_class: weightClass,
    weight_grams: grams,
    grip_size: "G5",
    colourway: racket.colour,
    // The manufacturer's own item number, which is a better sku than the
    // synthesised one `generate-sql.ts` builds from the slug.
    sku: racket.itemNo ?? `FORZA-${racket.slug.slice(0, 12).toUpperCase()}-${weightClass}`,
  };
}

async function main() {
  loadEnv();
  const timeoutMs = 30000;
  const syncDb = process.argv.includes("--sync-db");

  console.log("=================================================");
  console.log("🏸 FZ Forza catalogue import");
  console.log("=================================================");
  console.log(`Source      : ${LISTING}`);
  console.log(`Writes      : ${syncDb ? "rackets + racket_variants (upsert)" : "nothing — report only"}`);
  console.log("=================================================\n");

  const listed = await readListing(timeoutMs);
  console.log(`📄 ${listed.length} rackets linked from the listing\n`);

  const rackets: ForzaRacket[] = [];
  for (const [index, entry] of listed.entries()) {
    if (index > 0) await sleep(400);
    try {
      const racket = await readRacket(entry.url, entry.name, timeoutMs);
      rackets.push(racket);
      console.log(
        `   ${String(index + 1).padStart(2)}/${listed.length}  ${racket.name.padEnd(22)} ` +
          `${(racket.itemNo ?? "—").padEnd(10)} ${String(racket.weightGrams ?? "?").padStart(3)}g  ` +
          `bal ${(racket.balanceClass ?? "?").padEnd(2)}  flex ${(racket.flexClass ?? "?").padEnd(2)}  ` +
          `${String(racket.recTensionLbs ?? "?").padStart(2)}lbs  ${racket.images.length} photos`,
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
  console.log(`\n💾 Wrote ${rackets.length} rackets to ${OUTPUT}`);

  const missing = {
    specs: rackets.filter((r) => !r.weightGrams || !r.balanceClass || !r.flexClass),
    photos: rackets.filter((r) => r.images.length === 0),
    unparsed: rackets.filter((r) => r.unparsed.length > 0),
  };
  if (missing.specs.length > 0) {
    console.log(`⚠️  ${missing.specs.length} rackets are missing a spec line: ` +
      missing.specs.map((r) => r.name).join(", "));
  }
  if (missing.photos.length > 0) {
    console.log(`⚠️  ${missing.photos.length} rackets carry no photograph: ` +
      missing.photos.map((r) => r.name).join(", "));
  }
  for (const racket of missing.unparsed) {
    console.log(`⚠️  ${racket.name}: unrecognised ${racket.unparsed.join(", ")}`);
  }

  if (!syncDb) {
    console.log("\nℹ️  Nothing was written. Re-run with --sync-db to upsert the rows.");
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

  // The year the model was published, where the site's own url says so
  // (…-2025, …-2026) and the year of the crawl otherwise — which is the same
  // rule `generate-sql.ts` uses for every scraped racket.
  const thisYear = new Date().getFullYear();
  const yearOf = (racket: ForzaRacket): number => {
    const match = /-(\d{4})$/.exec(racket.url);
    return match ? parseInt(match[1], 10) : thisYear;
  };

  const { error: brandError } = await supabase
    .from("brands")
    .upsert([{ id: "b-forza", slug: "forza", name: "Forza" }], { onConflict: "id" });
  if (brandError) throw new Error(`brands: ${brandError.message}`);

  // A racket this catalogue already holds is left alone entirely.
  //
  // Two of the 29 are already here — Precision TI-X1 and TI-X5 — and they came
  // in from Vietnamese retailer listings, which means they carry a real price
  // and a real offer behind it. Upserting over them would replace a price a
  // shop actually quoted with the 0 this site's silence produces, and rename
  // them on the way past. Nothing this site publishes is worth that.
  const { data: existingRows, error: existingError } = await supabase
    .from("rackets")
    .select("id, name")
    .in("id", rackets.map((racket) => `r-${racket.slug}`));
  if (existingError) throw new Error(`reading rackets: ${existingError.message}`);

  const existing = new Map((existingRows ?? []).map((row) => [row.id, row.name]));
  const fresh = rackets.filter((racket) => !existing.has(`r-${racket.slug}`));

  if (existing.size > 0) {
    console.log(`\n↩️  ${existing.size} already in the catalogue, left untouched:`);
    for (const [id, name] of existing) console.log(`      ${name}  (${id})`);
  }
  if (fresh.length === 0) {
    console.log("\nNothing new to write.");
    return;
  }

  const racketRows = fresh.map((racket) => racketRow(racket, yearOf(racket)));
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
    "\n⚠️  These rackets have no price. FZ Forza publishes none and no seller in\n" +
      "   this catalogue carries them, so msrp is 0 rather than a number nobody\n" +
      "   quoted. The app reads `lowestPrice ?? msrp`, so until an offer exists\n" +
      "   they render as ₫0 and sort as the cheapest rackets in the catalogue.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
