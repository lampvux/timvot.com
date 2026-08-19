import type { ScrapedProduct, ScrapedProductSpecs } from "./types";
import { brands as seedBrands } from "../../src/lib/data/seed";
import { splitColourway, stripVariantTokens } from "./colourway";
import type { WeightClass, GripSize, ShaftFlex } from "../../src/lib/types";

export interface NormalizedItem {
  scraped: ScrapedProduct;
  brandSlug: string;
  brandName: string;
  racketSlug: string;
  racketName: string;
  variantId: string;
  weightClass: WeightClass;
  gripSize: GripSize;
  /** Colour as the shop wrote it, or null when the listing named none. */
  colourway: string | null;
  price: number;
  msrp: number;
  inStock: boolean;
  qtyAvailable: number;
  sellerSlug: string;
  specs: ScrapedProductSpecs;
}

/**
 * Brand aliases, longest first so that "pro kennex" is tested before "pro" and
 * "li-ning" before "ning". Each entry is matched on a word boundary: the old
 * substring test meant the alias "vs" claimed any title containing those two
 * letters, and every unmatched racket fell into a single "other" brand.
 */
const BRAND_ALIASES: [pattern: string, slug: string, name: string][] = [
  ["pro[\\s-]?kennex", "pro-kennex", "Pro Kennex"],
  ["li[\\s-]?ning", "li-ning", "Li-Ning"],
  ["lining", "li-ning", "Li-Ning"],
  ["the 3rd game", "the-3rd-game", "The 3rd Game"],
  ["yonex", "yonex", "Yonex"],
  ["victor", "victor", "Victor"],
  ["mizuno", "mizuno", "Mizuno"],
  ["kumpoo", "kumpoo", "Kumpoo"],
  ["kawasaki", "kawasaki", "Kawasaki"],
  ["flypower", "flypower", "Flypower"],
  ["hundred", "hundred", "Hundred"],
  ["sunbatta", "sunbatta", "Sunbatta"],
  ["ashaway", "ashaway", "Ashaway"],
  ["babolat", "babolat", "Babolat"],
  ["adonex", "adonex", "Adonex"],
  ["protech", "protech", "Protech"],
  ["proace", "proace", "Proace"],
  ["vicleo", "vicleo", "Vicleo"],
  ["fukymi", "fukymi", "Fukymi"],
  ["kamito", "kamito", "Kamito"],
  ["bubadu", "bubadu", "Bubadu"],
  ["revilo", "revilo", "Revilo"],
  ["tenway", "tenway", "Tenway"],
  ["adidas", "adidas", "Adidas"],
  ["dunlop", "dunlop", "Dunlop"],
  ["carlton", "carlton", "Carlton"],
  ["toalson", "toalson", "Toalson"],
  ["redson", "redson", "Redson"],
  ["silvers", "silvers", "Silvers"],
  ["wilson", "wilson", "Wilson"],
  ["apacs", "apacs", "Apacs"],
  ["felet", "felet", "Felet"],
  ["fleet", "fleet", "Fleet"],
  ["forza", "forza", "Forza"],
  ["gosen", "gosen", "Gosen"],
  ["lotus", "lotus", "Lotus"],
  ["maxta", "maxta", "Maxta"],
  ["kepot", "kepot", "Kepot"],
  ["apavi", "apavi", "Apavi"],
  ["jnice", "jnice", "Jnice"],
  ["bonny", "bonny", "Bonny"],
  ["nezumi", "nezumi", "Nezumi"],
  ["taro", "taro", "Taro"],
  ["head", "head", "Head"],
  ["rsl", "rsl", "RSL"],
  ["ixe", "ixe", "IXE"],
  ["vnb", "vnb", "VNB"],
  ["vs", "vs", "VS"],
];

/** Category slug prefixes the WooCommerce sites use for their brand taxonomies. */
const BRAND_CATEGORY_PREFIXES = ["vot-cau-long-", "dong-vot-", "vot-"];

const brandRegexCache = new Map<string, RegExp>();
function brandRegex(pattern: string): RegExp {
  let re = brandRegexCache.get(pattern);
  if (!re) {
    // \b does not fire cleanly next to non-ASCII, so bound on non-letters.
    re = new RegExp(`(?:^|[^a-z0-9])${pattern}(?:[^a-z0-9]|$)`, "i");
    brandRegexCache.set(pattern, re);
  }
  return re;
}

function brandDisplayName(slug: string, fallback: string): string {
  const seeded = seedBrands.find((b) => b.slug === slug);
  return seeded ? seeded.name : fallback;
}

/**
 * Resolve the brand. Category membership wins when the source site publishes it
 * — `vot-cau-long-yonex` is the shop's own classification and beats guessing
 * from the title — otherwise fall back to matching the title.
 */
export function detectBrand(
  rawTitle: string,
  rawBrand?: string,
  categorySlugs?: string[],
): { slug: string; name: string } {
  for (const slug of categorySlugs || []) {
    for (const prefix of BRAND_CATEGORY_PREFIXES) {
      if (!slug.startsWith(prefix)) continue;
      const tail = slug.slice(prefix.length);
      const alias = BRAND_ALIASES.find(([pattern]) => brandRegex(pattern).test(` ${tail} `));
      if (alias) return { slug: alias[1], name: brandDisplayName(alias[1], alias[2]) };
    }
  }

  const haystack = ` ${(rawBrand || "") + " " + rawTitle} `.toLowerCase();
  for (const [pattern, slug, name] of BRAND_ALIASES) {
    if (brandRegex(pattern).test(haystack)) {
      return { slug, name: brandDisplayName(slug, name) };
    }
  }

  return { slug: "other", name: rawBrand || "Other" };
}

export function extractWeightClass(text: string): WeightClass {
  // Bound the match so a code like "AX2U9" cannot register as 2U.
  const match = text.toUpperCase().match(/(?:^|[^A-Z0-9])([2345])U(?:[^A-Z0-9]|$)/);
  if (match) return `${match[1]}U` as WeightClass;
  return "4U"; // the modern default across these catalogues
}

export function extractGripSize(text: string): GripSize {
  const match = text.toUpperCase().match(/(?:^|[^A-Z0-9])G([456])(?:[^A-Z0-9]|$)/);
  if (match) return `G${match[1]}` as GripSize;
  return "G5";
}

export function extractFlex(text: string): ShaftFlex {
  const lower = text.toLowerCase();
  if (/siêu cứng|extra[\s-]?stiff/.test(lower)) return "extra-stiff";
  if (/cứng|stiff/.test(lower)) return "stiff";
  if (/dẻo|flexible/.test(lower)) return "flexible";
  return "medium";
}

/** Max string tension, e.g. "30 lbs" / "căng tối đa 12kg". */
export function extractMaxTension(text: string): [number, number] | undefined {
  const lbs = text.match(/(\d{2})\s*lbs?/i);
  if (lbs) {
    const max = parseInt(lbs[1], 10);
    if (max >= 18 && max <= 40) return [Math.max(18, max - 6), max];
  }
  const kg = text.match(/(\d{1,2})\s*kg/i);
  if (kg) {
    const max = Math.round(parseInt(kg[1], 10) * 2.20462);
    if (max >= 18 && max <= 40) return [Math.max(18, max - 6), max];
  }
  return undefined;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Vietnamese marketing boilerplate that is not part of a model name. */
const TITLE_NOISE = [
  /^vợt\s+cầu\s+lông\s*/i,
  /^vot\s+cau\s+long\s*/i,
  /^vợt\s+/i,
  /\s*chính\s+hãng\s*/gi,
  /\s*chinh\s+hang\s*/gi,
  /\s*hàng\s+chính\s+hãng\s*/gi,
  /\s*(?:new\s+)?\d{4}\s*$/,
  /\s*\(.*?(?:tặng|khuyến mãi|quà).*?\)\s*/gi,
  /\s*(?:đã|da)\s+căng\s+(?:sẵn|san)\s+.*$/i,
  /\s*-\s*(?:miễn phí|tặng|freeship).*$/i,
];

/**
 * Reduce a listing title to a model name: drop the "Vợt cầu lông" prefix, the
 * brand, the shop's SKU tail after a pipe, and the "chính hãng" suffix.
 */
export function extractModelName(rawTitle: string, brandName: string, brandSlug: string): string {
  // fbshop appends "| <sku> <colour> <year>" — everything before the pipe is the name.
  let name = rawTitle.split("|")[0];

  for (const pattern of TITLE_NOISE) name = name.replace(pattern, " ");

  // Strip the brand wherever it appears, not only as a prefix.
  const brandPatterns = BRAND_ALIASES.filter(([, slug]) => slug === brandSlug).map(([p]) => p);
  if (brandPatterns.length === 0) brandPatterns.push(brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  for (const pattern of brandPatterns) {
    name = name.replace(new RegExp(`(?:^|\\s)${pattern}(?=\\s|$)`, "ig"), " ");
  }

  name = name.replace(/\s+/g, " ").replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, "").trim();

  return name || rawTitle.trim();
}

export function normalizeScrapedProduct(item: ScrapedProduct): NormalizedItem {
  const brand = detectBrand(item.rawTitle, item.brand, item.categorySlugs);
  const weightClass = item.specs?.weightClass || extractWeightClass(item.rawTitle);
  const gripSize = item.specs?.gripSize || extractGripSize(item.rawTitle);

  const listedName = item.modelName || extractModelName(item.rawTitle, brand.name, brand.slug);

  // The weight and grip are already captured as variant fields; leaving them in
  // the model name would split "Nitrix 80 Bullet 4U" from "Nitrix 80 Bullet".
  // The colour is a variant property too, for the same reason.
  const { base: modelName, colourway } = splitColourway(stripVariantTokens(listedName));

  // The slug is a catalogue key, so cap it — a malformed title must never turn
  // into a 900-character primary key the way it did before.
  const racketSlug = slugify(`${brand.slug} ${modelName}`).slice(0, 80).replace(/-+$/, "");

  // Colour is part of the variant's identity, not decoration on it: two colours
  // of the same 4U/G5 frame are two SKUs a shop stocks and prices separately.
  const colourSlug = colourway ? slugify(colourway).slice(0, 24).replace(/-+$/, "") : "";
  const variantId = [`v-${racketSlug}`, weightClass, gripSize, colourSlug]
    .filter(Boolean)
    .join("-")
    .toLowerCase();
  const sellerSlug = `s-${item.source}`;

  return {
    scraped: item,
    brandSlug: brand.slug,
    brandName: brand.name,
    racketSlug,
    racketName: modelName,
    variantId,
    weightClass,
    gripSize,
    colourway,
    price: item.price,
    msrp: item.msrp && item.msrp > item.price ? item.msrp : item.price,
    inStock: item.inStock,
    qtyAvailable: item.qtyAvailable ?? (item.inStock ? 5 : 0),
    sellerSlug,
    specs: {
      weightClass,
      gripSize,
      shaftFlex: item.specs?.shaftFlex || extractFlex(item.rawTitle),
      balancePointMm: item.specs?.balancePointMm,
      maxTensionLbs: item.specs?.maxTensionLbs || extractMaxTension(item.rawTitle),
    },
  };
}
