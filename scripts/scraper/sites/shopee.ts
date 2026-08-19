/**
 * Shopee.
 *
 * The previous version of this file pushed three hard-coded products —
 * "Yonex Astrox 88D Pro / 3.390.000₫" and friends — into the result set
 * whenever the API call failed, which it always does. Those invented prices
 * then flowed through the normalizer into `offers` and `price_points` and would
 * have been shown to users as a real seller's real price on a price-comparison
 * site. That fallback is removed. A blocked source now reports itself as
 * blocked and contributes nothing.
 *
 * Shopee's search API answers 403 with error 90309999 to any request that does
 * not carry a browser-issued device fingerprint. Working around that means
 * defeating their bot protection, which is not something this scraper does. The
 * source stays wired up so that it starts working if access is ever granted
 * (an official Shopee Open Platform API key is the supported route), but until
 * then it returns zero products and an explicit reason.
 */

import { fetchWithRetry, JSON_HEADERS, cleanText } from "../http";
import type { ScrapedProduct, ScraperOptions, ScraperResult } from "../types";

const SHOPEE_SEARCH_API = "https://shopee.vn/api/v4/search/search_items";
/** Shopee reports prices scaled by 100000. */
const SHOPEE_PRICE_SCALE = 100_000;

interface ShopeeItem {
  itemid?: number;
  shopid?: number;
  name?: string;
  price?: number;
  price_min?: number;
  price_before_discount?: number;
  stock?: number;
  image?: string;
}

export async function scrapeShopee(options: ScraperOptions = {}): Promise<ScraperResult> {
  const startTime = Date.now();
  const verbose = Boolean(options.verbose);
  const timeoutMs = options.timeoutMs ?? 20000;
  const keyword = options.searchQuery || "vợt cầu lông";
  const maxPages = Number.isFinite(options.maxPages) ? (options.maxPages as number) : 10;
  const products: ScrapedProduct[] = [];

  const headers = {
    ...JSON_HEADERS,
    "x-shopee-language": "vi",
    Referer: `https://shopee.vn/search?keyword=${encodeURIComponent(keyword)}`,
  };

  try {
    for (let page = 0; page < maxPages; page++) {
      const url =
        `${SHOPEE_SEARCH_API}?by=relevance&keyword=${encodeURIComponent(keyword)}` +
        `&limit=60&newest=${page * 60}&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;

      const res = await fetchWithRetry(url, { headers, timeoutMs, retries: 1, verbose });

      if (!res.ok) {
        return {
          source: "shopee",
          success: false,
          itemsCount: products.length,
          products,
          error:
            `Shopee search API refused the request (HTTP ${res.status}). Shopee gates this ` +
            `endpoint behind browser device attestation; scraping it requires an official ` +
            `Shopee Open Platform key. No products recorded for this source.`,
          durationMs: Date.now() - startTime,
          pagesFetched: page + 1,
        };
      }

      let data: { items?: { item_basic?: ShopeeItem }[] };
      try {
        data = JSON.parse(res.body);
      } catch {
        return {
          source: "shopee",
          success: false,
          itemsCount: products.length,
          products,
          error: "Shopee returned a non-JSON body (anti-bot interstitial).",
          durationMs: Date.now() - startTime,
          pagesFetched: page + 1,
        };
      }

      const items = data.items || [];
      if (items.length === 0) break;

      for (const entry of items) {
        const item = entry.item_basic || (entry as ShopeeItem);
        if (!item?.name || !item.itemid || !item.shopid) continue;

        const price = Math.round((item.price ?? item.price_min ?? 0) / SHOPEE_PRICE_SCALE);
        if (price <= 0) continue;
        const msrp = Math.round((item.price_before_discount ?? 0) / SHOPEE_PRICE_SCALE);

        products.push({
          source: "shopee",
          externalId: `${item.shopid}_${item.itemid}`,
          rawTitle: cleanText(item.name),
          price,
          msrp: msrp > price ? msrp : price,
          inStock: (item.stock ?? 0) > 0,
          qtyAvailable: item.stock,
          url: `https://shopee.vn/product/${item.shopid}/${item.itemid}`,
          imageUrl: item.image
            ? `https://down-vn.img.susercontent.com/file/${item.image}`
            : undefined,
          sourcePage: page + 1,
          scrapedAt: new Date().toISOString(),
        });
      }
    }

    return {
      source: "shopee",
      success: true,
      itemsCount: products.length,
      products,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      source: "shopee",
      success: false,
      itemsCount: products.length,
      products,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
