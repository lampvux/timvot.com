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
import { slugify } from "../normalizer";
import { parseShopifyProductJson, parseWooProductJson, type GalleryImage } from "./gallery";
import type { CatalogueSource, ProviderConfig } from "./providers";

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

/**
 * The `<loc>` values, wrapped in CDATA or not.
 *
 * WordPress SEO plugins write `<loc><![CDATA[https://…]]></loc>`, which is
 * valid and which a url pattern anchored on "not a `<`" cannot see, because the
 * value now begins with one. fz-forza.com's sitemap is one of those, and it
 * read as empty — a provider with no products at all, reported as an unreadable
 * sitemap rather than as the parse bug it was.
 */
function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[\s*)?([^<\]\s]+)\s*(?:\]\]>\s*)?<\/loc>/gi)].map(
    (match) => match[1].replace(/&amp;/g, "&").trim(),
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
}

/**
 * Strip the merchandising a shop wraps around a model name.
 *
 * Entities are decoded first: the WooCommerce Store API serialises names as
 * stored, so "Dual - Power & Speed" arrives as "Dual Power &amp; Speed" and
 * tokenises to an `amp` that matches nothing.
 */
function cleanTitle(title: string, url: string, provider: ProviderConfig): string {
  let text = cleanText(title);
  for (const pattern of provider.titleNoise ?? []) text = text.replace(pattern, " ");
  text = text.replace(/\s+/g, " ").trim();
  // Removal cannot express "this tail is a colourway", so a provider that needs
  // that hands the tidied name to its own transform. It runs last, on collapsed
  // whitespace, because it tokenises what it is given, and it gets the product
  // url as well — a shop that truncates its own product names still has the
  // whole of one in the permalink.
  if (provider.titleTransform) text = provider.titleTransform(text, url);
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
    is_in_stock?: boolean;
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
        if (source.inStockOnly && item.is_in_stock === false) {
          if (options.verbose) console.log(`   [${provider.id}] out of stock: ${item.name}`);
          continue;
        }

        // Reuse the same parser the retailer WooCommerce scraper uses, so the
        // notion of "what counts as an image on a Woo product" lives in one place.
        const images = parseWooProductJson(JSON.stringify([item]), item.permalink);
        if (images.length === 0) continue;

        byUrl.set(item.permalink, {
          url: item.permalink,
          slug: slugOfUrl(item.permalink) || item.slug,
          title: cleanTitle(item.name, item.permalink, provider),
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
          title: cleanTitle(product.title, productUrl, provider),
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

      const title = cleanTitle($(el).text(), clean, provider);
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
        title: item.name ? cleanTitle(item.name, url, provider) : undefined,
      });
    }

    if (options.verbose) {
      console.log(`   [${provider.id}] storefront API page ${page} → ${byUrl.size}/${total}`);
    }
  }

  return { candidates: [...byUrl.values()], urlsSeen: seen };
}


/* ------------------------------------------------------------- Yonex Japan */

/**
 * Yonex's model codes, and the series each prefix stands for.
 *
 * These are the eight racket lines yonex.co.jp files badminton frames under. No
 * prefix here is a prefix of another, so the order is only readability; a code
 * outside the list is left unexpanded and therefore simply never matches, which
 * is the right failure for a name nobody can vouch for.
 */
const YONEX_SERIES: [prefix: RegExp, series: string][] = [
  [/^ARC/, "Arcsaber"],
  [/^AX/, "Astrox"],
  [/^NF-?/, "Nanoflare"],
  [/^NR-?/, "Nanoray"],
  [/^VT-?/, "Voltric"],
  [/^DUO-?/, "Duora"],
  [/^ISO-?/, "Isometric"],
  [/^MP/, "Muscle Power"],
];

/**
 * The one- and two-letter grades Yonex appends to a model number. `AX77-P` is
 * the Astrox 77 Pro; `3AX88D-G` is the third-generation Astrox 88D Game.
 *
 * `G` is the one letter that is overloaded: on a frame in the 張上 (pre-strung)
 * range it means "strung", not "Game", so `B4000G` is the B4000 and `MP9LTG`
 * is the Muscle Power 9LT. Those codes are left to fail rather than special-
 * cased — none of them is in the catalogue, and a wrong expansion cannot match
 * anyway, because the tokens still differ.
 */
const YONEX_GRADE: Record<string, string> = {
  P: "Pro",
  T: "Tour",
  G: "Game",
  PL: "Play",
  A: "Ability",
  C: "Clear",
  F: "Feel",
  JR: "Junior",
  NT: "Nextage",
  ZS: "Z-Strike",
};

/**
 * Expand a Yonex model code into the English name the catalogue holds.
 *
 * `ARC11-P` → "Arcsaber 11 Pro", `NF-400` → "Nanoflare 400", `3AX88D-P` →
 * "Astrox 88D Pro". The leading `2`/`3` is a generation marker Yonex puts in
 * front of a code it is reusing for a redesigned frame, not part of the model
 * name, so it comes off: the catalogue calls `3AX99-P` "Astrox 99 Pro".
 *
 * Returns null when the code is not one of the known series, rather than
 * guessing. The matcher is set-equality on tokens, so a wrong expansion cannot
 * attach the wrong photograph — it just fails to match — but returning null
 * keeps the failure visible in the candidate list instead of burying it.
 */
function expandYonexCode(code: string): string | null {
  const trimmed = code.trim().toUpperCase().replace(/^[23](?=[A-Z])/, "");
  const entry = YONEX_SERIES.find(([prefix]) => prefix.test(trimmed));
  if (!entry) return null;

  const [prefix, series] = entry;
  const words: string[] = [series];

  for (const part of trimmed.replace(prefix, "").split("-").filter(Boolean)) {
    // A number optionally carrying a designation: `88D`, `100ZZ`, `11`. The
    // designation stays welded to the number — the catalogue writes "Astrox
    // 88D", never "Astrox 88 D" — unless it is a grade, which is a word.
    const numbered = part.match(/^(\d+)([A-Z]*)$/);
    if (numbered) {
      const [, digits, tail] = numbered;
      if (tail && YONEX_GRADE[tail]) {
        words.push(digits, YONEX_GRADE[tail]);
      } else {
        words.push(digits + tail);
      }
      continue;
    }
    words.push(YONEX_GRADE[part] ?? part);
  }

  return words.join(" ");
}

/**
 * Read yonex.co.jp's product JSON.
 *
 * One request for the whole company — the endpoint returns all 1.759 products
 * across badminton, tennis, golf, snowboarding and the rest — then filtered
 * down to the badminton frames by the two category fields.
 *
 * Every candidate carries its image, so a racket matched here costs no further
 * request. The `url` is the racquet listing page with the model code as a
 * fragment: the site publishes no per-product page, and a fragment keeps each
 * candidate distinct and same-origin without inventing a path that would 404
 * if anyone followed `source_page_url` back to it.
 */
async function discoverYonexJp(
  provider: ProviderConfig,
  source: Extract<CatalogueSource, { kind: "yonex-jp-api" }>,
  options: DiscoverOptions,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  const headers = { ...JSON_HEADERS, "User-Agent": options.userAgent };
  const url =
    `${source.endpoint}?limit=3000` +
    `&cols=id,code,name,color,image,category_l,category_m,category_s`;

  const res = await fetchWithRetry(url, { headers, timeoutMs: options.timeoutMs });
  if (!res.ok) throw new Error(`product/list: HTTP ${res.status}`);

  interface JpProduct {
    code?: string;
    name?: string;
    color?: string;
    image?: string;
    category_l?: string;
    category_m?: string;
  }

  const payload = JSON.parse(res.body) as { items?: JpProduct[] };
  const items = payload.items ?? [];

  const byCode = new Map<string, MatchCandidate>();
  let seen = 0;
  const unexpanded: string[] = [];

  for (const item of items) {
    if (item.category_l !== source.categoryL || item.category_m !== source.categoryM) continue;
    seen++;

    const code = item.code?.trim();
    if (!code || !item.image) continue;
    if (byCode.has(code)) continue;

    const title = expandYonexCode(code);
    if (!title) {
      unexpanded.push(code);
      continue;
    }

    const images: GalleryImage[] = [
      {
        url: `${source.imageBase}${item.image}`,
        position: 0,
        colourway: item.color?.trim() || undefined,
        caption: item.name?.trim() || undefined,
      },
    ];

    byCode.set(code, {
      url: `${source.listingUrl}#${encodeURIComponent(code)}`,
      slug: slugify(code),
      title,
      images,
    });
  }

  if (options.verbose && unexpanded.length > 0) {
    console.log(`   [${provider.id}] no model-code expansion for: ${unexpanded.join(", ")}`);
  }

  return { candidates: [...byCode.values()], urlsSeen: seen };
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

  if (source.titleFromHead) {
    await readHeadTitles(provider, source.titleFromHead, candidates, options, delayMs);
  }

  return { candidates, urlsSeen: urls.length };
}

/**
 * Fill in each candidate's `title` from its own page `<head>`.
 *
 * A failed read leaves `title` undefined rather than throwing: the candidate
 * still matches on its slug, which is exactly where it stood before, so one
 * unreachable page costs one page's worth of precision and not the walk.
 *
 * `og:title` is preferred over `<title>` because a shop template is more
 * likely to append its own name to the second than to the first — and where
 * both carry it, `suffixSeparator` takes it off.
 */
async function readHeadTitles(
  provider: ProviderConfig,
  config: NonNullable<Extract<CatalogueSource, { kind: "sitemap" }>["titleFromHead"]>,
  candidates: MatchCandidate[],
  options: DiscoverOptions,
  delayMs: number,
): Promise<void> {
  const headers = { ...HTML_HEADERS, "User-Agent": options.userAgent };
  let read = 0;

  for (const [index, candidate] of candidates.entries()) {
    if (index > 0) await sleep(delayMs);

    const res = await fetchWithRetry(candidate.url, { headers, timeoutMs: options.timeoutMs });
    if (!res.ok) continue;

    const $ = cheerio.load(res.body);
    const raw = $('meta[property="og:title"]').attr("content") ?? $("title").first().text();
    if (!raw) continue;

    const trimmed = config.suffixSeparator ? raw.split(config.suffixSeparator)[0] : raw;
    const title = cleanTitle(trimmed, candidate.url, provider);
    if (!title) continue;

    candidate.title = title;
    read++;

    if (options.verbose && read % 50 === 0) {
      console.log(`   [${provider.id}] read ${read}/${candidates.length} product titles`);
    }
  }

  console.log(
    `   [${provider.id}] read ${read} of ${candidates.length} product names from the pages themselves ` +
      `— a sitemap carries no names, and three of these slugs disagree with theirs.`,
  );
}

/** Run one declared source. */
function runSource(
  provider: ProviderConfig,
  source: CatalogueSource,
  options: DiscoverOptions,
  robots: RobotsPolicy,
): Promise<{ candidates: MatchCandidate[]; urlsSeen: number }> {
  switch (source.kind) {
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
    case "yonex-jp-api":
      return discoverYonexJp(provider, source, options);
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

  // A listing that sells several frames under one product is not a page for
  // any one of them, and the matcher's SKU-suffix allowance cannot tell the
  // difference. Dropping those here keeps that decision with the provider that
  // knows its own shop, rather than loosening the comparison for everyone.
  const candidates = [...byUrl.values()].filter((candidate) => {
    if (!provider.excludeTitle || !candidate.title) return true;
    const title = candidate.title;
    if (!provider.excludeTitle.some((pattern) => pattern.test(title))) return true;
    if (options.verbose) console.log(`   [${provider.id}] excluded: ${title}`);
    return false;
  });

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
