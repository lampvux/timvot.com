/**
 * shopvnb.com runs a bespoke PHP storefront, not WooCommerce, so there is no
 * Store API to lean on and the HTML is the only source.
 *
 * Two things the previous version got wrong, both worth naming:
 *
 * 1. The card selector included `div[class*='product']`, which matches the grid
 *    wrapper as well as each card. Cheerio then returned the wrapper first and
 *    `.text()` concatenated every title on the page into one "product".
 * 2. Hrefs on this site are relative without a leading slash
 *    (`vot-cau-long-vnb-v88.html`), so `origin + href` produced
 *    `https://shopvnb.comvot-cau-long-vnb-v88.html`. Every scraped URL was dead.
 *
 * Pagination is `?page=N`. The site renders a windowed pager driven by
 * `onclick="doSearch(n)"` rather than real links, so we walk until a page comes
 * back with no cards, and also stop if a page repeats the previous page's items
 * (the server clamps rather than 404s past the end).
 */

import * as cheerio from "cheerio";
import { fetchWithRetry, sleep, HTML_HEADERS, cleanText, parseVndPrice } from "../http";
import { isRacketListing } from "../classify";
import type { ScrapedProduct, ScraperOptions, ScraperResult } from "../types";

const VNB_ORIGIN = "https://shopvnb.com";
const VNB_CATEGORY_URL = `${VNB_ORIGIN}/vot-cau-long.html`;

export function resolveVnbUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `${VNB_ORIGIN}/${href.replace(/^\/+/, "")}`;
}

export interface VnbPageParse {
  products: ScrapedProduct[];
  /** Cards present on the page, before the racket filter. */
  cardsSeen: number;
  /** Cards dropped as accessories or bundles. */
  skipped: number;
}

/** Parse one listing page's markup. Exported so verification can reuse it. */
export function parseVnbListing(html: string, page: number): VnbPageParse {
  const $ = cheerio.load(html);
  const products: ScrapedProduct[] = [];
  let cardsSeen = 0;
  let skipped = 0;

  // One card, and only one card. `.item_product_main` is the card root; the
  // grid wrapper above it is `.col-6.col-md-3`, which we deliberately skip.
  $(".item_product_main").each((_, el) => {
    cardsSeen++;
    const $el = $(el);
    const $link = $el.find(".product-name a").first();

    // The `title` attribute holds the clean name; the text node can carry
    // theme whitespace. Prefer the attribute, fall back to the text.
    const title = cleanText($link.attr("title") || $link.text());
    const href = $link.attr("href") || $el.find("a.product_overlay").attr("href") || "";
    if (!title || !href) return;

    if (!isRacketListing(title)) {
      skipped++;
      return;
    }

    // Scope the price read to the price box so a "compare at" or badge value
    // elsewhere in the card cannot win.
    const $priceBox = $el.find(".price-box");
    const price = parseVndPrice($priceBox.find(".price").first().text());
    const compareAt = parseVndPrice($priceBox.find(".compare-price, .price-del, del").first().text());

    if (price <= 0) return;

    const $img = $el.find(".image_thumb img").first();
    const imgSrc = $img.attr("data-src") || $img.attr("src");

    const cardText = $el.text().toLowerCase();

    products.push({
      source: "vnb",
      // The product slug is stable and unique on this site.
      externalId: href.replace(/\.html$/, "").replace(/^\/+/, ""),
      rawTitle: title,
      price,
      msrp: compareAt > price ? compareAt : price,
      inStock: !cardText.includes("hết hàng") && !cardText.includes("liên hệ"),
      url: resolveVnbUrl(href),
      imageUrl: imgSrc
        ? imgSrc.startsWith("http")
          ? imgSrc
          : `${VNB_ORIGIN}/${imgSrc.replace(/^\/+/, "")}`
        : undefined,
      sourcePage: page,
      scrapedAt: new Date().toISOString(),
    });
  });

  return { products, cardsSeen, skipped };
}

export async function scrapeVnb(options: ScraperOptions = {}): Promise<ScraperResult> {
  const startTime = Date.now();
  const verbose = Boolean(options.verbose);
  const timeoutMs = options.timeoutMs ?? 30000;
  const delayMs = options.delayMs ?? 250;
  const maxPages = options.maxPages ?? Infinity;

  const byExternalId = new Map<string, ScrapedProduct>();
  let pagesFetched = 0;
  let skippedNonRacket = 0;

  try {
    let previousPageIds = "";

    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = page === 1 ? VNB_CATEGORY_URL : `${VNB_CATEGORY_URL}?page=${page}`;

      const res = await fetchWithRetry(pageUrl, {
        headers: HTML_HEADERS,
        timeoutMs,
        verbose,
        signal: options.signal,
      });
      pagesFetched++;

      if (!res.ok) {
        if (verbose) console.log(`   [vnb] page ${page}: HTTP ${res.status} — stopping.`);
        break;
      }

      const parsed = parseVnbListing(res.body, page);
      const pageProducts = parsed.products;
      skippedNonRacket += parsed.skipped;

      // No cards at all means we walked past the last page. Check the raw card
      // count, not the filtered one: a page of nothing but accessories is still
      // a real page and the catalogue continues past it.
      if (parsed.cardsSeen === 0) {
        if (verbose) console.log(`   [vnb] page ${page}: no products — end of catalogue.`);
        break;
      }

      // The server clamps out-of-range pages to the last real one rather than
      // 404ing, so an identical page means we are done.
      const pageIds = pageProducts.map((p) => p.externalId).join("|");
      if (pageIds !== "" && pageIds === previousPageIds) {
        if (verbose) console.log(`   [vnb] page ${page} repeats page ${page - 1} — end of catalogue.`);
        break;
      }
      previousPageIds = pageIds;

      let newOnThisPage = 0;
      for (const product of pageProducts) {
        if (!byExternalId.has(product.externalId!)) newOnThisPage++;
        byExternalId.set(product.externalId!, product);
      }

      if (verbose && page % 20 === 0) {
        console.log(`   [vnb] page ${page} — ${byExternalId.size} rackets so far`);
      }

      // Every product on this page was already seen: the listing is cycling.
      if (newOnThisPage === 0 && pageProducts.length > 0 && page > 1) {
        if (verbose) console.log(`   [vnb] page ${page} added nothing new — stopping.`);
        break;
      }

      if (delayMs > 0) await sleep(delayMs);
    }

    const products = [...byExternalId.values()];

    return {
      source: "vnb",
      success: true,
      itemsCount: products.length,
      products,
      durationMs: Date.now() - startTime,
      pagesFetched,
      skippedNonRacket,
    };
  } catch (err) {
    const products = [...byExternalId.values()];
    return {
      source: "vnb",
      success: false,
      itemsCount: products.length,
      products,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
      pagesFetched,
    };
  }
}

export const VNB_META = { origin: VNB_ORIGIN, categoryUrl: VNB_CATEGORY_URL };
