export type ScraperSource = "vnb" | "qvbadminton" | "fbshop" | "hvshop" | "shopee";

export interface ScrapedProductSpecs {
  weightClass?: "2U" | "3U" | "4U" | "5U";
  gripSize?: "G4" | "G5" | "G6";
  shaftFlex?: "extra-stiff" | "stiff" | "medium" | "flexible";
  balancePointMm?: number;
  maxTensionLbs?: [number, number];
  lengthMm?: number;
}

export interface ScrapedProduct {
  source: ScraperSource;
  externalId?: string;
  rawTitle: string;
  brand?: string;
  modelName?: string;
  price: number;
  msrp?: number;
  inStock: boolean;
  qtyAvailable?: number;
  url: string;
  imageUrl?: string;
  specs?: ScrapedProductSpecs;
  /** Category slugs the source site filed this product under, when known. */
  categorySlugs?: string[];
  /** Page of the listing this product came from, for provenance in the report. */
  sourcePage?: number;
  scrapedAt: string;
}

export interface ScraperOptions {
  /** Hard cap on listing pages. `Infinity` walks the whole catalogue. */
  maxPages?: number;
  categoryUrl?: string;
  searchQuery?: string;
  timeoutMs?: number;
  verbose?: boolean;
  /** Requests in flight per site. */
  concurrency?: number;
  /** Minimum gap between dispatches, in ms. */
  delayMs?: number;
}

export interface ScraperResult {
  source: ScraperSource;
  success: boolean;
  itemsCount: number;
  products: ScrapedProduct[];
  error?: string;
  durationMs: number;
  /** Listing pages actually fetched. */
  pagesFetched?: number;
  /** Total the site itself claims for the category, when it reports one. */
  reportedTotal?: number;
  /** Items dropped as non-rackets (bags, strings, grips). */
  skippedNonRacket?: number;
  /** Non-fatal observations worth printing next to a successful result. */
  notes?: string[];
}
