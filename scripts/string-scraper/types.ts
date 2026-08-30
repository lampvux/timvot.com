export type StringSource = "fbshop" | "qvbadminton" | "hvshop";

export interface ScrapedStringOffer {
  source: StringSource;
  externalId: string;
  title: string;
  stringId: string;
  brandSlug: string;
  stringSlug: string;
  price: number;
  inStock: boolean;
  qtyAvailable: number;
  url: string;
  scrapedAt: string;
}

export interface StringScrapeResult {
  source: StringSource;
  success: boolean;
  offers: ScrapedStringOffer[];
  productsExamined: number;
  unmatched: string[];
  error?: string;
}
