import { fetchWithRetry, JSON_HEADERS, pool } from "../scraper/http";
import { matchString } from "./catalogue";
import type { ScrapedStringOffer, StringScrapeResult, StringSource } from "./types";

export interface StringWooSite {
  source: StringSource;
  origin: string;
}

export const STRING_SITES: Record<StringSource, StringWooSite> = {
  fbshop: { source: "fbshop", origin: "https://fbshop.vn" },
  qvbadminton: { source: "qvbadminton", origin: "https://qvbadminton.com" },
  hvshop: { source: "hvshop", origin: "https://hvshop.vn" },
};

interface WooProduct {
  id: number;
  name: string;
  permalink: string;
  prices?: { price?: string; currency_minor_unit?: number };
  is_in_stock?: boolean;
  low_stock_remaining?: number | null;
}

export function parseWooStringProducts(source: StringSource, rows: WooProduct[], scrapedAt = new Date().toISOString()): {
  offers: ScrapedStringOffer[];
  unmatched: string[];
} {
  const byString = new Map<string, ScrapedStringOffer>();
  const unmatched: string[] = [];
  for (const row of rows) {
    const string = matchString(row.name);
    if (!string) {
      unmatched.push(row.name);
      continue;
    }
    const minor = row.prices?.currency_minor_unit ?? 0;
    const rawPrice = Number(row.prices?.price ?? 0);
    const price = Number.isFinite(rawPrice) ? Math.round(rawPrice / 10 ** minor) : 0;
    if (price <= 0 || !row.permalink) continue;
    const offer: ScrapedStringOffer = {
      source,
      externalId: String(row.id),
      title: row.name,
      stringId: string.id,
      brandSlug: string.brandSlug,
      stringSlug: string.slug,
      price,
      inStock: row.is_in_stock !== false,
      qtyAvailable: row.is_in_stock === false ? 0 : Math.max(1, row.low_stock_remaining ?? 1),
      url: row.permalink,
      scrapedAt,
    };
    const existing = byString.get(string.id);
    // A shop can list several colours/reel sizes under the same model. The DB
    // intentionally has one offer per seller and string, so retain the lowest
    // in-stock listing (or an out-of-stock listing if that is all we saw).
    if (!existing || (offer.inStock && !existing.inStock) || (offer.inStock === existing.inStock && offer.price < existing.price)) {
      byString.set(string.id, offer);
    }
  }
  return { offers: [...byString.values()], unmatched };
}

export async function scrapeWooStrings(site: StringWooSite, options: { concurrency?: number; delayMs?: number; timeoutMs?: number; verbose?: boolean } = {}): Promise<StringScrapeResult> {
  // Separate searches avoid depending on retailer-specific category ids and
  // cover both Vietnamese naming conventions used by these shops.
  const terms = ["cước cầu lông", "dây cước cầu lông", "badminton string"];
  const seen = new Map<number, WooProduct>();
  try {
    for (const term of terms) {
      const url = (page: number) => `${site.origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}&search=${encodeURIComponent(term)}`;
      const first = await fetchWithRetry(url(1), { headers: JSON_HEADERS, timeoutMs: options.timeoutMs, verbose: options.verbose });
      if (!first.ok) throw new Error(`Store API returned HTTP ${first.status}`);
      for (const row of JSON.parse(first.body) as WooProduct[]) seen.set(row.id, row);
      const lastPage = Number(first.headers.get("x-wp-totalpages")) || 1;
      const remaining = Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => index + 2);
      const responses = await pool(remaining, options.concurrency ?? 2, options.delayMs ?? 250, (page) =>
        fetchWithRetry(url(page), { headers: JSON_HEADERS, timeoutMs: options.timeoutMs, verbose: options.verbose }));
      for (const response of responses) {
        if (!response.ok) throw new Error(`Store API returned HTTP ${response.status}`);
        for (const row of JSON.parse(response.body) as WooProduct[]) seen.set(row.id, row);
      }
    }
    const parsed = parseWooStringProducts(site.source, [...seen.values()]);
    return { source: site.source, success: true, offers: parsed.offers, productsExamined: seen.size, unmatched: parsed.unmatched };
  } catch (error) {
    return { source: site.source, success: false, offers: [], productsExamined: seen.size, unmatched: [], error: error instanceof Error ? error.message : String(error) };
  }
}
