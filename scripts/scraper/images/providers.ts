/**
 * The manufacturer sites, and how to read each one.
 *
 * A provider is one official web property, and the unit the storage layout is
 * partitioned by. It is not the same thing as a brand: Mizuno has two here, a
 * Wix site covering the whole Asian line and a Malaysian Shopify store covering
 * what Malaysia stocks, and keeping them apart is what lets the storage tree
 * and the report say which photograph came from which.
 *
 * ------------------------------------------------------------------
 * Six ways to find products, tried richest-first
 *
 * A provider declares one `catalogue` source or several; several are merged by
 * URL, first source winning, so a product the storefront API named keeps that
 * name when a sitemap later rediscovers the same URL with nothing but a slug.
 *
 *   woocommerce-category-tree
 *                        apacs        recursive tier/family HTML catalogue
 *   woocommerce-store    apacs        hidden-but-live products omitted from cards
 *                        kumpoo-vn    name + full gallery from the Store API
 *   shopify-collection   mizuno       name + full gallery from products.json
 *                        mizuno-vn
 *                        yonex-uk
 *                        hundred-vn
 *   2beasy-category      victor       Victor's storefront API, 245 rackets / 2 requests
 *   category-pagination  yonex        the rendered "all racquets" listing, ?p=1…N
 *                        gosen-vn     a hand-built site with no API at all
 *                        meta-vn      a retailer: the only Kamito source, and
 *                                     the only Adidas one
 *   yonex-jp-api         yonex-jp     yonex.co.jp's own product JSON, keyed by model code
 *   sitemap              victor       the long tail of discontinued models
 *                        forza        a WordPress page sitemap; the site is not a shop
 *                        mizuno-asia  a Wix store sitemap, 273 pages in one request
 *
 * The shop APIs return the image list with the product, so for those providers
 * the crawl is finished by the time discovery is — there is no per-racket page
 * fetch afterwards at all.
 *
 * A category listing beats a sitemap wherever there is one. Yonex's sitemap
 * lists root-level marketing pages but not the racquet catalogue proper, and
 * mixes both with eight years of press releases; its category listing is the
 * manufacturer's own answer to "which of these are badminton racquets", and it
 * carries the product name beside each link, which the URL often does not
 * ("ARCSABER 7 TOUR" lives at /arc7-t). That change alone took Yonex from 25
 * matched rackets to 62.
 *
 * Search is never used: yonex.com disallows /catalogsearch/ and
 * victorsport.com disallows /search in robots.txt.
 *
 * ------------------------------------------------------------------
 * Yonex is three properties, and that is all there is
 *
 * yonex.com is the US Magento storefront and publishes 77 racquets — verified
 * exhaustive: its eight sub-categories (arcsaber 9, astrox 34, nanoflare 22,
 * muscle-power 4, isometric 3, b-series 2, junior 2, duora 1) sum to exactly
 * the 77 the parent category reports, so the paginated walk misses nothing.
 *
 * That is a current-season line, not a catalogue, so two more official Yonex
 * properties are registered behind it:
 *
 *   yonex-uk   www.yonex.co.uk, a Shopify storefront, 35 racquets. Mostly the
 *              same frames, but it is the only official site that publishes
 *              ASTROX 88D Pro/Tour and 88S Pro — Yonex's best-selling doubles
 *              family, and absent from the US line-up.
 *   yonex-jp   www.yonex.co.jp, whose product JSON lists the 50 racquets sold
 *              in Japan, keyed by model code rather than by name.
 *
 * They are declared *after* yonex.com because `index.ts` takes the first
 * provider that matches a racket and stops, and the US pages carry five-shot
 * galleries per colourway where the UK carries one to six and Japan exactly
 * one. Ordering them this way means the extra properties only ever fill gaps.
 *
 * Together the three cover ~75 of the 570 Yonex rackets in the catalogue. The
 * remainder are discontinued frames, Japan- and India-domestic models, and
 * retailer colourway rows; Yonex publishes no archive on any of its sites, so
 * there is no official source for them and no amount of crawling will find one.
 *
 * ------------------------------------------------------------------
 * Mizuno is three properties, and one of them hides its catalogue
 *
 * mizunobadminton-asia.com is the badminton-specialist site and the widest
 * of the three: a Wix store publishing 273 product pages, discontinued frames
 * included. It is declared first for that reason.
 *
 * It was being enumerated by rendering the 15 series pages linked from its
 * nav, which found 75 products — and every one of those 75 is in the store's
 * own store-products-sitemap.xml, which lists 273. The nav is front-of-house;
 * Wix builds the sitemap from the store. Reading the sitemap instead took
 * Mizuno from 48 matched rackets to 70 and removed 15 Chromium page loads per
 * run. Chromium is still needed for the gallery on a matched product page,
 * which is hydrated client-side, but no longer for discovery.
 *
 * What the sitemap does not carry is names, which is why the source sets
 * `titleFromHead`: the crawler reads each product page's og:title after the
 * walk, so the matcher sees the name the store prints rather than the slug its
 * CMS minted years earlier. Three of the 273 disagree with their own slug.
 *
 * Behind it sit two Shopify storefronts, which carry the deeper galleries —
 * five to ten shots against the Wix store's three — but only current stock:
 *
 *   mizuno     mys.mizuno.com, Malaysia. 49 rackets.
 *   mizuno-vn  vnm.mizuno.com, Vietnam, and where www.mizuno.com resolves to
 *              from here. 45 rackets, 26 of which Malaysia does not stock.
 *
 * jpn.mizuno.com was probed and rejected: its EC pages render client-side
 * with a generic title, carry no structured data, and name products in
 * Japanese, so there is nothing to match on that the other three do not
 * already give more cheaply.
 *
 * ------------------------------------------------------------------
 * On coverage
 *
 * Eleven brands are wired up, across fourteen providers: the four largest in the
 * catalogue by racket count, plus Hundred, Kumpoo and Gosen, whose Vietnamese
 * sites publish their whole racket line in two or three requests, and Forza,
 * whose own site is not a shop at all — it publishes the specification and the
 * photography and no price, and `scripts/scraper/forza-catalogue.ts` is what
 * turns that into catalogue rows for this provider to attach photographs to.
 *
 * And Kamito and Adidas, neither of which has a racket site — no Kamito domain
 * resolves, and Adidas badminton is a licensed line adidas.com does not carry —
 * which are the two brands here whose photographs come from a shop rather than
 * from their maker. See meta-vn below for why that was worth doing and is still
 * not a precedent.
 *
 * The rest are not oversights; each was probed against its live site with real
 * browser headers:
 *
 *   Fleet      fleet.com.my answers 503.
 *   Kawasaki   kawasaki-sports.com is the OEM sportswear-fabric business, not
 *              the badminton brand; its 183 products are textiles.
 *   Adidas     badminton is a licensed line with no catalogue site of its own.
 *              meta-vn reaches the three frames it stocks; the other 57 in
 *              the catalogue have no source at all.
 *   Flypower,  the sites are alive but publish neither a sitemap nor a product
 *   Ashaway,   API, so their catalogues cannot be enumerated without guessing
 *   Babolat    URLs.
 *   Li-Ning    li-ning.com is a corporate landing page linking out to Amazon
 *              and AliExpress; en.lining.com answers 403 to any non-browser
 *              client. But liningbadminton.vn — a brand-dedicated Vietnamese
 *              distributor on Haravan — does publish 106 rackets, and is
 *              verified but NOT YET REGISTERED here.
 *
 * Also verified and not yet registered: proacevn.vn (WooCommerce, 59) and
 * feletsports.com (SiteGiant, 62). Those two plus Li-Ning need the same
 * Vietnamese listing-title normalisation kumpoo-vn now does — see its
 * titleNoise, and the note there on which editorial is worth stripping and
 * which is a guess wearing a regex.
 *
 * Shipping an adapter that has never parsed a real page would be worse than an
 * honest gap, so the registry carries what works and the run names what it
 * skipped. Adding a brand whose site does cooperate is a config entry below,
 * not new code.
 */

import { splitColourway, stripVariantTokens } from "../colourway";

import type { GalleryExtractor } from "./gallery";
import {
  magentoGallery,
  nextDataGallery,
  shopifyGallery,
  wooCommerceGallery,
  metaVnGallery,
  structuredDataGallery,
  woocommerceHtmlGallery,
  wpUploadsGallery,
} from "./gallery";

export type ProviderPlatform =
  | "magento"
  | "next-data"
  | "shopify"
  | "woocommerce"
  | "structured-data"
  /** Gallery is only readable after hydration; read it through Chromium. */
  | "browser";

/** How a provider's product list is enumerated. */
interface CategoryPaginationConfig {
  /** Page one. */
  url: string;
  /** Query-string pagination, e.g. `?p=2`. */
  pageParam?: string;
  /** Pretty-permalink pagination, e.g. `page/{page}/`. */
  pagePath?: string;
  /** Anchor carrying the product link; its text is the product name. */
  linkSelector: string;
  /** Safety stop for a listing that never runs out of pages. */
  maxPages: number;
}

export type CatalogueSource =
  | {
      kind: "sitemap";
      sitemaps: string[];
      /**
       * Only URLs matching this are considered products. Manufacturer sites
       * serve press releases and landing pages from the same path space, and
       * while the token matcher rejects those on their slug, filtering first
       * keeps the candidate list small enough to print when a match fails.
       */
      productUrlPattern: RegExp;
      /**
       * Read each product page's own name from its `<head>` after the walk.
       *
       * A sitemap carries URLs and nothing else, so a sitemap-only provider
       * matches on the slug alone — and a slug is what the shop's CMS made of
       * the name once, years ago, not what the page says today. On
       * mizunobadminton-asia.com three pages disagree with their own slug:
       * `/product-page/untitled` is the Acrospeed 1 Focus, `/duralite` is the
       * Duralite 66, and `/swifter-sp75` is titled SWIFTER SP76. No amount of
       * slug matching reaches those, and guessing is exactly what the matcher
       * is built not to do.
       *
       * The titles are server-rendered, so this is one plain GET per product —
       * no browser — and the result is cached with the URLs, so it is paid once
       * per `--refresh-sitemaps`, not once per run.
       */
      titleFromHead?: {
        /** Dropped from the end of every title: " | MIZUNO BADMINTON". */
        suffixSeparator?: string;
      };
    }
  | {
      kind: "woocommerce-store";
      /**
       * Category slugs to enumerate; numeric ids are resolved at runtime. More
       * than one because a shop can split its rackets by tier rather than by
       * product type — Kumpoo files them under "chuyên nghiệp" (professional)
       * and "cho người mới" (beginner), and taking only one loses half.
       */
      categorySlugs: string[];
      pageSize: number;
      /**
       * Public category pages to use when a CI runner cannot reach the Store
       * API. Candidates discovered here are later read from product-page HTML.
       */
      htmlFallback?: CategoryPaginationConfig;
      /**
       * Drop products the shop currently has no stock of.
       *
       * Stock is a fact about a shop on a Tuesday, not about a racket, so this
       * is off by default: a discontinued frame's photography is still that
       * frame's photography, and the catalogue is a reference rather than a
       * storefront. It is switched on where the shop's out-of-stock listings
       * are the ones whose copy and photography have gone stale.
       */
      inStockOnly?: boolean;
    }
  | {
      /**
       * Recursively walk a WooCommerce category tree rendered as HTML.
       *
       * Some catalogues do not put products on the configured root page. The
       * root contains tiers, the tiers contain product families, and only the
       * family pages contain product cards. This source follows those category
       * cards until it reaches every product page, including listing pagination.
       */
      kind: "woocommerce-category-tree";
      /** Root category URL. Descendant category links must remain below it. */
      url: string;
      /** Safety stop for a cyclic or unexpectedly broad taxonomy. */
      maxPages: number;
      /** Maximum category pages fetched at once from this origin. */
      concurrency?: number;
    }
  | {
      kind: "shopify-collection";
      collections: string[];
      /** Keep only products whose `product_type` matches — collections leak. */
      productTypePattern?: RegExp;
      /** Haravan caps at 50 per page and ignores anything larger. */
      pageSize?: number;
    }
  | {
      kind: "sitegiant-collection";
      /** Collection handles, e.g. `racquet`. Sub-collections roll up into it. */
      collections: string[];
    }
  | {
      /**
       * Walk a rendered category listing page by page.
       *
       * This is what a shop's own "all racquets" page is, and on Yonex it is
       * strictly better than the sitemap: the sitemap does not distinguish a
       * racquet from a 2018 press release, while the category listing is the
       * manufacturer's own answer to "which of these are badminton racquets".
       *
       * It also carries the product *name* next to the link, which the URL
       * often does not — Yonex sells "ARCSABER 7 TOUR" at `/arc7-t` and
       * "NANOFLARE 700 GAME" at `/2nf-700g`. Matching on those slugs is
       * hopeless; matching on the titles is exact.
       */
      kind: "category-pagination";
    } & CategoryPaginationConfig
  | {
      /**
       * The storefront API behind victorsport.com (the "2beasy" platform).
       *
       * Victor's category page renders client-side, so the rendered HTML holds
       * no product links at all — the grid comes from a POST to this endpoint
       * with `{categoryId, skip, page, limit}`. Reading it directly is both far
       * cheaper than driving a browser and more precise than the sitemap: the
       * sitemap lists 4.529 product URLs of every kind, while this is the
       * shop's own "these are the rackets" list, with the display name and a
       * cover image attached.
       */
      kind: "2beasy-category";
      endpoint: string;
      categoryId: string;
      /** The API honours a much larger page than the site's own 18. */
      limit: number;
      /** Product pages live at `<origin>/product/<urlKey>`. */
      productPathPrefix: string;
    }
  | {
      /**
       * The product JSON behind yonex.co.jp's catalogue pages.
       *
       * Japan's site is the odd one out among Yonex's properties: it has no
       * per-product page at all — every card on the racquet listing links out
       * to the yonexshop.jp EC site — and it names its products in katakana
       * ("アークセイバー 11 プロ"), which no amount of tokenising will compare
       * equal to "Arcsaber 11 Pro".
       *
       * What it does carry is `code`, the model number Yonex prints on the
       * frame and on every retailer's listing: ARC11-P, 3AX88D-P, NF-400. That
       * is a better identifier than either name, and expanding it back into the
       * English model name is deterministic (see `expandYonexCode`).
       *
       * One shot per product, straight from `/upload/products/`, so a matched
       * racket costs no further request.
       */
      kind: "yonex-jp-api";
      /** Returns every product across every sport; filtered by the two below. */
      endpoint: string;
      /** `category_l`, the sport. Japanese, as the API stores it. */
      categoryL: string;
      /** `category_m`, the product type within the sport. */
      categoryM: string;
      /** Prefix for the `image` filename each row carries. */
      imageBase: string;
      /** The catalogue page the rows are published on, for `source_page_url`. */
      listingUrl: string;
    };

export interface ProviderConfig {
  /** Storage partition key and `racket_images.provider`. Keep it stable. */
  id: string;
  /** Human name, for the report. */
  name: string;
  origin: string;
  /** Brand slugs, as `normalizer.detectBrand` produces them, that this site covers. */
  brandSlugs: string[];
  platform: ProviderPlatform;
  /**
   * Where the product list comes from. An array runs every source and merges
   * them by URL — Victor needs both, because its storefront API knows the
   * current line precisely while only the sitemap remembers discontinued
   * models, and the catalogue holds plenty of the latter.
   */
  catalogue: CatalogueSource | CatalogueSource[];
  /**
   * Stripped from a product title before it is matched. Shop titles carry
   * merchandising the model name does not — Mizuno sells every frame as
   * "[MADE IN JAPAN] ACROSPEED 2 (UNSTRUNG)" — and those tokens would
   * otherwise read as part of the model and fail every comparison.
   */
  titleNoise?: RegExp[];
  /**
   * The listing name, after `titleNoise`, put back into the form the catalogue
   * holds the model in.
   *
   * A shop that publishes one page per colourway and one per weight grade
   * writes the model, the colour and the grade into a single string — "Wucht P8
   * Schock Solar Red 3U đỏ/đen" — and all three trail the model name, which is
   * the one position where the matcher forgives nothing but a SKU fragment.
   *
   * Spelling that out in regexes here would be a second, worse copy of the
   * colour vocabulary the retailer scrape already carries, so this hook exists
   * to reuse that one instead: `colourway.ts` strips only a *trailing* run of
   * known colour words and backs out the moment what remains stops naming a
   * model, which is what keeps "Wucht P6 Shock" from being eaten down to
   * "Wucht P6".
   *
   * It rewrites the shop's side of the comparison only. The catalogue name is
   * never touched — `modelAliases` is the hook for that, and it is deliberately
   * a separate one.
   *
   * The product url comes with it, because a shop that truncates its own product
   * names still has the whole of one in the permalink, and a transform that
   * repairs a name against that is reading evidence rather than guessing.
   */
  titleTransform?: (title: string, url: string) => string;
  /**
   * Listings this provider publishes that are not a page for any one racket.
   * A candidate whose title matches is dropped at discovery, before the matcher
   * ever sees it.
   *
   * This exists because `titleNoise` cannot express it. Noise is text to remove;
   * this is a listing to refuse, and removing the text is precisely what makes
   * it match. Kumpoo's Vietnamese shop sells three frames under one product —
   * "Power Control E55LS, E57LS, E58LS" — and the matcher forgives a trailing
   * SKU fragment, so `E57LS, E58LS` reads as this product's own code rather
   * than as two other rackets. It matched, and the photograph it matched to is
   * a group shot of all three frames side by side. That is the wrong racket's
   * photography under a racket's id, arriving through the one door the matcher
   * leaves open.
   *
   * Patterns are tested against the cleaned title, so `titleNoise` runs first.
   * Do not use the `g` flag: `RegExp.test` is stateful with it and would skip
   * every other candidate.
   */
  excludeTitle?: RegExp[];
  /**
   * Other spellings of a *catalogue* model name to try, and only after the
   * name as written has already failed to match anything.
   *
   * This is the mirror of `titleNoise`. That cleans up the shop's side of the
   * comparison; this one restates ours, for a manufacturer that prints one
   * name on the frame and publishes another on the web. It never overrides a
   * direct match, so a racket that already matches is unaffected, and each
   * alias goes through the same strict comparison as the original — an alias
   * is a second question, not a lower bar.
   */
  modelAliases?: (modelName: string) => string[];
  /**
   * This provider's own gallery readers, replacing the chain its platform
   * would otherwise get from EXTRACTORS.
   *
   * A platform is a shorthand for "reads like every other Magento shop", and
   * it stops being true the moment a site is not a shop at all. fz-forza.com
   * publishes no structured data of any kind, so every extractor in the table
   * returns nothing on it and no value of `platform` would have helped. Rather
   * than invent a platform for one site, the site brings its own reader.
   */
  extractors?: GalleryExtractor[];
  /** Extra gap between requests to this origin, on top of the global delay. */
  politenessMs?: number;
}

/**
 * The extractor chain per platform, used when discovery did not already attach
 * a gallery (sitemaps, category pages, or an API's HTML fallback). Each is tried
 * in order and the first that returns images wins, so a site that changes
 * template degrades to the generic schema.org reader instead of silently
 * returning nothing.
 */
export const EXTRACTORS: Record<ProviderPlatform, GalleryExtractor[]> = {
  magento: [magentoGallery, structuredDataGallery],
  "next-data": [nextDataGallery, structuredDataGallery],
  shopify: [shopifyGallery, structuredDataGallery],
  woocommerce: [wooCommerceGallery, woocommerceHtmlGallery, structuredDataGallery],
  "structured-data": [structuredDataGallery],
  // Never reached: a browser provider's gallery comes from `BrowserSession`,
  // not from parsing served HTML. Declared so the record stays total.
  browser: [],
};

/**
 * Victor prints a code on the frame and spells the name out on the web page.
 * The catalogue holds both forms, because the retailers it is built from do:
 * "TK 220H II" and "Thruster 220H II" are one racket, and only the second has
 * a page at victorsport.com.
 *
 * The expansion is the manufacturer's own convention, not a guess — ARS-100X
 * is printed on the Auraspeed 100X, BRS-12 on the Brave Sword 12 — and it is
 * only ever consulted for a racket whose name as written matched nothing.
 *
 * Thruster and Jetspeed get two readings each: Victor writes both "THRUSTER K
 * 520" and "THRUSTER 220H II", and which of the two a given frame uses is not
 * predictable from the code, so both are offered and the matcher picks.
 *
 * Five of the eight currently find something: TK, JS, ARS, DX and BRS, between
 * them 19 rackets. BS, HX and MX find nothing — not because the expansion is
 * wrong but because Victor no longer publishes a page for any Brave Sword,
 * Hypernano X or Meteor X the catalogue still lists. They are kept because they
 * are the same convention as the five, read off the same frames, and dropping
 * them would make the table look like a list of lucky guesses.
 */
const VICTOR_CODES: [code: RegExp, expansion: string[]][] = [
  [/^TK[\s-]/i, ["Thruster K ", "Thruster "]],
  [/^JS[\s-]/i, ["Jetspeed S ", "Jetspeed "]],
  [/^ARS[\s-]/i, ["Auraspeed "]],
  [/^DX[\s-]/i, ["DriveX "]],
  [/^BRS[\s-]/i, ["Brave Sword "]],
  [/^BS[\s-]/i, ["Brave Sword "]],
  [/^HX[\s-]/i, ["Hypernano X "]],
  [/^MX[\s-]/i, ["Meteor X "]],
];

function victorModelAliases(name: string): string[] {
  const out: string[] = [];
  for (const [code, expansions] of VICTOR_CODES) {
    if (!code.test(name)) continue;
    for (const full of expansions) out.push(name.replace(code, full));
  }
  return out;
}

/**
 * Gosen prints a model code with its letters and digits run together — GX800,
 * and the catalogue holds it that way because the retailers do.
 * gosensports.com spaces it: "Trivista GX 800". The tokeniser cannot reconcile
 * the two, since it collapses runs of single letters into an initialism but
 * never splits a token, and `gx800` is not the same token set as `gx` + `800`.
 *
 * So the alias splits the join, and only that: one to three letters followed by
 * two or more digits becomes the two halves with a space between. It is tried
 * only after the name as written has matched nothing and goes through the same
 * strict comparison, so it can neither displace a direct match nor lower the
 * bar for one.
 *
 * One racket currently needs it — Trivista GX800 — and it is kept for the same
 * reason Victor's unused code expansions are: it is the manufacturer's own way
 * of writing a model, not a guess fitted to one row.
 */
function gosenModelAliases(name: string): string[] {
  const split = name.replace(/\b([A-Za-z]{1,3})(\d{2,})\b/g, "$1 $2");
  return split === name ? [] : [split];
}

/**
 * A META.vn listing name, reduced to the frame it is a page for.
 *
 * The shop writes model, weight grade and colour into one string — "Adidas
 * WUCHT P8 SCHOCK SOLAR RED 3U đỏ/đen" is one frame, one grade and one colour
 * said twice — and the catalogue holds the frame alone, with the grade on the
 * variant where the schema puts it.
 *
 * The grade comes off first. It is a closed set and it sits *between* the model
 * and the colour here, so leaving it in place stops the colour walk dead at
 * "RED". What is left goes to the same splitter the retailer scrape runs on
 * these same Vietnamese titles, which reads a tail like "WHITE 4U Trắng/đen/cam"
 * in both languages and refuses to strip so far that what remains stops naming
 * a model.
 *
 * The url is consulted for one thing only. META.vn truncates its own product
 * names in its own database — the 3U Wucht P8 Olympic is stored, and served in
 * its title, its `<h1>`, its og:title and its schema.org block, as "… OLYMPIC
 * White 3" — and a bare trailing digit is not a grade the way "3U" is, so
 * `stripVariantTokens` correctly leaves it, and "White" then blocks the match.
 * The permalink is the one place the grade survives intact
 * (`…-olympic-white-3u-p81470`), so the digit is dropped only when the url
 * confirms what it is. That is reading the shop's own evidence; stripping any
 * trailing 2–5 would be a guess, and "Astrox 2" is a real racket.
 */
function metaVnTitle(title: string, url: string): string {
  const repaired = title.replace(/\s+([2345])$/, (whole, digit: string) =>
    new RegExp(`-${digit}u(?:-|$)`, "i").test(url) ? "" : whole,
  );
  return splitColourway(stripVariantTokens(repaired)).base;
}

/**
 * The catalogue's name for a racket, put through the same reduction as the
 * shop's, so the two sides of the comparison are asked the same question.
 *
 * The catalogue is built from Vietnamese retailers and inherits their habits:
 * one row for this frame is "Wucht P6 Shock Cyan New", where "New" is a shop's
 * "bản mới" and not something Adidas ever printed. META.vn sells it as "Wucht P6
 * Shock Cyan", which `titleTransform` reduces to "Wucht P6 Shock" — so the two
 * names disagree in both directions at once, and neither hook alone can close
 * it.
 *
 * So this drops a trailing "New" and then applies the identical reduction. It is
 * still an alias, with everything that means: tried only after the name as
 * written has matched nothing, put through the same strict prefix comparison,
 * and unable to displace a direct match. "Wucht P6" gets no alias at all — there
 * is nothing to drop — so the plain frame cannot be pulled onto a colourway's
 * page by this.
 */
function metaVnModelAliases(name: string): string[] {
  const aliases = new Set<string>();

  for (const form of [name, name.replace(/\s+new\s*$/i, "")]) {
    const reduced = splitColourway(stripVariantTokens(form)).base.trim();
    if (reduced && reduced !== name) aliases.add(reduced);
  }

  return [...aliases];
}

/** The retailer catalogue keeps this colour in the model name; ProKennex does not. */
function proKennexModelAliases(name: string): string[] {
  const withoutColour = name.replace(/\s*-\s*xám kim loại\s*$/i, "").trim();
  return withoutColour && withoutColour !== name ? [withoutColour] : [];
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "yonex",
    name: "Yonex",
    origin: "https://www.yonex.com",
    brandSlugs: ["yonex"],
    platform: "magento",
    // The sitemap was the wrong source and cost most of the catalogue. It lists
    // the root-level marketing pages (/astrox-77-pro) but not the racquet
    // catalogue proper (/badminton/racquets/ax100zz), and it mixes both with
    // eight years of press releases. The category listing is 7 pages of 12 and
    // is the manufacturer's own definition of what a badminton racquet is.
    catalogue: {
      kind: "category-pagination",
      url: "https://www.yonex.com/badminton/racquets",
      pageParam: "p",
      linkSelector: "a.product-item-link",
      maxPages: 30,
    },
    politenessMs: 250,
  },
  {
    // Yonex UK. Same brand, different property, and kept separate for the same
    // reason Mizuno's two are: they are two catalogues, and the report should
    // be able to say which of them a photograph came from.
    //
    // Only reached for a racket yonex.com does not sell, because it is declared
    // second and the matcher stops at the first provider that answers.
    id: "yonex-uk",
    name: "Yonex UK",
    origin: "https://www.yonex.co.uk",
    brandSlugs: ["yonex"],
    platform: "shopify",
    catalogue: {
      kind: "shopify-collection",
      // Four collections rather than one: the shop files a frame under its
      // tier as well as under "racquets", and `badminton-pro-racquets-1` holds
      // ASTROX 88D Pro and 88S Pro, which the plain racquets collection omits.
      collections: [
        "badminton-racquets",
        "badminton-pro-racquets-1",
        "beginner-badminton-racquets",
        "badminton",
      ],
      // The catch-all `badminton` collection is shuttlecocks, shoes and bags
      // as much as it is frames.
      productTypePattern: /racket|racquet/i,
    },
    // Yonex UK sells most frames pre-strung and says so in the title; "ARCSABER
    // 11 PLAY (STRUNG)" would otherwise carry a token the model name does not.
    titleNoise: [/\((?:un)?strung\)/gi, /\[[^\]]*\]/g],
    politenessMs: 250,
  },
  {
    id: "yonex-jp",
    name: "Yonex Japan",
    origin: "https://www.yonex.co.jp",
    brandSlugs: ["yonex"],
    // Never consulted: every candidate arrives with its image attached, so no
    // product page is ever opened. Declared because the field is not optional.
    platform: "structured-data",
    catalogue: {
      kind: "yonex-jp-api",
      endpoint: "https://www.yonex.co.jp/api/v1/1/product/list",
      categoryL: "バドミントン",
      categoryM: "ラケット",
      imageBase: "https://www.yonex.co.jp/upload/products/",
      listingUrl: "https://www.yonex.co.jp/badminton/products/?category_m=RACQUETS",
    },
    politenessMs: 250,
  },
  {
    id: "victor",
    name: "Victor",
    origin: "https://www.victorsport.com",
    brandSlugs: ["victor"],
    platform: "next-data",
    catalogue: [
      // The current line, named precisely, in two requests.
      {
        kind: "2beasy-category",
        endpoint:
          "https://api.2beasy.com.tw/api/store/productCategory/bykey/rackets-all-series/productList",
        categoryId: "rackets-all-series",
        limit: 200,
        productPathPrefix: "https://www.victorsport.com/product/",
      },
      // And the long tail. The API lists 245 rackets — what Victor sells now —
      // while the catalogue is full of frames discontinued years ago, and the
      // sitemap is the only place those still have a page.
      {
        kind: "sitemap",
        sitemaps: ["https://www.victorsport.com/sitemap.xml"],
        productUrlPattern: /^https:\/\/www\.victorsport\.com\/product\/[a-z0-9-]+$/i,
      },
    ],
    // "TK 220H II" and "ARS-50" are how the retailers write them; Victor's own
    // pages say "THRUSTER 220H II" and "AURASPEED 50".
    modelAliases: victorModelAliases,
    politenessMs: 250,
  },
  {
    id: "apacs",
    name: "Apacs",
    origin: "https://apacssports.com",
    brandSlugs: ["apacs"],
    platform: "woocommerce",
    // The root page contains nine playing-level categories, each of those
    // contains racket-family categories, and only the family pages contain
    // product cards. Follow the rendered taxonomy rather than assuming the
    // parent category behaves like a flat Store API collection.
    catalogue: [
      {
        kind: "woocommerce-category-tree",
        url: "https://apacssports.com/product-category/badminton/badminton-rackets/",
        maxPages: 300,
        concurrency: 3,
      },
      // Twelve older products still have live detail pages and remain assigned
      // to the racket taxonomy, but APACS hides them from the rendered cards.
      // The Store API closes that gap. HTML is first so visible products still
      // fetch their own full detail-page galleries; first source wins by URL.
      { kind: "woocommerce-store", categorySlugs: ["badminton-rackets"], pageSize: 100 },
    ],
    politenessMs: 300,
  },
  {
    id: "pro-kennex",
    name: "ProKennex",
    origin: "https://www.prokennex-badminton.com",
    brandSlugs: ["pro-kennex"],
    platform: "woocommerce",
    catalogue: {
      kind: "woocommerce-store",
      categorySlugs: ["badminton-rackets"],
      pageSize: 100,
      // GitHub-hosted runners can be blocked from WordPress JSON while the
      // public shop remains readable. These are the same 31 rackets, split
      // over the manufacturer's two rendered category pages.
      htmlFallback: {
        url: "https://www.prokennex-badminton.com/product_cat/badminton/badminton-rackets/",
        pagePath: "page/{page}/",
        linkSelector: ".products a.woocommerce-loop-product__link",
        maxPages: 2,
      },
    },
    modelAliases: proKennexModelAliases,
    politenessMs: 300,
  },
  {
    // Mizuno's Asian badminton site, kept separate from the Malaysian Shopify
    // store rather than merged into it. They are two properties with two
    // catalogues — the Shopify storefronts list what a country stocks today,
    // this lists the whole Asian line including frames long out of production
    // — and keeping them as separate
    // providers is what lets the storage layout and the report say which
    // photograph came from which.
    id: "mizuno-asia",
    name: "Mizuno Badminton Asia",
    origin: "https://www.mizunobadminton-asia.com",
    brandSlugs: ["mizuno"],
    platform: "browser",
    // The 15 series pages this used to render were not the catalogue. They are
    // a curated front-of-house — 75 of the 273 products the store publishes —
    // and every one of the 75 is in the sitemap as well, so rendering them cost
    // 15 Chromium page loads to see a strict subset. Wix generates
    // `store-products-sitemap.xml` from the store itself, which is why it still
    // carries the discontinued frames (Altair T327, JPX 8 Power, Citius 71) that
    // no series page links to any more.
    //
    // Chromium is still required to read a matched product page, because the
    // gallery is hydrated client-side. Discovery no longer needs it at all.
    catalogue: {
      kind: "sitemap",
      // The index at /sitemap.xml, which robots.txt names and the store, blog
      // and pages sitemaps hang off. `productUrlPattern` keeps the store half;
      // the rest of the store is shoes, bags, grips and technology explainers.
      sitemaps: ["https://www.mizunobadminton-asia.com/sitemap.xml"],
      productUrlPattern: /^https:\/\/www\.mizunobadminton-asia\.com\/product-page\/[^/?#]+$/i,
      // Wix titles every product page "<NAME> | MIZUNO BADMINTON".
      titleFromHead: { suffixSeparator: "|" },
    },
    politenessMs: 500,
  },
  {
    id: "mizuno",
    name: "Mizuno",
    // mizuno.com is a region selector; the Malaysian storefront is the one that
    // runs Shopify and actually stocks the badminton line.
    origin: "https://mys.mizuno.com",
    brandSlugs: ["mizuno"],
    platform: "shopify",
    catalogue: {
      kind: "shopify-collection",
      collections: [
        "badminton-rackets",
        "mens-badminton-rackets",
        "womens-badminton-rackets",
        // The sport-wide collection. Mostly a superset of the three above,
        // but it is the only one filing JPX Reserve Edition MB.
        "badminton",
      ],
      // The men's and women's collections include grips, jackets and shoes.
      productTypePattern: /racket|racquet/i,
    },
    titleNoise: [
      /\((?:un)?strung\)/gi,
      /\[[^\]]*\]/g, // [MADE IN JAPAN], [CONTROL], …
    ],
    politenessMs: 300,
  },
  {
    // Mizuno Vietnam. www.mizuno.com is a region selector and resolves here from
    // Vietnam, which is also the market this catalogue is for, so it is the
    // Mizuno storefront most likely to be showing the frame a seller is listing.
    //
    // Declared after Malaysia because Malaysia's galleries are the deeper of the
    // two (5.6 shots per racket against 3.5), but it reaches 26 rackets Malaysia
    // does not stock at all — Acrospeed 0, Acroforce 100, Altius N-Feel, the
    // Carbo Pro 835/837/839 run and Turboblade 587.
    //
    // Its titles are already clean: no "[MADE IN JAPAN]" prefix, and "(Unstrung)"
    // is the only noise, which the shared pattern below strips.
    id: "mizuno-vn",
    name: "Mizuno Vietnam",
    origin: "https://vnm.mizuno.com",
    brandSlugs: ["mizuno"],
    platform: "shopify",
    catalogue: {
      kind: "shopify-collection",
      // `badminton` is the sport-wide collection and carries shoes and string as
      // well; `all-rackets` is every racket sport. Both are filtered on
      // product_type, and between them they miss nothing either lists alone.
      collections: ["badminton", "all-rackets"],
      productTypePattern: /racket|racquet/i,
    },
    titleNoise: [/((?:un)?strung)/gi, /[[^]]*]/g],
    politenessMs: 300,
  },
  {
    // Hundred's Vietnamese storefront, and the only Hundred property with a
    // machine-readable catalogue. hndrd.co is the brand's own domain — this is
    // a manufacturer site, not a distributor's — and vn.hndrd.co is the Shopify
    // build of it that serves Vietnam, which is also this catalogue's market.
    // The Indian parent site publishes no product API and no store sitemap.
    //
    // One collection, one request: `badminton-racket` holds all 48 rackets the
    // shop sells, and `products.json?limit=250` returns every one of them with
    // its gallery attached, so no product page is ever opened. The site's own
    // theme paginates that collection at 24 — `?page=2` is the second half of
    // the same list — and that is the theme's page size, not the shop's; the
    // product API ignores it.
    //
    // 26 of the catalogue's 33 Hundred rackets match. Of the seven that do not,
    // five are frames Vietnam does not stock (Nitrix 80 Bullet and its New
    // edition, Nitrix 10, Shark 82, Nano Neo) and two carry retailer editorial
    // the manufacturer has no reason to repeat: "Flareon 700 – Siêu phẩm phản
    // tạt" and "Nitrix Attack – Srikanth". An alias would force both through
    // and would be wrong to: the Srikanth is a signature colourway this shop
    // does not publish, so the alias would file the standard Nitrix Attack's
    // photographs under it. They are reported as gaps instead.
    id: "hundred-vn",
    name: "Hundred Vietnam",
    origin: "https://vn.hndrd.co",
    brandSlugs: ["hundred"],
    platform: "shopify",
    catalogue: {
      kind: "shopify-collection",
      collections: ["badminton-racket"],
      // Every product in it is `Badminton Racket` today. The filter is what
      // keeps that true the day the shop files a bag or a grip in there.
      productTypePattern: /racket|racquet/i,
    },
    // Every title is "Vợt cầu lông <model>", most with the weight grade after
    // it: "Vợt cầu lông Nitrix 70 Volta - 3U".
    //
    // The prefix is stripped and the grade deliberately is not. A grade is a
    // variant rather than a model, so stripping it looks like the right thing
    // — but the shop sells most frames as two products, one per grade, and
    // with the grade gone the two titles read exactly alike. Measured against
    // the live collection that trades one racket for nothing: "Hyfonic 7"
    // starts matching `hyfonic-7` and `hyfonic-7-4u` equally well and is
    // refused as ambiguous, while the sibling pages it would have won carry
    // the *same photographs* — `nitrix-70-volta` and `-3u` share all nine
    // files, as do `flareon-700`/`-3u` and `hyfonic-7`/`-4u`. Left in place,
    // the grade reads as the SKU fragment it looks like: the ungraded page
    // wins outright where the shop publishes one, and where every page carries
    // a grade (`battle-900-3u`, `-4u`) they group as siblings and are merged.
    //
    // Stripping the prefix changes no match today — these slugs are clean, and
    // the slug is what all 26 matches are made on. It is what keeps the title
    // usable as the second key the matcher tries, for the day an editor gives
    // a frame a permalink that is not its name.
    titleNoise: [/^\s*v[ơợ]t\s+c[aâầ]u\s+l[oôộ]ng\s*/i, /\s*chính\s+hãng\s*/gi],
    politenessMs: 300,
  },
  {
    // Kumpoo's Vietnamese distributor, and the only place Kumpoo's own product
    // photography is published at all: kumpoo.com does not resolve, and the
    // brand has no other site that answers. It is a distributor rather than a
    // manufacturer property — the first in this registry — which is why it is
    // named for the country and not for the brand.
    //
    // Two categories, because the shop files rackets by tier rather than by
    // product type: `vot-cau-long-chuyen-nghiep` (professional, 22) and
    // `vot-cho-nguoi-moi` (beginner, 21). Taking one loses half. They overlap
    // by nine, which the permalink key in `discoverWooCommerce` collapses, so
    // the two categories are 34 distinct rackets in three requests, galleries
    // attached — 19 once the stock filter below has had its say. The images are
    // the WordPress uploads themselves: the `-scaled` 2560px original where the
    // shop has one, not a theme thumbnail.
    //
    // 9 rackets match, and the shape of the gap is worth knowing: the shop
    // sells named editions (Houyi II, Nimbus, Kevlamor 3, Lectra Like) while
    // this catalogue's 133 Kumpoo rows come from Vietnamese retailer listings
    // and are overwhelmingly the OEM codes — 60 of them are "Power Control
    // E##L/LS/S". The two namespaces barely intersect, and no amount of title
    // cleaning bridges them. What is left after the misses is 23 products this
    // catalogue does not hold under any name.
    id: "kumpoo-vn",
    name: "Kumpoo Vietnam",
    origin: "https://kumpoovietnam.com",
    brandSlugs: ["kumpoo"],
    platform: "woocommerce",
    catalogue: {
      kind: "woocommerce-store",
      categorySlugs: ["vot-cau-long-chuyen-nghiep", "vot-cho-nguoi-moi"],
      pageSize: 100,
      // 13 of the 34 listings are out of stock, and on this shop that is the
      // shelf the stale copy sits on: the Tết editions from two zodiac years
      // ago, the B-grade K520 Pro, the frames whose page has not been touched
      // since. Of the rackets that matched, it costs exactly one — Pines.
      inStockOnly: true,
    },
    // The first provider whose titles are written for Vietnamese shoppers
    // rather than for a catalogue, and the reason this shop was verified but
    // left unregistered until now. Every title is retail copy — "Vợt cầu lông
    // Kumpoo AK7 II chính hãng" — and the permalink is the same copy slugified,
    // so `vot`, `cau`, `long`, `chinh` and `hang` sit exactly where the matcher
    // expects the model to start. Nothing matched on the slug here, and nothing
    // will; all 11 matches are made on the cleaned title.
    //
    // What comes off is the shop's furniture and only that: the phrase "vợt cầu
    // lông" wherever it appears (one title leads with the brand instead —
    // "Kumpoo vợt cầu lông K01 Lâm Nhất"), "chính hãng" (genuine) and "cao cấp"
    // (premium). The marketing clause a title trails after a comma is left
    // alone: "…, linh vật Ngựa Lửa phiên bản giới hạn 2026" is not a model name,
    // so it fails the comparison by itself and needs no rule.
    //
    // What deliberately does not come off is the per-product editorial: the
    // Vietnamese gloss on a model name ("Nebula Tinh Vân", "Tiger Wings hổ
    // trắng"), the player a frame is named for ("K01 Lâm Nhất"), "bản mới" (new
    // version) and "giá rẻ" (cheap). Each would win at most one racket, and the
    // last two would cost more than they win: "K520 Pro bản mới" and "LỖI NHẸ …
    // K520 Pro giá rẻ" — a B-grade unit — both collapse onto the plain "K520
    // Pro" that already matches cleanly, and the collision would be reported as
    // ambiguous and refused, losing a racket that is currently matched. A rule
    // that reads one listing's copy is a guess wearing a regex.
    titleNoise: [
      /\s*v[ơợ]t\s+c[aâầ]u\s+l[oôộ]ng\s*/gi,
      /\s*chính\s+hãng\s*/gi,
      /\s*cao\s+cấp\s*/gi,
    ],
    // A comma followed by another SKU code: "Power Control E55LS, E57LS, E58LS",
    // "520AS, 520BS, CA-06". That is one listing for several frames, and its
    // photography is a group shot of all of them — verified by eye on the first
    // of those, which had matched and taken a picture of three rackets side by
    // side as the E55LS's hero. A comma followed by Vietnamese prose is a
    // marketing clause and stays.
    excludeTitle: [/,\s*[A-Za-z]*\d[A-Za-z0-9-]*\b/],
    politenessMs: 400,
  },
  {
    // Gosen's Vietnamese property. gosen.jp publishes the Japanese line behind a
    // catalogue that names nothing in Latin script, and gosensports.com is the
    // only Gosen site that lists rackets by the names this catalogue holds.
    //
    // It is also the first provider that is neither a shop platform nor a
    // sitemap: a hand-built Laravel site whose racket listing is two rendered
    // pages of twelve, `?page=N`, with no product API behind it and no sitemap
    // to read. That is exactly what `category-pagination` is for, and the walk
    // is three requests — page 1, page 2, and page 3 to learn there isn't one.
    //
    // What it gives back is one photograph per racket, not a gallery. The
    // product page carries a schema.org `Product` block whose `image` array
    // holds a single studio shot; everything else under `/upload/` on that page
    // is the header logo or a related-product card. One shot at 1.3–1.6 MB is
    // still the difference between a spec page and a 300×300 retailer thumbnail,
    // so it is worth the per-racket page fetch — but this provider will never
    // fill a carousel, and `--max-images` is not what limits it.
    //
    // The page's own og:image is malformed — `https://gosensports.comupload/…`,
    // missing the slash — which does not matter only because the structured-data
    // extractor reads the ld+json first and falls back to og:image only when it
    // finds nothing.
    id: "gosen-vn",
    name: "Gosen Vietnam",
    origin: "https://gosensports.com",
    brandSlugs: ["gosen"],
    platform: "structured-data",
    catalogue: {
      kind: "category-pagination",
      url: "https://gosensports.com/vot-cau-long",
      pageParam: "page",
      // Every card is one of these anchors, wrapping the thumbnail and the name.
      linkSelector: "a.product-item",
      maxPages: 10,
    },
    // Same Vietnamese retail copy as kumpoo-vn, and the same consequence: the
    // permalink is the title slugified, so `vot`, `cau` and `long` sit where the
    // matcher expects the model to start and nothing matches on the slug.
    //
    // The site also prints its card titles through a broken uppercase transform
    // — "VợT CầU LôNG GOSEN INFERNO TOUCH", ASCII raised and the Vietnamese
    // letters left alone. It costs nothing here: the pattern is case-insensitive
    // and `slugify` lowercases everything before a comparison is ever made.
    titleNoise: [/\s*v[ơợ]t\s+c[aâầ]u\s+l[oôộ]ng\s*/gi],
    // "Trivista GX800" here, "Trivista GX 800" on the site.
    modelAliases: gosenModelAliases,
    politenessMs: 400,
  },
  {
    // FZ Forza's own site, and the first provider here that is not a shop.
    // fz-forza.com sells nothing: it is the brand's marketing site, publishing
    // the current 29 rackets with the specification FZ prints on the frame and
    // no price anywhere. `scripts/scraper/forza-catalogue.ts` reads the specs
    // and writes the catalogue rows; this reads the photographs.
    //
    // Three shots per racket — a front, and two detail angles — at the size
    // they were uploaded, which is 1080×1560 or larger.
    id: "forza",
    name: "FZ Forza",
    origin: "https://fz-forza.com",
    brandSlugs: ["forza"],
    // Never consulted: `extractors` below replaces the platform chain, because
    // there is no structured data on this site for any of them to read.
    platform: "structured-data",
    catalogue: {
      kind: "sitemap",
      // The racket pages are WordPress pages, so they are in the page sitemap
      // rather than a product one — there is no product post type here at all.
      sitemaps: ["https://fz-forza.com/page-sitemap.xml"],
      // One segment below /badminton/rackets/, which excludes the listing itself.
      productUrlPattern: /^https:\/\/fz-forza\.com\/badminton\/rackets\/[^/]+\/$/i,
      // A sitemap carries no names, and these slugs are the page titles
      // slugified, so reading the titles is what makes the year-suffixed urls
      // (`ht-power-36-masters-2026`) match the names the catalogue holds.
      // It also reaches 20 archived pages the current listing no longer links,
      // which is where HT Power 30-V2 still has its photography.
      titleFromHead: {},
    },
    // "K-Power 36 M - FZ FORZA", and the model name has hyphens of its own, so
    // the site suffix comes off as a whole rather than by splitting on "-".
    //
    // The trailing year on five of these stays: FZ keeps last season's page up
    // beside this one, so there is both a 2025 and a 2026 HT Power 36 MasterS,
    // and the year is the only thing that tells the two pages apart. The
    // catalogue rows carry it for the same reason.
    titleNoise: [/\s*[-–]\s*FZ FORZA\s*$/i],
    // The photographs are the uploads named after the item number the page
    // prints ("Item no. FZ262671"). Everything else under /wp-content/uploads/
    // there is the logo or a technology badge.
    extractors: [wpUploadsGallery(/^FZ\d+_/i)],
    // Simply.com fronts this site with a firewall that answers a burst with a
    // browser challenge rather than a page, and a challenged racket page reads
    // as a racket with no photographs. Twice the usual gap is cheap here: the
    // whole provider is 29 pages.
    politenessMs: 800,
  },
  {
    // META.vn, and the first retailer in this registry.
    //
    // Everything else here is a manufacturer property, because the point of the
    // module is to stop depending on shop photography — a shop re-shoots what it
    // sells, and the same frame looks different on every listing. Kamito is the
    // case that argues the other way: it has no site. No official domain
    // resolves, so there is no manufacturer photography to prefer, and the
    // choice is between a retailer's studio artwork and nothing.
    //
    // What makes it worth taking is that meta.vn is not re-shooting: its images
    // are the brand's own product renders on white, at 1200×900, against the
    // 300×300 crop the retailer scrape gives. `racket_images.provider` records
    // `meta-vn` on every row, so a photograph from a shop is never mistaken for
    // one from a manufacturer.
    //
    // Adidas is here for the second half of the same argument: badminton is a
    // licensed line, adidas.com sells shoes and shirts and has no racket
    // catalogue, so there is again no manufacturer page to prefer. It is a much
    // thinner shelf — five listings against Kamito's twelve, and those five are
    // two frames in two weight grades each plus one more — but three rackets
    // photographed beats sixty with nothing.
    //
    // 11 of the catalogue's 20 Kamito rackets match, three shots each, and 3 of
    // its 60 Adidas, from all five of the listings.
    id: "meta-vn",
    name: "META.vn",
    origin: "https://meta.vn",
    brandSlugs: ["kamito", "adidas"],
    // Never consulted: the schema.org block on a product page carries only the
    // hero, so `extractors` below reads the gallery instead.
    platform: "structured-data",
    // The badminton category twice, filtered to one brand each. robots.txt has
    // its filtered-page rules commented out, so the query string is fair game.
    //
    // The card's name anchor is the link with the product name as its text; the
    // thumbnail above it is a second anchor to the same url with no text.
    //
    // One page each, and only one: both listings' own ItemList reports the whole
    // count (12 and 5), and the walker builds page two by appending `?page=2`
    // to a url that already carries a query string, which this shop would read
    // as neither.
    catalogue: [
      {
        kind: "category-pagination",
        url: "https://meta.vn/vot-cau-long-c524?brands=1851",
        pageParam: "page",
        linkSelector: ".prod-hl-name a",
        maxPages: 1,
      },
      {
        kind: "category-pagination",
        url: "https://meta.vn/vot-cau-long-c524?brands=264",
        pageParam: "page",
        linkSelector: ".prod-hl-name a",
        maxPages: 1,
      },
    ],
    // Vietnamese retail copy again — "Vợt cầu lông Kamito Galaxy Play" — with
    // one addition the other two shops did not need: `nữ` (women's), which sits
    // between the category and the brand in "Vợt cầu lông nữ Kamito VTT Gowo".
    // It is matched on the spaces around it rather than with a word boundary:
    // JavaScript defines `\b` on [A-Za-z0-9_], so it finds no boundary at all
    // after a letter like ữ, and the rule silently did nothing — which cost
    // exactly the one racket it was written for.
    // The permalink is that same copy slugified with the product id stuck on
    // the end (`-p112325`), so nothing matches on the slug here either.
    titleNoise: [/\s*v[ơợ]t\s+c[aâầ]u\s+l[oôộ]ng\s*/gi, /\s+n[ưữ]\s+/gi],
    // The rest of the listing name is the variant, and the two hooks below are
    // the same reduction applied to each side of the comparison. Between them
    // every one of the five Adidas listings lands on the frame it is a page for:
    // the two Wucht P8 Schock Solar pages and the two Wucht P8 Olympic pages
    // merge into their two rackets, and the Wucht P6 finds the row the catalogue
    // calls "Wucht P6 Shock Cyan New".
    titleTransform: metaVnTitle,
    modelAliases: metaVnModelAliases,
    extractors: [metaVnGallery],
    politenessMs: 500,
  },
];



export function providersForBrand(brandSlug: string): ProviderConfig[] {
  return PROVIDERS.filter((provider) => provider.brandSlugs.includes(brandSlug));
}

export function providerById(id: string): ProviderConfig | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** Brand slugs no provider covers, so the report can name the gap. */
export function uncoveredBrands(brandSlugs: Iterable<string>): string[] {
  const covered = new Set(PROVIDERS.flatMap((provider) => provider.brandSlugs));
  return [...new Set([...brandSlugs].filter((slug) => !covered.has(slug)))].sort();
}
