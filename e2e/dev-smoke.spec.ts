import { expect, test } from "@playwright/test";
import { at, LOCALES, PUBLIC_ROUTES } from "./fixtures";

/**
 * `npm run build` passing is not enough for a caching change.
 *
 * Some Cache Components validation runs only in development — a route can
 * build clean and still be blocked from prerendering, and the only place that
 * shows is `next dev`, as an error overlay on the page. CLAUDE.md asks a human
 * to start the dev server and open the routes they touched; this is that, done
 * every time instead of when someone remembers.
 *
 * Run separately from the rest of the suite, because it needs `next dev`
 * rather than a build:
 *
 *   npx next dev --port 3101 &
 *   E2E_BASE_URL=http://127.0.0.1:3101 npm run test:e2e:dev
 *
 * **One worker, on purpose.** `test:e2e:dev` passes `--workers=1`. The dev
 * server's `use cache` store is a set of files it writes and re-reads per
 * request, and hitting it from several workers at once corrupts them: the
 * server then answers 500 with `SyntaxError: Unexpected non-whitespace
 * character after JSON` from inside Next, on routes that serve perfectly well
 * one at a time and in the production build. That is a property of the dev
 * server under concurrent load, not of the app — and this is a check that
 * every route compiles, not a load test, so serial is both correct and
 * sufficient.
 */

/** What Next renders when a route cannot be prerendered, or throws. */
const OVERLAY_SELECTORS = [
  "nextjs-portal",
  "[data-nextjs-dialog]",
  "[data-nextjs-error-overlay]",
  "#__next-build-watcher",
];

const ROUTES = [
  ...PUBLIC_ROUTES,
  "/rackets?brand=yonex&sort=price-asc",
  "/rackets/yonex/astrox-99-pro",
  "/finder?experience=1to3&format=doubles&position=net&injury=none&budget=25to35",
];

for (const locale of LOCALES) {
  for (const route of ROUTES) {
    test(`dev: ${at(locale, route || "/")} compiles without an error overlay`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      const path = at(locale, route);
      const response = await page.goto(path, { waitUntil: "load" });

      expect(response?.status(), `${path} answered ${response?.status()}`).toBeLessThan(
        500,
      );

      // The dev server compiles on demand, so give it a moment to fail.
      await page.waitForTimeout(1200);

      for (const selector of OVERLAY_SELECTORS) {
        const overlay = page.locator(selector);
        if ((await overlay.count()) === 0) continue;

        const text = await overlay.first().innerText().catch(() => "");
        expect(
          text,
          `${path} rendered a Next.js error overlay in development:\n${text.slice(0, 800)}`,
        ).toBe("");
      }

      expect(errors, `${path} threw: ${errors.join(" | ")}`).toEqual([]);
    });
  }
}

test("dev: no route logs an uncached-data prerender error", async ({ page }) => {
  // The specific failure Cache Components reports only in development:
  // "encountered uncached or runtime data during prerendering". It arrives as
  // a console message rather than an overlay on some routes.
  const messages: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/uncached|runtime data during prerender|cacheComponents|use cache/i.test(text)) {
      messages.push(text);
    }
  });

  for (const route of PUBLIC_ROUTES) {
    await page.goto(at("vi", route), { waitUntil: "load" });
    await page.waitForTimeout(600);
  }

  expect(messages, messages.join("\n")).toEqual([]);
});
