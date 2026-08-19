/**
 * Building each provider's candidate URL list from its sitemap.
 *
 * One request per sitemap per run, cached on disk between runs. The alternative
 * — hitting the site's search once per racket — is both forbidden by these
 * sites' robots.txt and roughly six hundred requests where this is two.
 *
 * Index sitemaps are followed one level, which is enough for both providers and
 * is where it stops on purpose: a sitemap that points at sitemaps that point at
 * sitemaps is a crawl budget, not a lookup.
 */

import * as cheerio from "cheerio";
import { gunzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { cleanText, fetchWithRetry, fetchBinary, HTML_HEADERS, JSON_HEADERS, sleep } from "../http";
import { isAllowed, robotsFor, type RobotsPolicy } from "../robots";
import { slugOfUrl, type MatchCandidate } from "./match";
import { parseShopifyProductJson, parseWooProductJson, type GalleryImage } from "./gallery";
import type { CatalogueSource, ProviderConfig } from "./providers";
import type { BrowserSession } from "./browser";

const CACHE_DIR = "scripts/scraper/output/sitemaps";

export interface DiscoveryResult {
  provider: string;
  candidates: MatchCandidate[];
  /** Every URL the sitemap held, before `productUrlPattern` filtered it. */
  urlsSeen: number;
  fromCache: boolean;
  error?: string;
}

function cachePath(providerId: string): string {
  return resolve(process.cwd(), CACHE_DIR, `${providerId}.json`);
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) =>
    match[1].replace(/&amp;/g, "&").trim(),
  );
}

function isIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Fetch one sitemap, transparently gunzipping `.xml.gz`. */
async function fetchSitemap(url: string, userAgent: string, timeoutMs: number): Promise<string> {
  const headers = { ...HTML_HEADERS, "User-Agent": userAgent };

  if (/\.gz(?:$|\?)/i.test(url)) {
    const res = await fetchBinary(url, { headers, timeoutMs });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return gunzipSync(Buffer.from(res.body)).toString("utf8");
  }

  const res = await fetchWithRetry(url, { headers, timeoutMs });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.body;
}

export interface DiscoverOptions {
  userAgent: string;
  timeoutMs: number;
  delayMs: number;
  /** Ignore the on-disk cache and re-read every sitemap. */
  refresh: boolean;
  verbose: boolean;
  /** Supplied only when some selected provider needs rendering. */
  browser?: BrowserSession;
}

/**
 * Strip the merchandising a shop wraps around a model name.
 *
 * Entities are decoded first: the WooCommerce Store API serialises names as
 * stored, so "Dual - Power & Speed" arrives as "Dual Power &amp; Speed" and
 * tokenises to an `amp` that matches nothing.
 */
function cleanTitle(title: string, provider: ProviderConfig): string {
  let text = cleanText(title);
  for (const pattern of provider.titleNoise ?? []) text = text.replace(pattern, " ");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Read a WooCommerce shop's public Store API.
 *
 * The category is resolved by slug first, because the numeric id is per-install
 * and hard-coding it makes the config a liability the first time the shop
 * reorganises its taxonomy. Everything after that is straight pagination, with
 * the product's own image list coming back in the same payload.
 */
async function discoverWooCommerce(
  provider: ProviderConfig,
  source: Extract<CatalogueSource, { kind: "woocommerce-store" }>,
  options: DiscoverOptions,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  const headers = { ...JSON_HEADERS, "User-Agent": options.userAgent };

  const categoriesUrl = `${provider.origin}/wp-json/wc/store/v1/products/categories?per_page=100`;
  const catRes = await fetchWithRetry(categoriesUrl, { headers, timeoutMs: options.timeoutMs });
  if (!catRes.ok) throw new Error(`categories: HTTP ${catRes.status}`);

  const categories = JSON.parse(catRes.body) as { id: number; slug: string; count: number }[];
  const wanted = source.categorySlugs
    .map((slug) => categories.find((c) => c.slug === slug))
    .filter((c): c is { id: number; slug: string; count: number } => Boolean(c));

  if (wanted.length === 0) {
    throw new Error(`none of [${source.categorySlugs.join(", ")}] is a category on this shop`);
  }

  if (options.verbose) {
    for (const c of wanted) {
      console.log(`   [${provider.id}] category ${c.slug} = id ${c.id}, ${c.count} products`);
    }
  }

  interface WooProduct {
    id: number;
    name: string;
    slug: string;
    permalink: string;
    images?: { src?: string; name?: string }[];
  }

  // Keyed by permalink: a shop that files one racket under two of the
  // categories we asked for should still yield one candidate.
  const byUrl = new Map<string, MatchCandidate>();
  let seen = 0;

  for (const category of wanted) {
    let page = 1;
    let lastPage = 1;

    do {
      if (seen > 0) await sleep(Math.max(options.delayMs, provider.politenessMs ?? 0));

      const url =
        `${provider.origin}/wp-json/wc/store/v1/products` +
        `?per_page=${source.pageSize}&page=${page}&category=${category.id}`;
      const res = await fetchWithRetry(url, { headers, timeoutMs: options.timeoutMs });
      if (!res.ok) throw new Error(`products page ${page}: HTTP ${res.status}`);

      if (page === 1) lastPage = Number(res.headers.get("x-wp-totalpages")) || 1;

      const items = JSON.parse(res.body) as WooProduct[];
      if (!Array.isArray(items) || items.length === 0) break;

      for (const item of items) {
        seen++;
        if (byUrl.has(item.permalink)) continue;

        // Reuse the same parser the retailer WooCommerce scraper uses, so the
        // notion of "what counts as an image on a Woo product" lives in one place.
        const images = parseWooProductJson(JSON.stringify([item]), item.permalink);
        if (images.length === 0) continue;

        byUrl.set(item.permalink, {
          url: item.permalink,
          slug: slugOfUrl(item.permalink) || item.slug,
          title: cleanTitle(item.name, provider),
          images,
        });
      }

      page++;
    } while (page <= lastPage);
  }

  return { candidates: [...byUrl.values()], urlsSeen: seen };
}

/**
 * Read a Shopify storefront's public collection JSON.
 *
 * `products.json` is unauthenticated and returns the whole product including
 * its media list. Collections leak — Mizuno's "men's badminton rackets" also
 * holds grips and jackets — so `productTypePattern` filters on the shop's own
 * `product_type` rather than on a guess from the title.
 */
async function discoverShopify(
  provider: ProviderConfig,
  source: Extract<CatalogueSource, { kind: "shopify-collection" }>,
  options: DiscoverOptions,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  const headers = { ...JSON_HEADERS, "User-Agent": options.userAgent };

  interface ShopifyProduct {
    handle: string;
    title: string;
    product_type?: string;
    images?: { src?: string; position?: number }[];
  }

  const byHandle = new Map<string, MatchCandidate>();
  let seen = 0;

  for (const collection of source.collections) {
    for (let page = 1; page <= 10; page++) {
      if (seen > 0) await sleep(Math.max(options.delayMs, provider.politenessMs ?? 0));

      const url = `${provider.origin}/collections/${collection}/products.json?limit=250&page=${page}`;
      const res = await fetchWithRetry(url, { headers, timeoutMs: options.timeoutMs });
      if (!res.ok) break;

      let products: ShopifyProduct[];
      try {
        products = (JSON.parse(res.body) as { products?: ShopifyProduct[] }).products ?? [];
      } catch {
        break;
      }
      if (products.length === 0) break;

      for (const product of products) {
        seen++;
        if (source.productTypePattern && !source.productTypePattern.test(product.product_type ?? "")) {
          continue;
        }
        if (byHandle.has(product.handle)) continue;

        const productUrl = `${provider.origin}/products/${product.handle}`;
        const images = parseShopifyProductJson(
          JSON.stringify({ images: (product.images ?? []).map((i) => i.src).filter(Boolean) }),
          productUrl,
        );
        if (images.length === 0) continue;

        byHandle.set(product.handle, {
          url: productUrl,
          slug: product.handle,
          title: cleanTitle(product.title, provider),
          images,
        });
      }
    }
  }

  return { candidates: [...byHandle.values()], urlsSeen: seen };
}

/**
 * Walk a rendered category listing.
 *
 * Termination is by exhaustion rather than by reading the pager, because these
 * pagers are windowed: Yonex's page 1 links as far as page 5, page 4 links to
 * 6, page 5 links to 7. Trusting the first page's highest link stops three
 * pages early. Stopping when a page adds nothing new is both simpler and right,
 * and it also covers the server that clamps out-of-range pages to the last one
 * instead of 404ing.
 *
 * No gallery is collected here — these are links, and the provider's extractor
 * chain reads each product page afterwards.
 */
async function discoverCategoryPagination(
  provider: ProviderConfig,
  source: Extract<CatalogueSource, { kind: "category-pagination" }>,
  options: DiscoverOptions,
  robots: RobotsPolicy,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  const headers = { ...HTML_HEADERS, "User-Agent": options.userAgent };
  const delayMs = Math.max(options.delayMs, provider.politenessMs ?? 0, robots.crawlDelayMs);

  const byUrl = new Map<string, MatchCandidate>();
  let seen = 0;

  for (let page = 1; page <= source.maxPages; page++) {
    const url = page === 1 ? source.url : `${source.url}?${source.pageParam}=${page}`;
    if (!isAllowed(robots, url)) break;

    if (page > 1) await sleep(delayMs);

    const res = await fetchWithRetry(url, { headers, timeoutMs: options.timeoutMs });
    if (!res.ok) break;

    const $ = cheerio.load(res.body);
    let fresh = 0;

    $(source.linkSelector).each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      const absolute = href.startsWith("http") ? href : new URL(href, provider.origin).toString();
      const clean = absolute.split(/[?#]/)[0].replace(/\/+$/, "");
      seen++;
      if (byUrl.has(clean)) return;
      if (!isAllowed(robots, clean)) return;

      const title = cleanTitle($(el).text(), provider);
      byUrl.set(clean, { url: clean, slug: slugOfUrl(clean), title: title || undefined });
      fresh++;
    });

    if (options.verbose) {
      console.log(`   [${provider.id}] listing page ${page} → ${fresh} new (${byUrl.size} total)`);
    }

    // A page that adds nothing is either past the end or a clamped repeat.
    if (fresh === 0) break;
  }

  return { candidates: [...byUrl.values()], urlsSeen: seen };
}

/**
 * Read the 2beasy storefront API that victorsport.com runs on.
 *
 * A POST, because that is what the site's own grid does — the category page
 * ships no product links in its HTML at all. The response carries the display
 * name and a cover image per product; the cover is kept as a fallback, but the
 * product page is still read afterwards for the full gallery, since one cover
 * shot is not a gallery.
 */
async function discover2beasy(
  provider: ProviderConfig,
  source: Extract<CatalogueSource, { kind: "2beasy-category" }>,
  options: DiscoverOptions,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  const headers = {
    ...JSON_HEADERS,
    "User-Agent": options.userAgent,
    "Content-Type": "application/json",
    Referer: `${provider.origin}/`,
  };

  interface ApiProduct {
    productId: number;
    name?: string;
    urlKey?: string;
    sku?: string;
    imageUrl?: string;
  }

  const byUrl = new Map<string, MatchCandidate>();
  let seen = 0;
  let total = Infinity;

  for (let page = 1; (page - 1) * source.limit < total; page++) {
    if (page > 1) await sleep(Math.max(options.delayMs, provider.politenessMs ?? 0));

    const body = JSON.stringify({
      categoryId: source.categoryId,
      skip: (page - 1) * source.limit,
      page,
      limit: source.limit,
      sortType: "positionDesc",
      attributes: [],
      view: "grid",
    });

    const res = await fetchWithRetry(source.endpoint, {
      headers,
      timeoutMs: options.timeoutMs,
      method: "POST",
      body,
    });
    if (!res.ok) throw new Error(`productList page ${page}: HTTP ${res.status}`);

    const payload = JSON.parse(res.body) as { data?: { list?: ApiProduct[]; total?: number } };
    const list = payload.data?.list ?? [];
    if (page === 1) total = payload.data?.total ?? list.length;
    if (list.length === 0) break;

    for (const item of list) {
      seen++;
      if (!item.urlKey) continue;

      const url = `${source.productPathPrefix}${item.urlKey}`;
      if (byUrl.has(url)) continue;

      byUrl.set(url, {
        url,
        slug: slugOfUrl(url),
        title: item.name ? cleanTitle(item.name, provider) : undefined,
      });
    }

    if (options.verbose) {
      console.log(`   [${provider.id}] storefront API page ${page} → ${byUrl.size}/${total}`);
    }
  }

  return { candidates: [...byUrl.values()], urlsSeen: seen };
}


/**
 * Walk one or more sitemaps and keep the URLs that look like products.
 */
async function discoverSitemap(
  provider: ProviderConfig,
  source: Extract<CatalogueSource, { kind: "sitemap" }>,
  options: DiscoverOptions,
  robots: RobotsPolicy,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  const delayMs = Math.max(options.delayMs, provider.politenessMs ?? 0, robots.crawlDelayMs);

  // robots.txt may name sitemaps the registry does not. Take both.
  const queue = [...new Set([...source.sitemaps, ...robots.sitemaps])];
  const visited = new Set<string>();
  const urls: string[] = [];
  let followedIndex = false;

  while (queue.length > 0) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    if (!isAllowed(robots, sitemapUrl)) {
      if (options.verbose) console.log(`   [${provider.id}] robots.txt disallows ${sitemapUrl}`);
      continue;
    }

    if (visited.size > 1) await sleep(delayMs);

    const xml = await fetchSitemap(sitemapUrl, options.userAgent, options.timeoutMs);
    const locs = extractLocs(xml);

    if (isIndex(xml)) {
      // One level only. A sitemap that points at sitemaps that point at
      // sitemaps is a crawl budget, not a lookup.
      if (followedIndex) continue;
      followedIndex = true;
      for (const loc of locs) queue.push(loc);
      if (options.verbose) console.log(`   [${provider.id}] sitemap index → ${locs.length} sitemaps`);
      continue;
    }

    urls.push(...locs);
    if (options.verbose) console.log(`   [${provider.id}] ${sitemapUrl} → ${locs.length} urls`);
  }

  const seen = new Set<string>();
  const candidates: MatchCandidate[] = [];

  for (const url of urls) {
    const clean = url.split("#")[0];
    if (!source.productUrlPattern.test(clean)) continue;
    if (!isAllowed(robots, clean)) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);

    const slug = slugOfUrl(clean);
    if (slug) candidates.push({ url: clean, slug });
  }

  return { candidates, urlsSeen: urls.length };
}

/**
 * Render listing pages and take their product links.
 *
 * The slug is doing the work here: Mizuno's product URLs are
 * `/product-page/fortius-73-vt`, which is the model name spelled out, so no
 * title is needed for the match to be exact.
 */
async function discoverBrowserListing(
  provider: ProviderConfig,
  source: Extract<CatalogueSource, { kind: "browser-listing" }>,
  options: DiscoverOptions,
  robots: RobotsPolicy,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  if (!options.browser) {
    throw new Error("this provider needs a browser session and none was supplied");
  }

  const delayMs = Math.max(options.delayMs, provider.politenessMs ?? 0, robots.crawlDelayMs);
  const byUrl = new Map<string, MatchCandidate>();
  let seen = 0;

  for (const listing of source.urls) {
    if (!isAllowed(robots, listing)) continue;
    if (seen > 0) await sleep(delayMs);

    let links: string[];
    try {
      links = await options.browser.collectLinks(listing, source.productUrlPattern, options.timeoutMs);
    } catch (err) {
      if (options.verbose) {
        console.log(`   [${provider.id}] ${listing}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
      }
      continue;
    }

    let fresh = 0;
    for (const link of links) {
      seen++;
      const clean = link.split(/[?#]/)[0].replace(/\/+$/, "");
      if (byUrl.has(clean) || !isAllowed(robots, clean)) continue;
      byUrl.set(clean, { url: clean, slug: slugOfUrl(clean) });
      fresh++;
    }

    if (options.verbose) {
      const series = listing.split("/").pop();
      console.log(`   [${provider.id}] ${series} → ${fresh} rackets (${byUrl.size} total)`);
    }
  }

  return { candidates: [...byUrl.values()], urlsSeen: seen };
}

/** Run one declared source. */
function runSource(
  provider: ProviderConfig,
  source: CatalogueSource,
  options: DiscoverOptions,
  robots: RobotsPolicy,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  switch (source.kind) {
    case "browser-listing":
      return discoverBrowserListing(provider, source, options, robots);
    case "sitemap":
      return discoverSitemap(provider, source, options, robots);
    case "woocommerce-store":
      return discoverWooCommerce(provider, source, options);
    case "shopify-collection":
      return discoverShopify(provider, source, options);
    case "category-pagination":
      return discoverCategoryPagination(provider, source, options, robots);
    case "2beasy-category":
      return discover2beasy(provider, source, options);
    case "sitegiant-collection":
      // feletsports.com keeps its catalogue in the RSC flight payload rather
      // than behind a product API.
      return Promise.reject(new Error('catalogue kind "sitegiant-collection" is not implemented'));
  }
}

export async function discoverCandidates(
  provider: ProviderConfig,
  options: DiscoverOptions,
): Promise<DiscoveryResult> {
  const path = cachePath(provider.id);

  if (!options.refresh && existsSync(path)) {
    try {
      const cached = JSON.parse(readFileSync(path, "utf8")) as {
        candidates: MatchCandidate[];
        urlsSeen: number;
      };
      if (Array.isArray(cached.candidates) && cached.candidates.length > 0) {
        return {
          provider: provider.id,
          candidates: cached.candidates,
          urlsSeen: cached.urlsSeen ?? cached.candidates.length,
          fromCache: true,
        };
      }
    } catch {
      /* a corrupt cache is a reason to re-fetch, not to fail */
    }
  }

  const robots = await robotsFor(provider.origin, options.userAgent);
  const sources = Array.isArray(provider.catalogue) ? provider.catalogue : [provider.catalogue];

  // Merge by URL, first source wins. Sources are declared richest-first, so a
  // product the storefront API named keeps that name when the sitemap later
  // rediscovers the same URL with nothing but a slug.
  const byUrl = new Map<string, MatchCandidate>();
  const failures: string[] = [];
  let urlsSeen = 0;

  for (const source of sources) {
    try {
      const result = await runSource(provider, source, options, robots);
      urlsSeen += result.urlsSeen;

      let fresh = 0;
      for (const candidate of result.candidates) {
        if (byUrl.has(candidate.url)) continue;
        byUrl.set(candidate.url, candidate);
        fresh++;
      }

      if (options.verbose || sources.length > 1) {
        console.log(
          `   [${provider.id}] ${source.kind}: ${result.candidates.length} products, ${fresh} new`,
        );
      }
    } catch (err) {
      failures.push(`${source.kind}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const candidates = [...byUrl.values()];

  // Only a total failure is an error. One source of several going down should
  // not throw away what the others found.
  if (candidates.length === 0) {
    return {
      provider: provider.id,
      candidates: [],
      urlsSeen,
      fromCache: false,
      error: failures.join("; ") || "no products found",
    };
  }

  writeCache(path, provider.id, urlsSeen, candidates);

  return {
    provider: provider.id,
    candidates,
    urlsSeen,
    fromCache: false,
    error: failures.length > 0 ? failures.join("; ") : undefined,
  };
}

/**
 * Persist a provider's candidate list so the next run starts from disk.
 *
 * For an API catalogue this file also holds every gallery, which is what makes
 * a re-run of the crawler cost nothing at the manufacturer's end until
 * `--refresh-sitemaps` says otherwise.
 */
function writeCache(
  path: string,
  providerId: string,
  urlsSeen: number,
  candidates: MatchCandidate[],
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      { provider: providerId, fetchedAt: new Date().toISOString(), urlsSeen, candidates },
      null,
      2,
    ),
    "utf8",
  );
}
