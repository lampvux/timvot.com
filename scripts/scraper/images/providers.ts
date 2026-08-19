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
 *   woocommerce-store    apacs        name + full gallery, 453 rackets / 5 requests
 *   shopify-collection   mizuno       name + full gallery from products.json
 *   2beasy-category      victor       Victor's storefront API, 245 rackets / 2 requests
 *   category-pagination  yonex        the rendered "all racquets" listing, ?p=1…N
 *   browser-listing      mizuno-asia  Chromium, for a site with no product links at all
 *   sitemap              victor       the long tail of discontinued models
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
 * On coverage
 *
 * Four brands are wired up, across five providers — the four largest in the
 * catalogue by racket count. The rest are not oversights; each was probed
 * against its live site with real browser headers:
 *
 *   Fleet      fleet.com.my answers 503.
 *   Kawasaki   kawasaki-sports.com is the OEM sportswear-fabric business, not
 *              the badminton brand; its 183 products are textiles.
 *   Adidas     badminton is a licensed line with no catalogue site of its own.
 *   Forza,     the sites are alive but publish neither a sitemap nor a product
 *   Gosen,     API, so their catalogues cannot be enumerated without guessing
 *   Ashaway,   URLs.
 *   Babolat
 *   Li-Ning    li-ning.com is a corporate landing page linking out to Amazon
 *              and AliExpress; en.lining.com answers 403 to any non-browser
 *              client. But liningbadminton.vn — a brand-dedicated Vietnamese
 *              distributor on Haravan — does publish 106 rackets, and is
 *              verified but NOT YET REGISTERED here.
 *
 * Also verified and not yet registered: kumpoovietnam.com (WooCommerce, 43
 * rackets), proacevn.vn (WooCommerce, 59) and feletsports.com (SiteGiant, 62).
 * Those three plus Li-Ning need Vietnamese listing-title normalisation before
 * they will match, which is why they are not in the list below yet.
 *
 * Shipping an adapter that has never parsed a real page would be worse than an
 * honest gap, so the registry carries what works and the run names what it
 * skipped. Adding a brand whose site does cooperate is a config entry below,
 * not new code.
 */

import type { GalleryExtractor } from "./gallery";
import { magentoGallery, nextDataGallery, shopifyGallery, structuredDataGallery } from "./gallery";

export type ProviderPlatform =
  | "magento"
  | "next-data"
  | "shopify"
  | "woocommerce"
  | "structured-data"
  /** Gallery is only readable after hydration; read it through Chromium. */
  | "browser";

/** How a provider's product list is enumerated. */
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
      /** Page one. Later pages append `?<pageParam>=N`. */
      url: string;
      pageParam: string;
      /** Anchor carrying the product link; its text is the product name. */
      linkSelector: string;
      /** Safety stop for a listing that never runs out of pages. */
      maxPages: number;
    }
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
       * Render listing pages in a browser and take the product links.
       *
       * The last resort, and only where a site genuinely has no readable
       * endpoint. Mizuno's Asian badminton site is a Wix Stores build whose
       * grid is assembled client-side behind a signed API — the served HTML
       * contains no product anchors at all.
       */
      kind: "browser-listing";
      /** Listing pages to render. Mizuno splits its rackets across 15 series. */
      urls: string[];
      /** Product links to keep. */
      productUrlPattern: RegExp;
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
  /** Extra gap between requests to this origin, on top of the global delay. */
  politenessMs?: number;
}

/**
 * The extractor chain per platform, used only by `sitemap` providers — the API
 * catalogues carry their galleries already. Each is tried in order and the
 * first that returns images wins, so a site that changes template degrades to
 * the generic schema.org reader instead of silently returning nothing.
 */
export const EXTRACTORS: Record<ProviderPlatform, GalleryExtractor[]> = {
  magento: [magentoGallery, structuredDataGallery],
  "next-data": [nextDataGallery, structuredDataGallery],
  shopify: [shopifyGallery, structuredDataGallery],
  woocommerce: [structuredDataGallery],
  "structured-data": [structuredDataGallery],
  // Never reached: a browser provider's gallery comes from `BrowserSession`,
  // not from parsing served HTML. Declared so the record stays total.
  browser: [],
};

/** The 15 series pages Mizuno splits its Asian racket line across. */
const MIZUNO_ASIA_SERIES = [
  "fortius-series",
  "altius-series",
  "acrospeed-rackets",
  "jpx-series",
  "xyst-series",
  "prototype-series",
  "speedflex-series",
  "caliber-series",
  "altrax-series",
  "promax-series",
  "duralite-series",
  "fioria-series",
  "zephyr-series",
  "carbo-pro-series",
  "dynalite-series",
].map((slug) => `https://www.mizunobadminton-asia.com/${slug}`);

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
    politenessMs: 250,
  },
  {
    id: "apacs",
    name: "Apacs",
    origin: "https://apacssports.com",
    brandSlugs: ["apacs"],
    platform: "woocommerce",
    // 453 rackets, 5 requests, every gallery attached — and the shop files them
    // under a category that means exactly what we want, so no classifier is
    // needed to keep the overgrips and shoes out.
    catalogue: { kind: "woocommerce-store", categorySlugs: ["badminton-rackets"], pageSize: 100 },
    politenessMs: 300,
  },
  {
    // Mizuno's Asian badminton site, kept separate from the Malaysian Shopify
    // store rather than merged into it. They are two properties with two
    // catalogues — the Shopify store lists what Malaysia stocks today, this
    // lists the whole Asian line by series — and keeping them as separate
    // providers is what lets the storage layout and the report say which
    // photograph came from which.
    id: "mizuno-asia",
    name: "Mizuno Badminton Asia",
    origin: "https://www.mizunobadminton-asia.com",
    brandSlugs: ["mizuno"],
    platform: "browser",
    catalogue: {
      kind: "browser-listing",
      urls: MIZUNO_ASIA_SERIES,
      productUrlPattern: /^https:\/\/www\.mizunobadminton-asia\.com\/product-page\/[^/?#]+$/i,
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
      collections: ["badminton-rackets", "mens-badminton-rackets", "womens-badminton-rackets"],
      // The men's and women's collections include grips, jackets and shoes.
      productTypePattern: /racket|racquet/i,
    },
    titleNoise: [
      /\((?:un)?strung\)/gi,
      /\[[^\]]*\]/g, // [MADE IN JAPAN], [CONTROL], …
    ],
    politenessMs: 300,
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
