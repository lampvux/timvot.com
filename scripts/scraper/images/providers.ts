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
 *                        lining-vn    Haravan speaks it too; 98 rackets / 2 requests
 *   2beasy-category      victor       Victor's storefront API, 245 rackets / 2 requests
 *   category-pagination  yonex        the rendered "all racquets" listing, ?p=1…N
 *                        gosen-vn     a hand-built site with no API at all
 *                        fleet-vn     another, paginated `…/89/page=2`
 *                        meta-vn      a retailer: the only Kamito source, and
 *                                     the only Adidas one
 *                        felet        a SiteGiant store whose grid is rendered
 *                                     even though its product record is not
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
 * Thirteen brands are wired up, across sixteen providers: the four largest in
 * the catalogue by racket count, plus Hundred, Kumpoo and Gosen, whose Vietnamese
 * sites publish their whole racket line in two or three requests, Felet, whose
 * Malaysian store publishes its current line in three, and Forza, whose own
 * site is not a shop at all — it publishes the specification and the
 * photography and no price, and `scripts/scraper/forza-catalogue.ts` is what
 * turns that into catalogue rows for this provider to attach photographs to.
 *
 * And Li-Ning and Fleet, the two dead ends here that a distributor closed.
 * Li-Ning was the biggest gap in the catalogue — 340 rackets, no photograph on
 * any of them — and liningbadminton.vn publishes 98 of the current line through
 * the Haravan product API, gallery included, in two requests.
 *
 * As for Fleet: fleet.com.my answers 503 to everything, while fleet.vn —
 * Fleet Việt Nam, the brand's own Vietnamese property — publishes 120 rackets
 * over 8 listing pages, with a specification table `fleet-catalogue.ts` reads
 * the same way `forza-catalogue.ts` reads FZ's.
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
 *   Kawasaki   kawasaki-sports.com is the OEM sportswear-fabric business, not
 *              the badminton brand; its 183 products are textiles.
 *   Adidas     badminton is a licensed line with no catalogue site of its own.
 *              meta-vn reaches the three frames it stocks; the other 57 in
 *              the catalogue have no source at all.
 *   Flypower,  the sites are alive but publish neither a sitemap nor a product
 *   Ashaway,   API, so their catalogues cannot be enumerated without guessing
 *   Babolat    URLs.
 *
 * Also verified and not yet registered: proacevn.vn (WooCommerce, 59). It needs
 * the same Vietnamese listing-title normalisation kumpoo-vn and lining-vn now
 * do — see their titleNoise, and the note there on which editorial is worth
 * stripping and which is a guess wearing a regex.
 *
 * feletsports.com and liningbadminton.vn were both on that list and are now
 * registered; see the `felet` and `lining-vn` entries below for what each
 * publishes. Li-Ning was the largest gap in the catalogue by some way — 340
 * rackets with no source at all — and li-ning.com is still no help: it is a
 * corporate landing page linking out to Amazon and AliExpress, and en.lining.com
 * answers 403 to any non-browser client. The Vietnamese distributor is the
 * brand's only property that publishes a catalogue.
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
  sitegiantGallery,
  fleetVnGallery,
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
  /**
   * The slug to match on, when it is not the url's last path segment.
   *
   * `slugOfUrl` takes the last segment because that is the product key on every
   * shop platform here. fleet.vn is not one: it addresses products as
   * `/chi-tiet-san-pham/<slug>/<id>` and the segment that ends the url is the
   * numeric id, so the default reads "220" as the identity of a racket. That is
   * both useless in the report and quietly dangerous — a catalogue row whose
   * model name is a bare number would match a product it has nothing to do
   * with.
   *
   * What comes back is the racket rather than merely a different segment: see
   * `fleetVnSlug`, which takes the segment before the id and then removes the
   * category and brand copy the site slugifies into it.
   */
  slugFromUrl?: (url: string) => string;
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

/**
 * A liningbadminton.vn listing name, reduced to the frame it is a page for.
 *
 * The shop writes the category, the brand, the series, the model, the weight
 * grade, the colour and the SKU into one string — "Vợt cầu lông Li-Ning
 * Fengying BLADEX SPIRAL Pink (4U) AYPT365-4 (Khung vợt)" — and the catalogue
 * holds the frame alone, as "Bladex Spiral". `titleNoise` takes off what is the
 * same on every listing; what is left is this.
 *
 * Two of the shop's own misspellings are repaired rather than worked around,
 * because each is consistent enough to name: the Turbo Charging line is written
 * "TURBOCHAGING" on one listing, and "Blue" is "Bule" on two. Repairing them is
 * reading the shop's own evidence — the SKU and the rest of the title agree on
 * which frame it is — where leaving them costs three pages for nothing.
 *
 * The third repair is not a typo but an inconsistency about Li-Ning's own
 * naming. Thunder and Axforce are one line, and this shop uses both words,
 * sometimes in the same title: "Axforce Thunder Cannon", "Thunder Axforce JR",
 * "Thunder BIGBANG NEW" and "Axforce BIGBANG NEW" are four listings of two
 * frames. `bestMatch` merges colourway pages only where their cleaned titles
 * agree, so left alone the BigBang New reads as two rackets and three of its
 * four pages go unclaimed. Settling on the spelling the catalogue uses merges
 * them, and it rewrites the shop's side of the comparison only.
 *
 * What remains goes to the same colour splitter the retailer scrape runs on
 * these same Vietnamese titles, which backs out the moment what it has left
 * stops naming a model — so "Bladex Assassin White/Black" reduces to the frame
 * while a model actually called a colour would keep its name.
 */
function liningVnTitle(title: string): string {
  const repaired = title
    .replace(/\bturbochaging\b/gi, "Turbo Charging")
    .replace(/\bbule\b/gi, "Blue")
    .replace(/\bthunder\s+axforce\b/gi, "Axforce")
    .replace(/\baxforce\s+thunder\b/gi, "Axforce")
    .replace(/\bthunder\b/gi, "Axforce");

  return splitColourway(stripVariantTokens(repaired)).base;
}

/**
 * The catalogue's name for a Li-Ning racket, in the other spellings the brand
 * and its retailers use.
 *
 * The catalogue's 340 Li-Ning rows came from Vietnamese retailers over a decade
 * and they disagree with this shop about three things, in both directions.
 * Li-Ning's series names are optional to a retailer — the shop says "Fengying
 * Bladex 900" and the catalogue holds both that and a bare "Bladex 900"; the
 * Windstorm line is sold here as "Storm"; and a family name run onto its model
 * number ("Blackiron", "Turbocharging N9") is spaced on the shop's side.
 *
 * Every one is an alias like the rest: offered only after the name as written
 * has matched nothing, put through the same strict comparison, and unable to
 * displace a direct match.
 */
function liningVnModelAliases(name: string): string[] {
  const out = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) out.add(trimmed);
  };

  add(name.replace(/^\s*axforce\s+/i, ""));
  add(name.replace(/^\s*fengying\s+/i, ""));
  add(name.replace(/^\s*thunder\s+/i, ""));
  add(name.replace(/^\s*windstorm\b/i, "Storm"));
  add(name.replace(/^\s*storm\b/i, "Windstorm"));
  add(name.replace(/\bturbocharging\b/gi, "Turbo Charging"));
  add(name.replace(/\bblackiron\b/gi, "Black-Iron"));

  // The same reduction the shop's side gets, so a catalogue row carrying a
  // colourway of its own is asked the question its page can answer.
  for (const form of [...out, name]) add(splitColourway(stripVariantTokens(form)).base);

  return [...out];
}

/**
 * The racket, out of a fleet.vn permalink.
 *
 * The site addresses a product as `/chi-tiet-san-pham/<slug>/<id>`, and that
 * slug is the whole listing title slugified — category copy, brand and all:
 * `/chi-tiet-san-pham/vot-cau-long-fleet-triotec-t6/220`. Neither half of the
 * url identifies the racket on its own. The id is a bare number, and the slug
 * as written is not something the matcher can be made to read: `filterFurniture`
 * drops a brand only when its whole name sits at one edge of the token run, and
 * here `fleet` sits fourth, behind three tokens of "vợt cầu lông" that no
 * furniture list holds. So the racket is cut out here instead.
 *
 * The category comes off first, in both spellings the shop uses interchangeably
 * (`vot-cau-long-` and the abbreviated `vot-cl-`), and then the brand — leaving
 * `triotec-t6`, which is exactly what `titleNoise` leaves of the title beside
 * it, so both sides of the comparison are asked the same question.
 *
 * Both strips are anchored at the front, and the brand is only ever taken where
 * the category already was. That is what keeps this from being a search and
 * replace: `vot-cl-magic-fx100` carries no brand and keeps every token it has,
 * and a model the catalogue happened to call "Fleet something" would keep its
 * own name.
 *
 * It also merges the two permalinks this shop publishes one racket under.
 * Guardian is listed as both `vot-cau-long-fleet-guardian` and
 * `vot-cl-guardian`, and `bestMatch` groups candidates by `productKey(slug)`:
 * with the prefixes left on, those read as two different rackets called
 * Guardian and the match is refused as ambiguous. Reduced, they are one product
 * with two pages, which is what they are.
 *
 * All 120 listings the category walk finds are prefixed this way, and
 * `guardian` is the only slug two of them reduce to.
 */
function fleetVnSlug(url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-2) ?? "";
  return slug.replace(/^vot-(?:cau-long|cl)-/i, "").replace(/^fleet-/i, "");
}

/**
 * Put back the `2000` the retailer scrape's year rule took off a Fleet model.
 *
 * `normalizer.ts` strips a trailing four-digit number from a listing title,
 * because on a Vietnamese shop that number is nearly always the season — "Vợt
 * cầu lông Yonex Astrox 88D Pro 2024". Fleet is the brand where it is not: it
 * names a whole family after one, and eleven catalogue rows arrived here with
 * the number gone. "Speed FT", "Power FT", "Drive FT", "Tour FT", "Team FT",
 * "Hyper FT", "Force FT", "Pulse FT" and "sword FT" are all the frame fleet.vn
 * publishes as Speed FT2000, Power FT2000 and so on; "FT-Elite" is FT-Elite-2000
 * and "AHANKEN Long Sword" is AHANKEN Long Sword 2000.
 *
 * So every name is offered again with a 2000 restored, in both spellings the
 * site uses — joined ("Speed FT2000", nine pages) and spaced ("Pulse FT 2000",
 * "AHANKEN Long Sword 2000"). Offering it for every name rather than only for
 * the ones ending in `FT` costs nothing and is the same fault in both cases:
 * this is an alias like every other here, tried only after the name as written
 * has matched nothing, put through the same strict comparison, and unable to
 * displace a direct match. "Dura FT" gets the same treatment and still matches
 * nothing, because the Dura family is FT 1500/2500/3500/5500 and there is no
 * Dura FT2000 — which is the right answer rather than a near miss.
 *
 * The same rule cost this brand more than a 2000: "Max Power" is Max Power 8810,
 * "Power Volt" is Power Volt 7710, "Brave" is Brave 6300. Those cannot be
 * repaired here, because the missing digits differ per row and this hook cannot
 * see the site to check. They stay unmatched, and `fleet-catalogue.ts` names
 * them in its report as rows the site's fuller name now sits beside.
 */
function fleetModelAliases(name: string): string[] {
  if (/2000\s*$/i.test(name)) return [];
  return [`${name}2000`, `${name} 2000`];
}

/** The retailer catalogue keeps this colour in the model name; ProKennex does not. */
function proKennexModelAliases(name: string): string[] {
  const withoutColour = name.replace(/\s*-\s*xám kim loại\s*$/i, "").trim();
  return withoutColour && withoutColour !== name ? [withoutColour] : [];
}

/**
 * A feletsports.com listing name, reduced to the frame it is a page for.
 *
 * This shop publishes one product per colourway and puts the colour in the
 * product name rather than in an attribute — "HYPERMAX RED", "NEO 722
 * WHITE/YELLOW", "THE LEGEND ZAKRY LIMITED RED" — which is the same habit the
 * Vietnamese retailers have and therefore the same splitter, run on the same
 * closed colour vocabulary. It backs out the moment what remains stops naming a
 * model, so "ARCANA" survives as a model and "SNOW WHITE" would not.
 *
 * The weight grade comes off first for the same reason it does on META.vn: the
 * catalogue keeps the grade on the variant, and a grade left between the model
 * and the colour stops the colour walk before it starts.
 *
 * The url is not consulted. Felet's permalinks are the product names slugified
 * with the punctuation dropped — `neo-722-whiteyellow`, `felet-6055-speed--
 * control` — so they carry strictly less than the names do, and every match
 * this provider makes is made on the title.
 */
function feletTitle(title: string): string {
  return splitColourway(stripVariantTokens(title)).base;
}

/**
 * A Vietnamese letter — anything outside ASCII. What separates a VS model name
 * from the sales copy that follows it on venson.vn, and the whole basis of
 * `vensonTitle` below.
 */
const VIETNAMESE = /[^\u0000-\u007F]/;

/**
 * A venson.vn listing name, reduced to the frame it is a page for.
 *
 * This shop writes a paragraph where the other providers write a name: "Vợt cầu
 * lông VS Thunder 100 chính hãng dạ quang phát sáng, sợi carbon bền nhẹ 4U dành
 * cho mọi người chơi" is one product, and the catalogue holds it as "Thunder
 * 100". `titleNoise` takes off what is on every listing — the category, the
 * brand in both its spellings, "chính hãng", the weight grade, the lay-up — and
 * what is left is still the model followed by a sentence of prose.
 *
 * The prose is separable from the name because of the script it is written in.
 * VS names its frames in Latin letters (Thunder 100, Kriss Sword XP, HC990P,
 * Kirin 80) and describes them in Vietnamese, so the model ends at the first
 * diacritic. That is the rule, and it is the shop's own typography rather than a
 * vocabulary of marketing phrases fitted to these 42 listings.
 *
 * Two details make it hold on the real pages:
 *
 *   * A leading Vietnamese run is kept. Two listings open in Vietnamese — "Dây
 *     cước vợt cầu lông VENSON VS Kirin …", which is a *string* mis-filed in the
 *     racket category, and "Vợt cầu lông Venson Rồng văn trắng, VS ACE Power 11
 *     Max Dragon …" — and cutting at the first diacritic would leave "Dây",
 *     while skipping to the first Latin word would leave "Kirin" and make a
 *     reel of string look like the Kirin 80. Keeping the run means `excludeTitle`
 *     can still read what the shop said it was selling.
 *   * The head stops at a spaced dash. One listing gives both spellings of one
 *     name — "VS AP77 – Ace Power 77" — and the matcher forgives nothing that
 *     trails a model but a SKU fragment, so the second spelling has to go. The
 *     dash has to be spaced: "V-Dragon" is a model name.
 */
function vensonTitle(title: string): string {
  const head = title.split(/\s+[–—-]\s+/)[0];
  const words: string[] = [];
  let latin = false;

  for (const word of head.split(/\s+/)) {
    if (VIETNAMESE.test(word)) {
      if (latin) break;
    } else if (/[A-Za-z0-9]/.test(word)) {
      latin = true;
    }
    words.push(word);
  }

  return words.join(" ").replace(/[,:;.]+$/, "").trim();
}

/**
 * The catalogue's name for a VS racket, in the other spellings VS uses.
 *
 * Two, and both are the manufacturer's own convention read off its own pages
 * rather than a guess fitted to a row:
 *
 *   * `Ace Power 77` → `AP77`. venson.vn publishes one listing under both names
 *     at once — "Vợt cầu lông VS AP77 – Ace Power 77" — which is VS stating the
 *     expansion itself. The catalogue's rows came from retailers and hold the
 *     long form; the shop's own pages are titled with the code. Two rackets need
 *     it, Ace Power 77 and ACE Power 11 Max.
 *   * `Ultra Woven 70X` → `Woven 70X`. Ultra Woven is a series, and this shop
 *     writes the series word on one page ("VS Ultra Woven 88S") and drops it on
 *     the next ("VENSON VS WOVEN 70X"), so it is optional in VS's own writing.
 *
 * Both are aliases like every other here: offered only after the name as
 * written has matched nothing, put through the same strict comparison, and
 * unable to displace a direct match.
 */
function vensonModelAliases(name: string): string[] {
  const out = new Set<string>();

  const acePower = /^\s*ace\s+power\s+(\d+)\b(.*)$/i.exec(name);
  if (acePower) out.add(`AP${acePower[1]}${acePower[2]}`);

  if (/^\s*ultra\s+\S/i.test(name)) out.add(name.replace(/^\s*ultra\s+/i, ""));

  out.delete(name);
  return [...out];
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
    // liningbadminton.vn — Li-Ning Việt Nam's own store, and the only Li-Ning
    // property that answers with a catalogue at all.
    //
    // li-ning.com is a corporate landing page linking out to Amazon and
    // AliExpress, and en.lining.com answers 403 to any non-browser client, so
    // for 340 catalogue rackets — the largest single gap in this registry —
    // there was no source and not one of them carried a photograph.
    //
    // The shop runs on Haravan, which speaks the Shopify product API, so
    // `/collections/<handle>/products.json` returns the name and the full
    // gallery together and the crawl is finished the moment discovery is: no
    // product page is ever fetched.
    //
    // One collection covers the line. `vot-cau-long` publishes 98 rackets, and
    // the union of its rendered listing pages is exactly those 98, so nothing
    // is hiding behind the grid. Haravan silently caps a page at 50 however
    // large a `limit` is asked for, which makes this two requests and an empty
    // third.
    //
    // Not the `/search` endpoint the site's own filtered listing calls:
    // robots.txt disallows /search outright, and it carries less than
    // products.json does anyway.
    //
    // 57 of the 340 rackets match. The rest are what a decade of retailer rows
    // looks like beside a current-line shop — Woods N90, Ultra Carbon, N7II,
    // the whole 3G Ti Powertec family — and Li-Ning publishes no archive on any
    // property, so there is no source for them and no amount of crawling finds
    // one.
    id: "lining-vn",
    name: "Li-Ning Vietnam",
    origin: "https://liningbadminton.vn",
    brandSlugs: ["li-ning"],
    platform: "shopify",
    catalogue: {
      kind: "shopify-collection",
      collections: ["vot-cau-long"],
      // Every product in it is a racket today, filed under three spellings of
      // "Vợt cầu lông". The filter is what keeps that true the day the shop
      // files a bag or a grip in the same collection.
      productTypePattern: /v[ơợ]t\s+c[aâầ]u\s+l[oôộ]ng/i,
      // Haravan's real page size, whatever is asked for.
      pageSize: 50,
    },
    // Everything that is on every listing rather than on this frame.
    titleNoise: [
      // "[Tặng kèm 01 hộp cầu Li-Ning AYQN024]" — a promotion stapled to the
      // name, and the only thing here in square brackets.
      /\s*\[[^\]]*\]\s*/g,
      // "(Khung vợt)" — sold as a frame rather than strung. On 94 of the 98.
      /\s*\(\s*khung\s+v[ơợ]t\s*\)\s*/gi,
      // The category, then a bare leading "Vợt" for the listings that write
      // "Vợt Li Ning Aeronaut 4000C" instead.
      /\s*v[ơợ]t\s+c[aâầ]u\s+l[oôộ]ng\s*/gi,
      /^\s*v[ơợ]t\s+/gi,
      // The brand, hyphenated or not, in any case.
      /\s*li[\s-]?ning\s*/gi,
      // The code Li-Ning prints on the frame — AYPT293-4, P-AYPU115-88C — which
      // this shop appends to every name. The matcher would forgive it as a
      // trailing SKU fragment, but it sits *before* "(Khung vợt)" rather than
      // at the end, and a code wedged inside a name is forgiven by nothing.
      /\s*\(?P?-?AYP[A-Z]\d{3}-\d{1,2}[A-Z]?\)?\s*/gi,
      // The weight grade, always parenthesised here and usually mid-name.
      /\s*\(\s*[2-7]U\s*\)\s*/gi,
      // Fengying is Li-Ning's series name for the Bladex line. This shop prints
      // it and the catalogue's retailer rows mostly do not; where one of them
      // does, `liningVnModelAliases` answers from the other side.
      /\s*fengying\s*/gi,
    ],
    titleTransform: (title) => liningVnTitle(title),
    modelAliases: liningVnModelAliases,
    // "SET Vợt cầu lông Li-Ning phiên bản LÂM" and "Combo Li-Ning Axforce 60"
    // are bundles — a frame with a bag, shoes or shuttles — and the photograph
    // on them is of the bundle. Six of the 98 listings are one or the other,
    // and the catalogue holds none of them as a product.
    excludeTitle: [/^\s*(?:set|combo)\b/i],
    politenessMs: 400,
  },
  {
    // Fleet's Vietnamese distributor, and the brand's only reachable property.
    //
    // fleet.com.my — the Malaysian manufacturer — answers 503 to everything, so
    // for 153 catalogue rackets there was no source at all and every one of them
    // carried zero photographs. fleet.vn is Fleet Việt Nam's own site: the same
    // brand, an official distributor rather than a shop that happens to stock
    // it, in the same class as kumpoo-vn, gosen-vn, hundred-vn and mizuno-vn.
    //
    // It is a hand-built ASP.NET site with no API, no sitemap and no structured
    // data, so both halves of this entry are bespoke: `fleetVnGallery` reads the
    // photographs out of the one container that holds them, and
    // `scripts/scraper/fleet-catalogue.ts` reads the specification table the
    // same pages print — weight, balance, tension and hole count, which is more
    // than the retailer listings these rackets came from ever carried.
    //
    // Plain http, and that is not an oversight: fleet.vn serves no TLS at all
    // (the handshake fails, it does not redirect), so an https origin here finds
    // nothing. robots.txt is a 404, which the reader treats as allow-all.
    id: "fleet-vn",
    name: "Fleet Vietnam",
    origin: "http://fleet.vn",
    brandSlugs: ["fleet"],
    // Never consulted: `extractors` below replaces the platform chain, because
    // there is no structured data on this site for any of them to read.
    platform: "structured-data",
    catalogue: {
      kind: "category-pagination",
      url: "http://fleet.vn/san-pham/vot-cau-long/89",
      // Not a query string and not a pretty permalink: the pager writes the
      // page number into a path segment as `…/89/page=2`.
      pagePath: "page={page}",
      // One anchor per card in the main grid. The sidebar's "newest products"
      // list links the same products with a bare `<a>`, so the class is what
      // keeps the walk from counting sixteen rackets twice on every page.
      linkSelector: ".product-list .product a.name",
      // The listing is 8 pages of 16 and the walk stops when a page adds
      // nothing, so this is only the guard against a pager that never ends.
      maxPages: 15,
      // `/chi-tiet-san-pham/vot-cau-long-fleet-woven-ice/353` → `woven-ice`.
      slugFromUrl: fleetVnSlug,
    },
    // The same Vietnamese retail copy as kumpoo-vn and gosen-vn, in three
    // spellings this one shop uses interchangeably: "Vợt cầu lông Fleet Woven
    // IV", "Vợt Cầu lông FLEET SATURN" and the abbreviated "Vợt CL Knight V6".
    // The permalink is that copy slugified, so without this nothing matches on
    // either the title or the slug.
    // The brand comes off with it, which `filterFurniture` would otherwise do
    // at comparison time. It has to happen here instead because the shop
    // publishes Guardian twice — "Vợt Cầu lông FLEET GUARDIAN" and "Vợt CL
    // Guardian" — and `bestMatch` merges two pages into one product only when
    // their cleaned titles are identical. With the brand left in they read as
    // two rackets called Guardian and the match is refused as ambiguous.
    titleNoise: [
      /\s*v[ơợ]t\s+c[aâầ]u\s+l[oôộ]ng\s*/gi,
      /\s*v[ơợ]t\s+cl\s+/gi,
      /(?:^|\s)fleet(?=\s|$)/gi,
    ],
    // "Speed FT" here, "Speed FT2000" there — see fleetModelAliases.
    modelAliases: fleetModelAliases,
    // Two listings sell three and four frames under one product page, and the
    // photograph on them is the group shot: "Fleet 900 Tour, 900 Max, 900 Pro"
    // and "Fleet Starshine, Brand FR18, Max Speed, Arsas FR18". The catalogue
    // holds all seven of those as separate rackets, so each listing is a page
    // for none of them. A comma is the whole rule here because no Fleet model
    // name contains one — the site writes "Woven Mach 5.1" and "JR-1 III".
    excludeTitle: [/,/],
    // Shared hosting, no CDN, and 8 listing pages plus ~120 product pages is
    // already the whole site. Twice the usual gap costs a minute and keeps the
    // crawl below what this server notices.
    politenessMs: 800,
    extractors: [fleetVnGallery],
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
  {
    // feletsports.com, Felet's own international store, on SiteGiant.
    //
    // It was verified and left unregistered because its catalogue looked like
    // it needed a browser: the store is a Next.js App Router site and its
    // product record streams in the flight payload. The listing does not — the
    // `/collection/racquet` grid is server-rendered, product links and product
    // names included — so discovery is the same paginated category walk Yonex
    // and Gosen use, and only the gallery reads the payload.
    //
    // One collection covers the whole line. `/collection/racquet` publishes 63
    // rackets over three pages, and its eight sub-collections (professional,
    // master, advance, moderate, novice, super-light, training, kids) sum to
    // exactly those 63 with nothing outside them, so the parent is walked and
    // the children are not. There is no sitemap to cross-check against —
    // /sitemap.xml is the store's 404 page and robots.txt redirects to a 403 —
    // which is also why nothing here is filtered on robots rules.
    //
    // 30 of the catalogue's 104 Felet rackets match. The remainder are frames
    // this store does not sell: it is a current-line shop, and the catalogue's
    // Felet rows come from Vietnamese retailers carrying a decade of stock.
    // Four near-misses are deliberately refused rather than guessed at, because
    // each would put one racket's photography under another's id:
    //
    //   Nevow TJ      vs NEVOW TJ 1000        — 1000 is not a SKU suffix
    //   Woven TJ      vs WOVEN TJ 1000        — same
    //   Sakura        vs SAKURRA              — one letter, and no way to tell
    //                                           a misspelling from a sequel
    //   F-Force       vs F-FORCE SUPER LIGHT  — a lighter frame, not a colour
    //
    // Arcana is the shape of the rest: the store sells four colours of a frame
    // it calls plain "ARCANA", and the catalogue holds Arcana 80L, 80L Plus,
    // 80S, 80S Plus, 90 and Frame. Nothing here says which of the six the
    // store means, so no photograph is attached to any of them.
    id: "felet",
    name: "Felet International",
    origin: "https://www.feletsports.com",
    brandSlugs: ["felet"],
    // Never consulted: `extractors` below replaces the platform chain. These
    // pages carry no schema.org block at all, and their og:image is a 420×420
    // crop of the hero rather than the hero.
    platform: "structured-data",
    catalogue: {
      kind: "category-pagination",
      url: "https://www.feletsports.com/collection/racquet",
      pageParam: "page",
      // The card's name anchor. The image above it links to the same url with
      // no text, and picking that one instead would leave every candidate
      // nameless — which on this shop means matching nothing, since the
      // permalinks carry less than the names do.
      linkSelector: ".product-content h3 a",
      // Three pages today, at 24 a page. The walk stops when a page adds
      // nothing new, so this only bounds a shop that grows.
      maxPages: 8,
    },
    titleTransform: (title) => feletTitle(title),
    extractors: [sitegiantGallery],
  },
  {
    // Venson, and the 114 rackets this catalogue held under the brand slug `vs`
    // with not one photograph between them.
    //
    // VS is a Vietnamese brand — the frames say VS, the company is Venson, and
    // this catalogue's rows use both words because the retailers they came from
    // do. venson.vn is the brand's own property: WooCommerce on Hostinger,
    // publishing all 42 of its rackets in one category, `vot-cau-long`, with the
    // Store API switched on. So the whole crawl is two requests — the category
    // list, then one page of products — and the product record carries the full
    // gallery (4 to 12 shots at 1500 px) and the specification block beside it,
    // which is why there is no per-racket page fetch here at all and why
    // `venson-catalogue.ts` can read the specs off the same payload.
    //
    // The reason this brand was uncovered until now is not the site. It is that
    // every title on it is a paragraph of Vietnamese sales copy with the model
    // name buried at the front — see `vensonTitle`, which is the whole of the
    // work in this entry.
    id: "venson-vn",
    name: "Venson (VS)",
    origin: "https://venson.vn",
    brandSlugs: ["vs"],
    platform: "woocommerce",
    catalogue: {
      kind: "woocommerce-store",
      categorySlugs: ["vot-cau-long"],
      pageSize: 100,
      // 15 of the 42 are out of stock, and on this shop that shelf is where the
      // brand's own back catalogue sits — the Woven 70X, the Youlong colours,
      // the year-of-the-snake AP11 Max. Their photography is still theirs, and
      // the catalogue is a reference rather than a storefront, so they are kept.
      //
      // Public category pages for the case where a CI runner is served the shop
      // but blocked from WordPress JSON. The card's own anchor
      // (`woocommerce-loop-product__link`) wraps the thumbnail and carries no
      // text, and a nameless candidate on this shop matches nothing at all — its
      // permalinks are the same sales copy slugified — so the fallback reads the
      // Astra theme's summary link, which is the one that holds the title.
      htmlFallback: {
        url: "https://venson.vn/danh-muc-san-pham/vot-cau-long/",
        pagePath: "page/{page}/",
        linkSelector: ".astra-shop-summary-wrap a",
        // All 42 fit on page one today. This only bounds a shop that grows.
        maxPages: 4,
      },
    },
    // Everything that is on every listing rather than on this frame. Order
    // matters: the punctuation and the grades come off before the lay-up rules,
    // because "Kirin 80 chính hãng titan 4U cao cấp, vợt kỳ lân…" only reads as
    // "titan followed by Vietnamese" once the 4U between them is gone.
    titleNoise: [
      // "(Thanh gươm diệt quỷ)", "(Bản Hộp)" — a gloss, never part of a name.
      /\s*\([^)]*\)\s*/g,
      // A comma or colon separates the name from a clause on 20 of the 42, and
      // no VS model name carries either: the shop writes "Woven 70X" and "HC990P".
      /\s*[,;:]\s*/g,
      // The category, then the bare word "vợt" (racket) wherever it appears —
      // "vợt kỳ lân sơn dạ quang" has it mid-sentence.
      /\s*v[ơợ]t\s+c[aâầ]u\s+l[oôộ]ng\s*/gi,
      /(?:^|\s)v[ơợ]t(?=\s|$)/gi,
      // "chính hãng" (genuine) and "cao cấp" (premium), between them on 24.
      /\s*chính\s+hãng\s*/gi,
      /\s*cao\s+cấp\s*/gi,
      // The brand, in both spellings and wherever it sits. `filterFurniture`
      // takes a brand only at an edge of the token run, and this shop puts it in
      // the middle: "VS Po Fang chính hãng VENSON, tấn công tốc độ".
      /(?:^|\s)venson(?=\s|$)/gi,
      /(?:^|\s)vs(?=\s|$)/gi,
      // The weight grade and grip, spaced or run together: 4U, 6U, 4UG5, 4UG6.
      // Both are variant fields, and the grade sits between the model and the
      // copy here, so leaving it in place stops the reduction before it starts.
      /(?:^|\s)[2-7]U(?:\s*G[3-6])?(?=\s|$)/gi,
      /(?:^|\s)G[3-6](?=\s|$)/gi,
      // The lay-up. It is what the frame is made of, not what it is called:
      // "full carbon", "full cacbon" (the shop's own spelling), "carbon
      // graphite", "nano carbon", "carbon 30T Mitsubishi", "carbon 40T
      // Mitsubishi 1K".
      /\s*full\s+ca[rc]bon\s*/gi,
      /\s*ca[rc]bon\s+graphite\s*/gi,
      /\s*nano\s+ca[rc]bon\s*/gi,
      /\s*ca[rc]bon\s+\d+t(?:\s+mitsubishi)?(?:\s+1k)?\s*/gi,
      // "full box" — the gift-box packaging on two listings, not the frame.
      /\s*full\s+box\s*/gi,
      // And a bare material word that is the first word of the Vietnamese
      // sentence rather than part of the name. Bounded by what follows it: only
      // when the next word carries a diacritic, which is what keeps "High Carbon
      // Series" and "titan 1000" — both real listings — intact.
      /\s+(?:ca[rc]bon|graphite|titan)(?=\s+\S*[^\u0000-\u007F])/gi,
    ],
    titleTransform: (title) => vensonTitle(title),
    // "Ace Power 77" here, "AP77" there; "Ultra Woven 70X" here, "WOVEN 70X"
    // there. See vensonModelAliases.
    modelAliases: vensonModelAliases,
    /**
     * Listings that are a page for several frames, or for no frame at all.
     *
     * Each is refused on the shop's own evidence rather than on a reading of its
     * copy: WooCommerce publishes the variation axis with the product, and where
     * that axis is `Phân loại` ("classification") its terms are *different
     * models* — HC 898 and HC 890 under "High Carbon Series", 7000/7100/7200/7300
     * under one Blade, four Demon Slayer characters under one Kimetsu, Youth
     * 310/311/312/313 under one Youth, eleven assorted B-grade frames under the
     * clearance listing — where `Màu sắc` ("colour") is one frame in two colours.
     * The photograph on a `Phân loại` page is the group shot, and this catalogue
     * holds those frames separately, so the listing is a page for none of them.
     *
     * The patterns are tested against the cleaned title, which is what
     * `vensonTitle` has already reduced these to, so two of them are a single
     * word: "Thanh" is what is left of "Thanh lí vợt lỗi nhẹ: Youlong, Titan 7
     * Pro, …" ("thanh lí" is clearance) once the reduction cuts at "lí", and
     * "Youth" is the whole of the Youth family page's name.
     *
     * The string is the odd one out — "Dây cước" is not a racket at all, and it
     * is in this category by the shop's mistake.
     */
    excludeTitle: [
      /^\s*thanh\s*$/i,
      /^\s*d[aâ]y\s+c[uư][ơớ]c\b/i,
      /\bseries\b/i,
      /\d\s*\/\s*\d/,
      /^\s*kimetsu\s+no\s+yaiba\s*$/i,
      /^\s*youth\s*$/i,
    ],
    // Shared hosting behind an edge cache, and the whole crawl is two JSON
    // requests plus the images. The usual gap is plenty.
    politenessMs: 400,
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
