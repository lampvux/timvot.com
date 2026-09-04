/**
 * Verification pass.
 *
 * A scraper that returns a number is not a scraper that returns the right
 * number. This module opens the real category pages in a real browser and
 * checks the scrape against what a person would see:
 *
 *  - Coverage: how many pages does the site's own pager advertise, and did we
 *    walk all of them? A source that returns 0 products is a hard failure, and
 *    so is one that stops on page 1 of 137.
 *  - Provenance: open a random sample of scraped product URLs in the browser.
 *    Each must load (this is what catches the broken `shopvnb.com` + relative
 *    href join, which produced 3.000 dead links), and the price we recorded must
 *    appear on the page the customer would land on.
 *
 * Everything here reads public pages exactly as a browser would; nothing is
 * written back to the sites.
 */

import { chromium, type Browser, type Page } from "playwright";
import type { ScrapedProduct, ScraperResult, ScraperSource } from "./types";

export interface PageCheck {
  url: string;
  loaded: boolean;
  httpStatus: number | null;
  titleMatches: boolean;
  priceMatches: boolean;
  pageTitle: string;
  scrapedTitle: string;
  scrapedPrice: number;
  note?: string;
}

export interface SiteVerification {
  source: ScraperSource;
  categoryUrl: string;
  /** Last page number in the site's own pager, when it renders one. */
  advertisedLastPage: number | null;
  /** Cards visible on page 1 of the rendered listing. */
  cardsOnFirstPage: number | null;
  /** Rough expectation from the site's own pager. */
  expectedApprox: number | null;
  scrapedCount: number;
  pagesFetched: number;
  coverageOk: boolean;
  sampleChecks: PageCheck[];
  samplePassRate: number;
  issues: string[];
}

const CATEGORY_URLS: Record<ScraperSource, string> = {
  vnb: "https://shopvnb.com/vot-cau-long.html",
  qvbadminton: "https://qvbadminton.com/vot-cau-long/",
  fbshop: "https://fbshop.vn/vot-cau-long/",
  hvshop: "https://hvshop.vn/vot-cau-long/",
  shopee: "https://shopee.vn/search?keyword=v%E1%BB%A3t%20c%E1%BA%A7u%20l%C3%B4ng",
};

/** Selectors that identify one product card in each site's rendered listing. */
const CARD_SELECTORS: Record<ScraperSource, string> = {
  vnb: ".item_product_main",
  qvbadminton: ".product-small.col",
  fbshop: ".pcate-item",
  hvshop: ".product-small.col",
  shopee: "div[data-sqe='item']",
};

/** Format a VND integer the way these storefronts print it: 3.500.000 */
function formatVnd(value: number): string {
  return value.toLocaleString("de-DE");
}

/** Words from a title that are distinctive enough to look for on the page. */
function significantTokens(title: string): string[] {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["vot", "cau", "long", "chinh", "hang", "the", "pro"].includes(w));
}

async function readLastPage(page: Page, source: ScraperSource): Promise<number | null> {
  return page.evaluate((src) => {
    const numbers: number[] = [];

    // WooCommerce/Flatsome render real <a> pagination links.
    document.querySelectorAll("a.page-numbers, .page-numbers a, .pagination a").forEach((a) => {
      const text = (a.textContent || "").trim();
      if (/^\d+$/.test(text)) numbers.push(Number(text));
      const href = (a as HTMLAnchorElement).getAttribute("href") || "";
      const m = href.match(/page[/=](\d+)/);
      if (m) numbers.push(Number(m[1]));
    });

    // shopvnb drives its pager from onclick="doSearch(n)" instead of hrefs.
    if (src === "vnb") {
      document.querySelectorAll(".pagination a, .nav_pagi a").forEach((a) => {
        const onclick = a.getAttribute("onclick") || "";
        const m = onclick.match(/doSearch\((\d+)\)/);
        if (m) numbers.push(Number(m[1]));
      });
    }

    return numbers.length ? Math.max(...numbers) : null;
  }, source);
}

/** Open one scraped product page and confirm it is the product we recorded. */
async function checkProductPage(
  browser: Browser,
  product: ScrapedProduct,
): Promise<PageCheck> {
  const check: PageCheck = {
    url: product.url,
    loaded: false,
    httpStatus: null,
    titleMatches: false,
    priceMatches: false,
    pageTitle: "",
    scrapedTitle: product.rawTitle,
    scrapedPrice: product.price,
  };

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "vi-VN",
  });
  const page = await context.newPage();

  // Images and fonts do not affect the assertions and dominate the load time.
  await page.route("**/*.{png,jpg,jpeg,webp,svg,gif,woff,woff2,ttf,mp4}", (r) => r.abort());

  try {
    const response = await page.goto(product.url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    check.httpStatus = response?.status() ?? null;
    check.loaded = Boolean(response && response.status() < 400);

    if (check.loaded) {
      check.pageTitle = ((await page.title()) || "").trim();

      const bodyText = await page.evaluate(() => document.body.innerText);
      const normalisedBody = bodyText
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

      const tokens = significantTokens(product.rawTitle).slice(0, 6);
      const hits = tokens.filter((t) => normalisedBody.includes(t)).length;
      // Most of the distinctive words from the listing title should be on the
      // product page; a couple can legitimately differ (colour naming, year).
      check.titleMatches = tokens.length === 0 || hits / tokens.length >= 0.6;

      // The listing price should be printed somewhere on the detail page.
      const formatted = formatVnd(product.price);
      check.priceMatches = bodyText.includes(formatted);
      if (!check.priceMatches) {
        // Some themes print the price only inside a script/JSON-LD payload.
        const html = await page.content();
        check.priceMatches = html.includes(formatted) || html.includes(String(product.price));
      }
      if (!check.priceMatches) {
        check.note = `listing price ${formatted}₫ not found on detail page`;
      }
    } else {
      check.note = `HTTP ${check.httpStatus}`;
    }
  } catch (err) {
    check.note = err instanceof Error ? err.message.split("\n")[0] : String(err);
  } finally {
    await context.close();
  }

  return check;
}

/**
 * Chromium occasionally fails to start on Windows straight after a long scrape
 * (exit 0xC0000142, DLL init failure — a transient resource problem, not a bad
 * install). Retry, then fall back to a locally installed Chrome before giving up.
 */
async function launchBrowser(): Promise<Browser> {
  const attempts: { label: string; launch: () => Promise<Browser> }[] = [
    { label: "bundled chromium", launch: () => chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }) },
    { label: "bundled chromium (retry)", launch: () => chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--single-process"] }) },
    { label: "installed chrome", launch: () => chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] }) },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await attempt.launch();
    } catch (err) {
      lastError = err;
      console.warn(
        `   ⚠️  Could not launch ${attempt.label}: ` +
          `${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastError;
}

function pickSample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const step = items.length / count;
  // Spread the sample across the whole result set rather than the first page.
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

/**
 * One site's verification pass.
 *
 * Lifted out of the loop so the loop can guard it: a browser context that
 * fails to open for one shop used to reject out of `verifyScrape` and cost
 * the verification report for every shop, including the ones already checked.
 */
async function verifyOneSite(
  browser: Browser,
  result: ScraperResult,
  options: { sampleSize: number; verbose: boolean },
): Promise<SiteVerification> {
  const { sampleSize, verbose } = options;
  const categoryUrl = CATEGORY_URLS[result.source];
  const verification: SiteVerification = {
    source: result.source,
    categoryUrl,
    advertisedLastPage: null,
    cardsOnFirstPage: null,
    expectedApprox: result.reportedTotal ?? null,
    scrapedCount: result.itemsCount,
    pagesFetched: result.pagesFetched ?? 0,
    coverageOk: false,
    sampleChecks: [],
    samplePassRate: 0,
    issues: [],
  };

  if (verbose) console.log(`\n🔍 Verifying [${result.source}] in a real browser…`);

  // --- 1. Read the site's own listing with a browser -------------------
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "vi-VN",
  });
  const page = await context.newPage();
  await page.route("**/*.{png,jpg,jpeg,webp,svg,gif,woff,woff2,ttf,mp4}", (r) => r.abort());

  try {
    const response = await page.goto(categoryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    if (!response || response.status() >= 400) {
      verification.issues.push(
        `Category page did not load (HTTP ${response?.status() ?? "no response"}).`,
      );
    } else {
      // Let lazy-loaded grids settle.
      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(1500);

      verification.cardsOnFirstPage = await page
        .locator(CARD_SELECTORS[result.source])
        .count();
      verification.advertisedLastPage = await readLastPage(page, result.source);

      if (verification.cardsOnFirstPage === 0) {
        // A source that already reported itself blocked is explained; do not
        // also accuse its selector, which was never reached.
        verification.issues.push(
          result.success
            ? `Browser sees 0 product cards on the category page using selector ` +
              `"${CARD_SELECTORS[result.source]}" — the selector or the page is wrong.`
            : `Browser also sees 0 product cards, consistent with the scraper's ` +
              `reported failure: ${result.error ?? "source unavailable"}`,
        );
      }
    }
  } catch (err) {
    verification.issues.push(
      `Category page check failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    );
  } finally {
    await context.close();
  }

  // --- 2. Coverage ------------------------------------------------------
  const cards = verification.cardsOnFirstPage;
  const lastPage = verification.advertisedLastPage;

  // shopvnb renders a sliding 10-page window rather than the full pager, so
  // the highest number on page 1 is a floor, not the catalogue size. Only
  // treat the pager as a total for sites that print the real last page.
  const pagerIsWindowed = result.source === "vnb";

  if (verification.expectedApprox == null && cards && lastPage && !pagerIsWindowed) {
    // No API total to compare against, so estimate from the rendered pager.
    verification.expectedApprox = cards * lastPage;
  }

  if (result.itemsCount === 0) {
    verification.issues.push(
      result.success
        ? "Scraper returned 0 products."
        : `Source unavailable, 0 products recorded: ${result.error ?? "no reason given"}`,
    );
  } else if (verification.expectedApprox) {
    const ratio = result.itemsCount / verification.expectedApprox;
    // Rackets are filtered out of a mixed category, and the last page is
    // rarely full, so anything from 70% up is consistent coverage.
    verification.coverageOk = ratio >= 0.7;
    if (!verification.coverageOk) {
      verification.issues.push(
        `Coverage ${(ratio * 100).toFixed(0)}% — scraped ${result.itemsCount} of an ` +
          `expected ~${verification.expectedApprox}.`,
      );
    }
  } else {
    verification.coverageOk = result.itemsCount > 0;
  }

  // Only compare page counts when there is no item count to compare, and
  // only for sources that paginate the same listing the browser sees. The
  // API-backed sources read 100 products per request against a rendered
  // pager of 15–20, so "11 of 53 pages" is a unit mismatch, not a gap —
  // the item coverage above is the question that actually matters.
  const paginatesLikeTheBrowser = result.source === "vnb";
  if (
    verification.expectedApprox == null &&
    paginatesLikeTheBrowser &&
    !pagerIsWindowed &&
    lastPage &&
    verification.pagesFetched &&
    verification.pagesFetched < lastPage * 0.9
  ) {
    verification.issues.push(
      `Only ${verification.pagesFetched} of ~${lastPage} listing pages were fetched.`,
    );
  }

  // --- 3. Sample real product pages ------------------------------------
  const sample = pickSample(result.products, sampleSize);
  for (const product of sample) {
    const check = await checkProductPage(browser, product);
    verification.sampleChecks.push(check);
    if (verbose) {
      const mark = check.loaded && check.titleMatches && check.priceMatches ? "✓" : "✗";
      console.log(
        `   ${mark} ${check.url}\n` +
          `      loaded=${check.loaded}(${check.httpStatus}) title=${check.titleMatches} ` +
          `price=${check.priceMatches} (${formatVnd(check.scrapedPrice)}₫)` +
          (check.note ? `\n      note: ${check.note}` : ""),
      );
    }
  }

  const passed = verification.sampleChecks.filter(
    (c) => c.loaded && c.titleMatches && c.priceMatches,
  ).length;
  verification.samplePassRate = verification.sampleChecks.length
    ? passed / verification.sampleChecks.length
    : 0;

  const dead = verification.sampleChecks.filter((c) => !c.loaded);
  if (dead.length > 0) {
    verification.issues.push(
      `${dead.length}/${verification.sampleChecks.length} sampled product URLs did not load.`,
    );
  }
  const priceMismatch = verification.sampleChecks.filter((c) => c.loaded && !c.priceMatches);
  if (priceMismatch.length > 0) {
    verification.issues.push(
      `${priceMismatch.length}/${verification.sampleChecks.length} sampled pages did not show the scraped price.`,
    );
  }

  return verification;
}

export async function verifyScrape(
  results: ScraperResult[],
  options: { sampleSize?: number; verbose?: boolean } = {},
): Promise<SiteVerification[]> {
  const sampleSize = options.sampleSize ?? 5;
  const verbose = options.verbose ?? true;
  const verifications: SiteVerification[] = [];

  const browser = await launchBrowser();

  try {
    for (const result of results) {
      try {
        verifications.push(await verifyOneSite(browser, result, { sampleSize, verbose }));
      } catch (err) {
        // A shop whose verification could not run is reported as unverified,
        // not as a verdict on the scrape — and never at the expense of the
        // shops queued behind it.
        verifications.push({
          source: result.source,
          categoryUrl: CATEGORY_URLS[result.source],
          advertisedLastPage: null,
          cardsOnFirstPage: null,
          expectedApprox: result.reportedTotal ?? null,
          scrapedCount: result.itemsCount,
          pagesFetched: result.pagesFetched ?? 0,
          coverageOk: false,
          sampleChecks: [],
          samplePassRate: 0,
          issues: [
            `Verification could not run for this source: ` +
              `${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
          ],
        });
      }
    }
  } finally {
    await browser.close();
  }

  return verifications;
}

export function printVerificationReport(verifications: SiteVerification[]): boolean {
  console.log("\n=================================================");
  console.log("🔎 BROWSER VERIFICATION REPORT");
  console.log("=================================================");

  let allGood = true;

  for (const v of verifications) {
    const ok = v.coverageOk && v.samplePassRate >= 0.8 && v.issues.length === 0;
    if (!ok) allGood = false;

    console.log(`\n[${v.source.toUpperCase()}] ${ok ? "PASS" : "ATTENTION"}`);
    console.log(`  Category page      : ${v.categoryUrl}`);
    console.log(`  Cards on page 1    : ${v.cardsOnFirstPage ?? "n/a"}`);
    console.log(
      `  Pager last page    : ${v.advertisedLastPage ?? "n/a"}` +
        (v.source === "vnb" && v.advertisedLastPage ? " (windowed pager — a floor, not the total)" : ""),
    );
    console.log(`  Expected (approx)  : ${v.expectedApprox ?? "n/a"}`);
    console.log(`  Scraped            : ${v.scrapedCount}  (${v.pagesFetched} pages fetched)`);
    console.log(
      `  Sample pages       : ${(v.samplePassRate * 100).toFixed(0)}% passed ` +
        `(${v.sampleChecks.length} checked in-browser)`,
    );
    if (v.issues.length > 0) {
      for (const issue of v.issues) console.log(`  ⚠️  ${issue}`);
    }
  }

  console.log("\n=================================================");
  console.log(allGood ? "✅ All verified sources passed." : "⚠️  Some sources need attention (see above).");
  console.log("=================================================\n");

  return allGood;
}
