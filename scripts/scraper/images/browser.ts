/**
 * A browser, for the sites that do not answer without one.
 *
 * Every other provider in this crawler is read over plain HTTP, and that is the
 * strong preference: it is faster, it is gentler on the site, and it does not
 * depend on Chromium starting. Two things forced a browser here, and both were
 * checked before reaching for it — victorsport.com turned out to have a JSON
 * endpoint behind its client-rendered grid and so does *not* use this file.
 *
 * mizunobadminton-asia.com does. It is a Wix Stores site: the racket grid is
 * assembled client-side from a signed, token-authenticated API, the anchors
 * only exist after hydration, and the gallery on a product page is the same.
 * Rendering the page is the honest way in.
 *
 * The session is opened once per run and reused. Launching Chromium costs a
 * second or two and leaks memory if done per page, and this crawl visits a few
 * hundred pages.
 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import type { GalleryImage } from "./gallery";

const VIEWPORT = { width: 1400, height: 1200 };

/**
 * Wix serves every image through a resize pipeline:
 *
 *   .../media/<id>~mv2.jpg/v1/fill/w_273,h_273,.../file.jpg
 *
 * Everything from `/v1/` onwards is the transform, and dropping it returns the
 * uploaded original — 1750×1750 against the 273×273 the page renders, which is
 * the difference between a thumbnail and a usable product photograph.
 */
export function wixOriginal(url: string): string {
  return url.replace(/(\/media\/[^/]+)\/v1\/.*$/, "$1");
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private readonly userAgent: string) {}

  /**
   * Chromium occasionally fails to start on Windows straight after a long
   * scrape (exit 0xC0000142, a transient DLL init failure). Retry, then fall
   * back to an installed Chrome — the same ladder `verify.ts` climbs.
   */
  private async launch(): Promise<Browser> {
    const attempts: [string, () => Promise<Browser>][] = [
      ["bundled chromium", () => chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] })],
      ["bundled chromium (retry)", () => chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--single-process"] })],
      ["installed chrome", () => chromium.launch({ headless: true, channel: "chrome", args: ["--no-sandbox"] })],
    ];

    let lastError: unknown;
    for (const [label, launch] of attempts) {
      try {
        return await launch();
      } catch (err) {
        lastError = err;
        console.warn(
          `   ⚠️  Could not launch ${label}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
        );
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw lastError;
  }

  private async ready(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.browser = await this.launch();
    this.context = await this.browser.newContext({ userAgent: this.userAgent, viewport: VIEWPORT });
    return this.context;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
  }

  /**
   * Open a page, let it hydrate, and scroll it to the bottom.
   *
   * `domcontentloaded` rather than `networkidle`: a Wix page keeps analytics
   * sockets open and never goes idle, so waiting for that is a guaranteed
   * timeout. The scroll matters because the gallery lazy-loads — without it
   * only the first row of rackets ever exists in the DOM.
   */
  private async render<T>(url: string, timeoutMs: number, read: (page: import("playwright").Page) => Promise<T>): Promise<T> {
    const context = await this.ready();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(3500);

      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(600);
      }
      await page.waitForTimeout(1000);

      return await read(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** Hrefs on the rendered page matching `pattern`. */
  async collectLinks(url: string, pattern: RegExp, timeoutMs: number): Promise<string[]> {
    return this.render(url, timeoutMs, async (page) => {
      const hrefs = await page.$$eval("a[href]", (els) =>
        els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean),
      );
      return [...new Set(hrefs)].filter((h) => pattern.test(h));
    });
  }

  /**
   * Images the rendered page actually painted, at their original resolution.
   *
   * Filtering on `naturalWidth` rather than on the URL is what keeps the nav
   * logo and the social icons out: the browser has already decoded every image,
   * so its own idea of how big each one is beats any guess from the filename.
   */
  async collectImages(url: string, minEdgePx: number, timeoutMs: number): Promise<GalleryImage[]> {
    const found = await this.render(url, timeoutMs, async (page) =>
      page.evaluate(
        (min) =>
          [...document.querySelectorAll("img")]
            .map((node) => {
              const img = node as HTMLImageElement;
              return { src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight, alt: img.alt };
            })
            .filter((i) => i.src && i.w >= min && i.h >= min),
        minEdgePx,
      ),
    );

    const seen = new Set<string>();
    const images: GalleryImage[] = [];

    for (const item of found) {
      const full = wixOriginal(item.src);
      if (seen.has(full)) continue;
      seen.add(full);
      images.push({ url: full, position: images.length, caption: item.alt || undefined });
    }

    return images;
  }
}
