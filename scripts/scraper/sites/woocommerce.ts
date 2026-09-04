/**
 * fbshop.vn, qvbadminton.com and hvshop.vn all run WooCommerce and all expose
 * the unauthenticated Store API at /wp-json/wc/store/v1/products. That endpoint
 * is the same catalogue the category page renders, but structured: real stock
 * state, real category membership, and an X-WP-TotalPages header that says
 * exactly how far the pagination goes. Scraping the rendered HTML alone — what
 * this repository did before — meant guessing theme class names that differ per
 * site and break on every theme update.
 *
 * One caveat drove the design here: all three shops sell a slice of their
 * catalogue at a price the Store API reports as 0 (fbshop does it for ~55% of
 * listings). The price is real, it is just held in theme meta that the API does
 * not serialise, and it *is* printed on the rendered listing card. So the walk
 * is two-phase: enumerate and classify from the API, then re-read the rendered
 * listing pages and fill in prices by permalink. Anything still priceless after
 * that is a "liên hệ" (call-us) listing, which is not an offer and is reported
 * separately rather than being given an invented price.
 */

import * as cheerio from "cheerio";
import { fetchWithRetry, pool, JSON_HEADERS, HTML_HEADERS, cleanText, parseVndPrice } from "../http";
import { isRacketListing } from "../classify";
import type { ScrapedProduct, ScraperOptions, ScraperResult, ScraperSource } from "../types";

export interface WooSiteConfig {
  source: ScraperSource;
  origin: string;
  /** Term id of the racket category on this site. */
  categoryId: number;
  /** The rendered category page, for HTML price recovery and verification. */
  categoryUrl: string;
  /** Items the API actually returns per request (some sites cap below per_page). */
  pageSize: number;
  /** Walk the public category HTML when this site's Store API is blocked. */
  htmlFallback?: boolean;
}

export const WOO_SITES: Record<"fbshop" | "qvbadminton" | "hvshop", WooSiteConfig> = {
  fbshop: {
    source: "fbshop",
    origin: "https://fbshop.vn",
    categoryId: 6031,
    categoryUrl: "https://fbshop.vn/vot-cau-long/",
    // fbshop pins posts_per_page to 12 regardless of the per_page argument.
    pageSize: 12,
  },
  qvbadminton: {
    source: "qvbadminton",
    origin: "https://qvbadminton.com",
    categoryId: 17,
    categoryUrl: "https://qvbadminton.com/vot-cau-long/",
    pageSize: 100,
  },
  hvshop: {
    source: "hvshop",
    origin: "https://hvshop.vn",
    categoryId: 36,
    categoryUrl: "https://hvshop.vn/vot-cau-long/",
    pageSize: 100,
    // HV Shop returns 403 to the Store API from GitHub-hosted runners while
    // continuing to serve the public category pages those runners need.
    htmlFallback: true,
  },
};

interface StoreApiProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  sku?: string;
  prices?: {
    price?: string;
    regular_price?: string;
    currency_minor_unit?: number;
  };
  is_in_stock?: boolean;
  low_stock_remaining?: number | null;
  categories?: { id: number; slug: string; name: string }[];
  images?: { src?: string }[];
}

function toMajorUnits(raw: string | undefined, minorUnit: number): number {
  if (!raw) return 0;
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value)) return 0;
  return minorUnit > 0 ? Math.round(value / 10 ** minorUnit) : value;
}

/** Strip query/hash and trailing slash so API permalinks and hrefs compare equal. */
function normaliseUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  }
}

interface ListingCard {
  title: string;
  price: number;
  msrp: number;
  url: string;
}

export interface WooCatalogueCard extends ListingCard {
  externalId?: string;
  imageUrl?: string;
  inStock: boolean;
  categorySlugs: string[];
}

/** Parse every product card, including "liên hệ" cards with no numeric price. */
export function parseWooCatalogueHtml(html: string): WooCatalogueCard[] {
  const $ = cheerio.load(html);
  const cards: WooCatalogueCard[] = [];

  $(".pcate-item .prd-card, .product-small.col, li.product").each((_, el) => {
    const $el = $(el);

    const title = cleanText(
      $el.find("a.prd-card-link").first().text() ||
        $el.find(".woocommerce-loop-product__title").first().text() ||
        $el.find(".product-title").first().text(),
    );
    const href =
      $el.find("a.prd-card-link").attr("href") ||
      $el.find(".woocommerce-loop-product__link").attr("href") ||
      $el.find("a[href]").attr("href") ||
      "";
    if (!title || !href) return;

    const currentText =
      $el.find(".price-current").first().text() ||
      $el.find("ins .woocommerce-Price-amount").first().text() ||
      $el.find(".price .woocommerce-Price-amount").first().text();
    const regularText =
      $el.find(".price-regular").first().text() ||
      $el.find("del .woocommerce-Price-amount").first().text();
    const price = parseVndPrice(currentText);
    const regular = parseVndPrice(regularText);

    const classNames = ($el.attr("class") || "").split(/\s+/);
    const postClass = classNames.find((name) => /^post-\d+$/.test(name));
    const externalId =
      $el.find("[data-prod_id]").first().attr("data-prod_id") || postClass?.slice("post-".length);
    const $image = $el.find(".box-image img, img.wp-post-image, img").first();
    const imageUrl =
      $image.attr("data-lazy-src") || $image.attr("data-src") || $image.attr("src") || undefined;

    cards.push({
      title,
      price,
      msrp: regular > price ? regular : price,
      url: href,
      externalId,
      imageUrl: imageUrl?.startsWith("data:") ? undefined : imageUrl,
      inStock: !classNames.includes("outofstock"),
      categorySlugs: classNames
        .filter((name) => name.startsWith("product_cat-"))
        .map((name) => name.slice("product_cat-".length)),
    });
  });

  return cards;
}

/**
 * Parse one rendered category page. fbshop runs a bespoke theme; qvbadminton and
 * hvshop run Flatsome. Exported so the verification pass can reuse it.
 */
export function parseWooListingHtml(html: string): ListingCard[] {
  return parseWooCatalogueHtml(html)
    .filter((card) => card.price > 0)
    .map(({ title, price, msrp, url }) => ({ title, price, msrp, url }));
}

/** Highest page number the rendered pager links to. */
function lastHtmlPage(html: string): number {
  const numbers = [...html.matchAll(/\/page\/(\d+)\//g)].map((m) => Number(m[1]));
  return numbers.length ? Math.max(...numbers) : 1;
}

/**
 * Enumerate a WooCommerce catalogue from its public rendered category pages.
 * This is intentionally opt-in per shop: API-backed sites keep their faster,
 * richer path, while HV Shop can still run from GitHub-hosted IP ranges where
 * WordPress rejects Store API requests with HTTP 403.
 */
async function scrapeRenderedCatalogue(
  config: WooSiteConfig,
  options: ScraperOptions,
  startTime: number,
  apiStatus: number,
): Promise<ScraperResult> {
  const verbose = Boolean(options.verbose);
  const timeoutMs = options.timeoutMs ?? 30000;
  const first = await fetchWithRetry(config.categoryUrl, {
    headers: HTML_HEADERS,
    timeoutMs,
    verbose,
    signal: options.signal,
  });

  if (!first.ok) {
    return {
      source: config.source,
      success: false,
      itemsCount: 0,
      products: [],
      error:
        `Store API returned HTTP ${apiStatus}; rendered catalogue fallback ` +
        `also returned HTTP ${first.status} on page 1`,
      durationMs: Date.now() - startTime,
      pagesFetched: 1,
    };
  }

  const advertisedPages = lastHtmlPage(first.body);
  const lastPage = Math.min(advertisedPages, options.maxPages ?? Infinity);
  const pages = Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => index + 2);
  const pageBodies = new Map<number, string>([[1, first.body]]);
  const failedPages: { page: number; status: number }[] = [];

  if (verbose) {
    console.warn(
      `   [${config.source}] Store API returned HTTP ${apiStatus}; ` +
        `falling back to ${lastPage}/${advertisedPages} rendered catalogue pages.`,
    );
  }

  await pool(pages, options.concurrency ?? 4, options.delayMs ?? 150, async (page) => {
    const response = await fetchWithRetry(`${config.categoryUrl}page/${page}/`, {
      headers: HTML_HEADERS,
      timeoutMs,
      verbose,
      signal: options.signal,
    });
    if (!response.ok) {
      failedPages.push({ page, status: response.status });
      return;
    }
    pageBodies.set(page, response.body);
    if (verbose && page % 10 === 0) {
      console.log(`   [${config.source}] rendered page ${page}/${lastPage}`);
    }
  });

  // A partial result must not be marked successful: the DB sync uses success
  // as permission to retire unseen offers from a seller.
  if (failedPages.length > 0) {
    failedPages.sort((a, b) => a.page - b.page);
    const sample = failedPages
      .slice(0, 5)
      .map(({ page, status }) => `${page} (HTTP ${status})`)
      .join(", ");
    return {
      source: config.source,
      success: false,
      itemsCount: 0,
      products: [],
      error:
        `Store API returned HTTP ${apiStatus}; rendered catalogue fallback failed on ` +
        `${failedPages.length} page(s): ${sample}`,
      durationMs: Date.now() - startTime,
      pagesFetched: pageBodies.size,
    };
  }

  const seen = new Map<string, WooCatalogueCard & { sourcePage: number }>();
  for (const [page, body] of [...pageBodies.entries()].sort((a, b) => a[0] - b[0])) {
    for (const card of parseWooCatalogueHtml(body)) {
      const key = card.externalId || normaliseUrl(card.url);
      if (!seen.has(key)) seen.set(key, { ...card, sourcePage: page });
    }
  }

  const scrapedAt = new Date().toISOString();
  const products: ScrapedProduct[] = [];
  let skippedNonRacket = 0;
  let priceless = 0;

  for (const card of seen.values()) {
    if (!isRacketListing(card.title, card.categorySlugs)) {
      skippedNonRacket++;
      continue;
    }
    if (card.price <= 0) {
      priceless++;
      continue;
    }
    products.push({
      source: config.source,
      externalId: card.externalId,
      rawTitle: card.title,
      price: card.price,
      msrp: card.msrp,
      inStock: card.inStock,
      qtyAvailable: card.inStock ? undefined : 0,
      url: card.url,
      imageUrl: card.imageUrl,
      categorySlugs: card.categorySlugs,
      sourcePage: card.sourcePage,
      scrapedAt,
    });
  }

  return {
    source: config.source,
    success: true,
    itemsCount: products.length,
    products,
    durationMs: Date.now() - startTime,
    pagesFetched: pageBodies.size,
    skippedNonRacket,
    notes: [
      `Store API returned HTTP ${apiStatus}; used the rendered catalogue fallback.`,
      ...(priceless > 0
        ? [`${priceless} listings publish no price ("liên hệ") and were excluded from offers.`]
        : []),
    ],
  };
}

/**
 * Walk the rendered listing and return permalink → price. This is the only way
 * to see prices these themes keep out of the Store API.
 *
 * `wanted` is the set of permalinks we are actually missing a price for, and
 * the walk stops once it has them all rather than always reading to the last
 * page. Where the missing prices are absent from the rendered listing as well —
 * a "liên hệ" listing genuinely has no number anywhere — the set never empties
 * and the walk still costs a full read, which is the price of being sure.
 */
async function buildHtmlPriceMap(
  config: WooSiteConfig,
  options: ScraperOptions,
  wanted?: Set<string>,
): Promise<Map<string, ListingCard>> {
  const verbose = Boolean(options.verbose);
  const timeoutMs = options.timeoutMs ?? 30000;
  const map = new Map<string, ListingCard>();

  const outstanding = new Set(wanted ?? []);
  const record = (card: ListingCard) => {
    const key = normaliseUrl(card.url);
    map.set(key, card);
    outstanding.delete(key);
  };
  const satisfied = () => wanted !== undefined && outstanding.size === 0;

  const first = await fetchWithRetry(config.categoryUrl, {
    headers: HTML_HEADERS,
    timeoutMs,
    verbose,
    signal: options.signal,
  });
  if (!first.ok) return map;

  for (const card of parseWooListingHtml(first.body)) record(card);

  const advertised = lastHtmlPage(first.body);
  const maxPages = options.maxPages ?? Infinity;
  const lastPage = Math.min(advertised, maxPages);

  if (verbose) {
    console.log(`   [${config.source}] rendered listing has ${advertised} pages; reading ${lastPage} for prices.`);
  }

  const pages: number[] = [];
  for (let page = 2; page <= lastPage; page++) pages.push(page);

  if (pages.length > 0 && !satisfied()) {
    let lastRead = 1;
    await pool(pages, options.concurrency ?? 4, options.delayMs ?? 150, async (page) => {
      if (satisfied()) return;
      const res = await fetchWithRetry(`${config.categoryUrl}page/${page}/`, {
        headers: HTML_HEADERS,
        timeoutMs,
        verbose,
        signal: options.signal,
      });
      lastRead = page;
      if (!res.ok) return;
      for (const card of parseWooListingHtml(res.body)) record(card);
      if (verbose && page % 25 === 0) {
        console.log(`   [${config.source}] listing page ${page}/${lastPage} — ${map.size} prices recovered`);
      }
    });

    if (verbose && satisfied() && lastRead < lastPage) {
      console.log(
        `   [${config.source}] every missing price found by page ${lastRead}; ` +
          `skipped the remaining ${lastPage - lastRead} listing pages.`,
      );
    }
  }

  return map;
}

export async function scrapeWooCommerce(
  config: WooSiteConfig,
  options: ScraperOptions = {},
): Promise<ScraperResult> {
  const startTime = Date.now();
  const verbose = Boolean(options.verbose);
  const timeoutMs = options.timeoutMs ?? 30000;
  const concurrency = options.concurrency ?? 4;
  const delayMs = options.delayMs ?? 150;

  const apiUrl = (page: number) =>
    `${config.origin}/wp-json/wc/store/v1/products` +
    `?per_page=${config.pageSize}&page=${page}&category=${config.categoryId}&orderby=date&order=desc`;

  try {
    // --- Phase 1: enumerate and classify via the Store API -------------------
    const first = await fetchWithRetry(apiUrl(1), {
      headers: JSON_HEADERS,
      timeoutMs,
      verbose,
      signal: options.signal,
    });

    if (!first.ok) {
      if (config.htmlFallback) {
        return await scrapeRenderedCatalogue(config, options, startTime, first.status);
      }
      return {
        source: config.source,
        success: false,
        itemsCount: 0,
        products: [],
        error: `Store API returned HTTP ${first.status} on page 1`,
        durationMs: Date.now() - startTime,
        pagesFetched: 1,
      };
    }

    const reportedTotal = Number(first.headers.get("x-wp-total")) || undefined;
    const reportedPages = Number(first.headers.get("x-wp-totalpages")) || 1;
    const maxPages = options.maxPages ?? Infinity;
    const lastPage = Math.min(reportedPages, maxPages);

    if (verbose) {
      console.log(
        `   [${config.source}] Store API reports ${reportedTotal ?? "?"} products across ` +
          `${reportedPages} pages (${config.pageSize}/page); fetching ${lastPage}.`,
      );
    }

    interface Staged {
      product: ScrapedProduct;
      apiPrice: number;
    }

    const staged = new Map<string, Staged>();
    let skippedNonRacket = 0;
    let pagesFetched = 1;

    const ingest = (raw: string, page: number) => {
      let items: StoreApiProduct[];
      try {
        items = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(items)) return;

      for (const item of items) {
        const title = cleanText(item.name || "");
        if (!title) continue;

        const categorySlugs = (item.categories || []).map((c) => c.slug);
        if (!isRacketListing(title, categorySlugs)) {
          skippedNonRacket++;
          continue;
        }

        const minorUnit = item.prices?.currency_minor_unit ?? 0;
        const price = toMajorUnits(item.prices?.price, minorUnit);
        const regular = toMajorUnits(item.prices?.regular_price, minorUnit);

        staged.set(String(item.id), {
          apiPrice: price,
          product: {
            source: config.source,
            externalId: String(item.id),
            rawTitle: title,
            price,
            msrp: regular > price ? regular : price,
            inStock: item.is_in_stock !== false,
            qtyAvailable: item.low_stock_remaining ?? undefined,
            url: item.permalink || `${config.origin}/?p=${item.id}`,
            imageUrl: item.images?.[0]?.src,
            categorySlugs,
            sourcePage: page,
            scrapedAt: new Date().toISOString(),
          },
        });
      }
    };

    ingest(first.body, 1);

    const remaining: number[] = [];
    for (let page = 2; page <= lastPage; page++) remaining.push(page);

    if (remaining.length > 0) {
      await pool(remaining, concurrency, delayMs, async (page) => {
        const res = await fetchWithRetry(apiUrl(page), {
          headers: JSON_HEADERS,
          timeoutMs,
          verbose,
          signal: options.signal,
        });
        pagesFetched++;
        if (!res.ok) {
          if (verbose) console.warn(`   [${config.source}] API page ${page}: HTTP ${res.status}`);
          return;
        }
        ingest(res.body, page);
        if (verbose && page % 25 === 0) {
          console.log(`   [${config.source}] API page ${page}/${lastPage} — ${staged.size} rackets so far`);
        }
      });
    }

    // --- Phase 2: recover the prices the API omits ---------------------------
    const missingPrice = [...staged.values()].filter((s) => s.apiPrice <= 0);
    let recovered = 0;

    if (missingPrice.length > 0) {
      if (verbose) {
        console.log(
          `   [${config.source}] ${missingPrice.length} products have no price in the API — ` +
            `reading the rendered listing to recover them.`,
        );
      }

      const priceMap = await buildHtmlPriceMap(
        config,
        options,
        new Set(missingPrice.map((entry) => normaliseUrl(entry.product.url))),
      );

      for (const entry of missingPrice) {
        const card = priceMap.get(normaliseUrl(entry.product.url));
        if (card && card.price > 0) {
          entry.product.price = card.price;
          entry.product.msrp = card.msrp;
          entry.apiPrice = card.price;
          recovered++;
        }
      }
    }

    // A listing with no price anywhere is a "call for price" entry, not an
    // offer. Report it; never invent a number for it.
    const priceless = [...staged.values()].filter((s) => s.product.price <= 0);
    const products = [...staged.values()]
      .filter((s) => s.product.price > 0)
      .map((s) => s.product);

    if (verbose && (recovered > 0 || priceless.length > 0)) {
      console.log(
        `   [${config.source}] recovered ${recovered} prices from HTML; ` +
          `${priceless.length} listings have no published price and were excluded.`,
      );
    }

    return {
      source: config.source,
      success: true,
      itemsCount: products.length,
      products,
      durationMs: Date.now() - startTime,
      pagesFetched,
      reportedTotal,
      skippedNonRacket,
      notes:
        priceless.length > 0
          ? [`${priceless.length} listings publish no price ("liên hệ") and were excluded from offers.`]
          : undefined,
    };
  } catch (err) {
    return {
      source: config.source,
      success: false,
      itemsCount: 0,
      products: [],
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
