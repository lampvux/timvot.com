import * as cheerio from "cheerio";
import { detectBrand, slugify } from "../normalizer";
import { isRacketListing } from "../classify";
import { pool } from "../http";
import { parseVnbListing, VNB_META } from "../sites/vnb";
import { parseWooCatalogueHtml, WOO_SITES } from "../sites/woocommerce";
import { woocommerceHtmlGallery, type GalleryImage } from "./gallery";
import { modelSlugOf, type RacketTarget } from "./targets";

export const RETAILERS = ["vnb", "fbshop", "qvbadminton", "hvshop"] as const;
export type Retailer = (typeof RETAILERS)[number];
export const RETAILER_ORIGINS: Record<Retailer, string> = {
  vnb: VNB_META.origin,
  fbshop: WOO_SITES.fbshop.origin,
  qvbadminton: WOO_SITES.qvbadminton.origin,
  hvshop: WOO_SITES.hvshop.origin,
};

export interface RetailerProduct {
  site: Retailer;
  url: string;
  title: string;
  brandSlug: string;
  modelKey: string;
  images: GalleryImage[];
}
export interface RetailerDiscovery {
  site: Retailer;
  products: RetailerProduct[];
  pagesRead: number;
  complete: boolean;
  error?: string;
}
export interface PageResponse {
  body: string;
  headers: Headers;
}
export type ReadRetailerPage = (url: string) => Promise<PageResponse>;

/** Only this site's public product pages and its observed image CDN are fetched. */
export function retailerUrl(raw: string, site: Retailer, image = false): string | null {
  try {
    const url = new URL(raw, RETAILER_ORIGINS[site]);
    const host = new URL(RETAILER_ORIGINS[site]).hostname;
    const hosts = new Set([host, `www.${host}`]);
    if (image && site === "vnb") hosts.add("cdn.shopvnb.com");
    if (image && site === "fbshop") hosts.add("static.fbshop.vn");
    if (url.protocol !== "https:" || url.port || url.username || url.password || !hosts.has(url.hostname)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Preserve editions, player names, years, colours, and version suffixes. */
export function retailerModelKey(title: string, brandSlug: string): string {
  let key = slugify(title.split("|")[0])
    .replace(/^(?:vot-cau-long|vot|badminton-racket)-/, "")
    .replace(/(?:^|-)(?:chinh-hang|hang-noi-dia)(?=-|$)/g, "")
    .replace(/(?:^|-)(?:[2-9]u|g[4-6])(?=-|$)/g, "")
    .replace(/^-+|-+$/g, "");
  const brands = brandSlug === "li-ning" ? ["li-ning", "lining"] : [brandSlug];
  for (const brand of brands) {
    if (key.startsWith(`${brand}-`)) key = key.slice(brand.length + 1);
  }
  // Punctuation/spacing is not a model distinction: 88D and 88 D, A09.1 and A09-1.
  return key.replace(/-/g, "");
}

export function retailerProduct(site: Retailer, title: string, rawUrl: string, images: GalleryImage[] = []): RetailerProduct | null {
  const url = retailerUrl(rawUrl, site);
  if (!url || !isRacketListing(title)) return null;
  const brand = detectBrand(title);
  if (brand.slug === "other") return null;
  return { site, url, title, brandSlug: brand.slug, modelKey: retailerModelKey(title, brand.slug), images };
}

export function parseRetailerGallery(html: string, pageUrl: string, site: Retailer): GalleryImage[] {
  const $ = cheerio.load(html);
  const candidates: GalleryImage[] = site === "vnb" || site === "fbshop" ? [] : woocommerceHtmlGallery(html, pageUrl);
  const selector = site === "vnb" ? "#lightgallery a[href]" : site === "fbshop" ? ".prddt-slider-main .gItem[data-src]" : null;
  if (selector) {
    $(selector).each((_, element) => {
      const raw = $(element).attr(site === "vnb" ? "href" : "data-src");
      if (raw) candidates.push({ url: raw, position: candidates.length });
    });
  }
  const unique = new Map<string, GalleryImage>();
  for (const image of candidates) {
    const url = retailerUrl(image.url, site, true);
    if (url && !/placeholder|logo|spinner/i.test(new URL(url).pathname)) unique.set(url, { ...image, url });
  }
  return [...unique.values()].map((image, position) => ({ ...image, position }));
}

/** Walk every catalogue page, including out-of-stock and price-on-request products. */
export async function discoverRetailer(
  site: Retailer,
  read: ReadRetailerPage,
  options: { deferProductPages?: boolean; titleHints?: RetailerProduct[] } = {},
): Promise<RetailerDiscovery> {
  const result: RetailerDiscovery = { site, products: [], pagesRead: 0, complete: false };
  const products = new Map<string, RetailerProduct>();
  const add = (product: RetailerProduct | null) => { if (product) products.set(product.url, product); };
  try {
    if (site === "fbshop") {
      // FBShop disallows /wp-json in robots.txt and its category pages return
      // 410 past page 49 despite advertising 164 pages. Its public product
      // sitemaps enumerate the entire catalogue. Read each racket's own title;
      // URL slugs often contain old marketing copy or an obsolete model name.
      const index = await read(`${RETAILER_ORIGINS.fbshop}/sitemap_index.xml`);
      result.pagesRead++;
      const $index = cheerio.load(index.body, { xml: true });
      const sitemaps = $index("sitemap > loc").map((_, element) => $index(element).text().trim()).get()
        .filter((url) => retailerUrl(url, site) && /\/product-sitemap\d*\.xml$/.test(url));
      if (!sitemaps.length) throw new Error("No public product sitemaps found");
      const urls = new Set<string>();
      for (const sitemap of sitemaps) {
        const response = await read(sitemap);
        result.pagesRead++;
        const $ = cheerio.load(response.body, { xml: true });
        for (const raw of $("url > loc").map((_, element) => $(element).text().trim()).get()) {
          const url = retailerUrl(raw, site);
          if (url && /\/p\/vot-(?:cau-long-)?/.test(new URL(url).pathname)) urls.add(url);
        }
      }
      if (!urls.size) throw new Error("Product sitemaps contained no racket URLs");
      if (options.deferProductPages) {
        // Enumerate every URL now, but read galleries only for matched rackets.
        // Historical titles are hints, never authority: the backfill verifies
        // the live h1 before using any image. Without a hint, a strict slug
        // match nominates the page. This avoids crawling thousands of unrelated
        // products a second time before the actual image pass.
        const hints = new Map((options.titleHints ?? []).map((product) => [product.url, product.title]));
        for (const url of urls) {
          const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "").replaceAll("-", " ");
          add(retailerProduct(site, hints.get(url) ?? name, url));
        }
        result.products = [...products.values()];
        result.complete = true;
        return result;
      }
      const failures: string[] = [];
      let done = 0;
      await pool([...urls], 3, 0, async (url) => {
        try {
          const response = await read(url);
          result.pagesRead++;
          const $ = cheerio.load(response.body);
          add(retailerProduct(site, $("h1").first().text().trim(), url, parseRetailerGallery(response.body, url, site)));
        } catch (error) {
          failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
        done++;
        if (done % 100 === 0) console.log(`fbshop: read ${done}/${urls.size} sitemap product pages`);
      });
      if (failures.length) throw new Error(`${failures.length} product pages unreadable; ${failures.slice(0,3).join("; ")}`);
    } else if (site !== "vnb") {
      const config = WOO_SITES[site];
      let lastPage = 1;
      let apiWorked = false;
      try {
        const seenPages = new Set<string>();
        for (let page = 1; page <= lastPage; page++) {
          const response = await read(`${config.origin}/wp-json/wc/store/v1/products?per_page=${config.pageSize}&page=${page}&category=${config.categoryId}&orderby=id&order=asc`);
          result.pagesRead++;
          const rows = JSON.parse(response.body) as { id: number; name: string; permalink: string; images?: { src: string }[] }[];
          if (!Array.isArray(rows)) throw new Error("Store API did not return a product array");
          const advertised = Number(response.headers.get("x-wp-totalpages"));
          if (!Number.isSafeInteger(advertised) || advertised < 1 || advertised > 1000) throw new Error("Missing or invalid Store API pagination");
          lastPage = advertised;
          const signature = rows.map((row) => row.id).join(",");
          if (!signature || seenPages.has(signature)) throw new Error(`Repeated/empty API page ${page}`);
          seenPages.add(signature);
          for (const row of rows) add(retailerProduct(site, row.name, row.permalink, (row.images ?? []).flatMap((image, position) => {
            const url = retailerUrl(image.src, site, true);
            return url ? [{ url, position }] : [];
          })));
        }
        apiWorked = true;
      } catch (error) {
        // Recover through public HTML only when the API was unavailable from the outset.
        if (products.size) throw error;
      }
      if (!apiWorked) {
        let lastPage = 1;
        const seenPages = new Set<string>();
        for (let page = 1; page <= lastPage; page++) {
          const response = await read(page === 1 ? config.categoryUrl : `${config.categoryUrl}page/${page}/`);
          result.pagesRead++;
          const cards = parseWooCatalogueHtml(response.body);
          if (!cards.length) throw new Error(`No product cards on HTML page ${page}`);
          const signature = cards.map((card) => card.url).join(",");
          if (seenPages.has(signature)) throw new Error(`Repeated HTML page ${page}`);
          seenPages.add(signature);
          const advertised = [...response.body.matchAll(/\/page\/(\d+)\//g)].map((match) => Number(match[1]));
          lastPage = Math.max(lastPage, ...advertised);
          if (lastPage > 1000) throw new Error("Unexpected HTML pagination size");
          for (const card of cards) add(retailerProduct(site, card.title, card.url));
        }
      }
    } else {
      const seenPages = new Set<string>();
      for (let page = 1; page <= 1000; page++) {
        const response = await read(page === 1 ? VNB_META.categoryUrl : `${VNB_META.categoryUrl}?page=${page}`);
        result.pagesRead++;
        if (page % 50 === 0) console.log(`vnb: read ${page} catalogue pages`);
        const parsed = parseVnbListing(response.body, page);
        const signature = parsed.products.map((product) => product.url).join(",");
        if (!parsed.cardsSeen) {
          if (page === 1) throw new Error("No VNB product cards");
          break;
        }
        if (signature && seenPages.has(signature)) break; // VNB clamps past its final page.
        if (signature) seenPages.add(signature);
        for (const product of parsed.products) add(retailerProduct(site, product.rawTitle, product.url));
        if (page === 1000) throw new Error("VNB pagination did not terminate");
      }
    }
    result.complete = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  result.products = [...products.values()];
  return result;
}

export interface RetailerTarget extends RacketTarget {
  sites: { site: Retailer; pages: RetailerProduct[]; discoveryComplete: boolean; error?: string }[];
}

/** Match all catalogued rackets before filtering missing ones, so pages cannot be stolen. */
export function planRetailerTargets(rackets: RacketTarget[], imagedIds: Set<string>, discoveries: RetailerDiscovery[], ownedPages: Map<string, string>): RetailerTarget[] {
  const owners = new Map<string, RacketTarget[]>();
  for (const racket of rackets) {
    const keys = new Set([retailerModelKey(racket.name, racket.brandSlug), retailerModelKey(modelSlugOf(racket.slug, racket.brandSlug), racket.brandSlug)]);
    for (const key of keys) {
      const identity = `${racket.brandSlug}/${key}`;
      owners.set(identity, [...(owners.get(identity) ?? []), racket]);
    }
  }
  const pagesByRacket = new Map<string, RetailerProduct[]>();
  for (const discovery of discoveries) {
    for (const product of discovery.products) {
      const claims = owners.get(`${product.brandSlug}/${product.modelKey}`) ?? [];
      if (claims.length !== 1) continue; // Ambiguity is a miss, never a fuzzy assignment.
      const racket = claims[0];
      const owner = ownedPages.get(product.url);
      if (owner && !racket.equivalentIds.includes(owner)) continue;
      pagesByRacket.set(racket.id, [...(pagesByRacket.get(racket.id) ?? []), product]);
    }
  }
  return rackets.filter((racket) => !racket.equivalentIds.some((id) => imagedIds.has(id))).map((racket) => ({
    ...racket,
    sites: RETAILERS.map((site) => {
      const discovery = discoveries.find((result) => result.site === site);
      return { site, pages: (pagesByRacket.get(racket.id) ?? []).filter((page) => page.site === site), discoveryComplete: discovery?.complete ?? false, error: discovery?.error ?? (!discovery ? "Source was not checked" : undefined) };
    }),
  }));
}

/** Each source gets its own budget; one large gallery cannot crowd out another. */
export function interleaveRetailerImages<T>(groups: T[][], maxPerSite: number): T[] {
  const output: T[] = [];
  for (let index = 0; index < maxPerSite; index++) {
    for (const group of groups) if (index < group.length) output.push(group[index]);
  }
  return output;
}
