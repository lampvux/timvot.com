import { test as base, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Shared plumbing for the end-to-end suite.
 *
 * Three things every spec gets for free, because each is a class of bug that
 * only shows up when a real browser renders a real page and nobody is looking
 * for it specifically:
 *
 *   `a11y`        an axe scan of whatever is on screen. Run as a helper rather
 *                 than a spec of its own, so it covers every page a spec
 *                 visits instead of a hand-maintained list of routes.
 *   `noOverflow`  the page does not scroll sideways. At 400px this is the one
 *                 assertion that catches a control sized to its English string
 *                 — Vietnamese runs 20–30% longer and is the default locale.
 *   console       a page that logged an error fails, so a hydration mismatch
 *                 or a failed fetch is not something a screenshot has to show.
 */

export const LOCALES = ["vi", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Public routes, locale-prefixed at use. `localePrefix` is "always". */
export const PUBLIC_ROUTES = [
  "",
  "/rackets",
  "/deals",
  "/compare",
  "/finder",
  "/strings",
  "/sellers",
  "/guides",
  "/methodology",
  "/sign-in",
  "/sign-up",
] as const;

interface Fixtures {
  /** Console and page errors collected since navigation. */
  errors: string[];
}

export const test = base.extend<Fixtures>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];

    /**
     * Requests that are *expected* to fail outside a Vercel deployment.
     *
     * `@vercel/analytics` and `@vercel/speed-insights` fetch their scripts
     * from `/_vercel/...`, which the platform serves and `next start` does
     * not. The seeded catalogue also has no photography, so the image
     * optimizer has nothing to optimise.
     */
    const EXPECTED_FAILURES =
      /\/_vercel\/(insights|speed-insights)|\/favicon|\/_next\/image/;

    page.on("response", (response) => {
      if (response.status() < 400) return;
      const url = response.url();
      if (EXPECTED_FAILURES.test(url)) return;
      // Into the same array the spec asserts on, as it happens — a failure
      // collected after the test body has run is a failure nobody sees.
      errors.push(`${response.status()} ${url}`);
    });

    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();

      // A resource error's console line carries no URL, so it is judged by the
      // response listener above rather than by its text.
      if (/Failed to load resource|net::ERR_/i.test(text)) return;

      // `nosniff` refusing to run a 404's `text/plain` body. The only scripts
      // this happens to are the Vercel ones, which the platform serves and
      // `next start` does not — a correct refusal of a script that is not
      // there, rather than anything the app did wrong.
      if (/_vercel\/(insights|speed-insights)/.test(text)) return;

      errors.push(text);
    });

    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

    await use(errors);
  },
});

export { expect };

/* ------------------------------------------------------------ assertions */

/**
 * Accessibility rules that are known to fail today, with the reason.
 *
 * This is a baseline, not an exemption. Everything in it is a real violation
 * that a real person hits; it is listed so that the *rest* of the suite can be
 * a hard gate from day one instead of being switched off the first time it is
 * inconvenient. A rule not in this map fails the build.
 *
 * `docs/accessibility-findings.md` carries the detail and the burn-down.
 */
const KNOWN_VIOLATIONS: Record<string, string> = {
  "color-contrast":
    "--text-tertiary (#6d7a73) and --text-disabled (#93a09a) are below 4.5:1 " +
    "on --bg-sunken and --bg-card at the 11px the spec labels and meta rows " +
    "use. 126 nodes on /rackets alone, so this is the token ramp rather than " +
    "any one component. Fixing it is a design-system change: see " +
    "docs/accessibility-findings.md.",
};

const describeViolations = (
  violations: Array<{ impact?: string | null; id: string; help: string; nodes: Array<{ target: unknown[] }> }>,
) =>
  violations
    .map(
      (violation) =>
        `  ${violation.impact}: ${violation.id} — ${violation.help} ` +
        `(${violation.nodes.length} node(s))\n` +
        violation.nodes
          .slice(0, 3)
          .map((node) => `      ${node.target.join(" ")}`)
          .join("\n"),
    )
    .join("\n");

/**
 * No *new* serious or critical accessibility violation on the current page.
 *
 * `moderate` and `minor` are reported rather than failed: they are worth
 * knowing and not worth blocking a release. `serious` and `critical` fail
 * unless the rule is in the baseline above.
 */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = results.violations.filter(
    (violation) =>
      (violation.impact === "serious" || violation.impact === "critical") &&
      !(violation.id in KNOWN_VIOLATIONS),
  );

  expect(
    blocking.map((violation) => violation.id),
    `${label} has accessibility violations that are not in the baseline:\n` +
      `${describeViolations(blocking)}\n` +
      `Fix them, or — if the whole design system is affected and the fix is a ` +
      `token change — add the rule to KNOWN_VIOLATIONS in e2e/fixtures.ts with ` +
      `a reason, and record it in docs/accessibility-findings.md.`,
  ).toEqual([]);
}

/** The baseline rules that actually fired here, for the reporting spec. */
export async function knownViolationsOn(
  page: Page,
): Promise<Array<{ id: string; nodes: number }>> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  return results.violations
    .filter((violation) => violation.id in KNOWN_VIOLATIONS)
    .map((violation) => ({ id: violation.id, nodes: violation.nodes.length }));
}

export { KNOWN_VIOLATIONS };

/**
 * The page does not scroll sideways.
 *
 * A side gutter of at least 16px at every width is the rule; a document that
 * scrolls horizontally is how that gets lost. Tables, diagrams and code blocks
 * may overflow inside their own scroller, which is why this measures the
 * document rather than every element.
 */
export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return null;

    // Name the widest offender, so the failure says what to fix rather than
    // only that something is wrong.
    let worst = { selector: "", right: 0 };
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const box = element.getBoundingClientRect();
      if (box.right > worst.right && box.width > 0) {
        worst = {
          right: box.right,
          selector:
            element.tagName.toLowerCase() +
            (element.id ? `#${element.id}` : "") +
            (element.className && typeof element.className === "string"
              ? `.${element.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".")}`
              : ""),
        };
      }
    }

    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      widest: worst.selector,
      right: Math.round(worst.right),
    };
  });

  expect(
    overflow,
    `${label} scrolls horizontally: ${overflow?.scrollWidth}px of content in ` +
      `${overflow?.clientWidth}px of viewport. Widest box is ${overflow?.widest} ` +
      `ending at ${overflow?.right}px. Vietnamese runs 20–30% longer than ` +
      `English — never size a control to its English string.`,
  ).toBeNull();
}

/** No page or console error was logged while this page was open. */
export function expectNoConsoleErrors(errors: string[], label: string): void {
  expect(errors, `${label} logged: ${errors.join(" | ")}`).toEqual([]);
}

/* -------------------------------------------------------------- utilities */

/** A locale-prefixed path. */
export const at = (locale: Locale, path: string): string => `/${locale}${path}`;

/** The catalogue cards on the current page. */
export const cards = (page: Page) =>
  page.locator('main a[href*="/rackets/"]').filter({ has: page.locator("h3") });

/** Wait until a Cache Components fallback has been replaced by route content. */
export async function waitForStreamedContent(
  page: Page,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForLoadState("load");
  await page
    .locator('main [role="status"][aria-busy="true"]')
    .waitFor({ state: "hidden", timeout: timeoutMs });
}

/**
 * How many cards a filtered catalogue settled on.
 *
 * Counting straight after `goto` counts whatever has streamed so far: the
 * results arrive behind a Suspense boundary, so an early count is a race, and
 * a race between two navigations is how "two filters returned more rows than
 * one" happens.
 *
 * `networkidle` is the obvious wait and the wrong one here: the Vercel
 * analytics scripts 404 outside a deployment and retry, so the network never
 * goes quiet and every call burns its full timeout. Waiting for the count
 * itself to stop moving is both faster and a closer description of what is
 * being waited for.
 */
export async function countCards(page: Page, timeoutMs = 5000): Promise<number> {
  await waitForStreamedContent(page, timeoutMs);

  const deadline = Date.now() + timeoutMs;
  let previous = -1;
  let stableSince = 0;

  for (;;) {
    const count = await cards(page).count();

    if (count === previous) {
      // Two identical reads 150 ms apart: the boundary has resolved.
      if (Date.now() - stableSince >= 150) return count;
    } else {
      previous = count;
      stableSince = Date.now();
    }

    if (Date.now() > deadline) return count;
    await page.waitForTimeout(75);
  }
}

/** Every price string rendered on the page. */
export async function renderedPrices(page: Page): Promise<string[]> {
  return page.locator("main").evaluate((main) => {
    const text = main.textContent ?? "";
    return [...text.matchAll(/₫[\d.,]+[A-Za-z]*/g)].map((match) => match[0]);
  });
}

/** Visit a route and run the checks every page owes, whatever else it does. */
export async function visit(
  page: Page,
  path: string,
  { a11y = true }: { a11y?: boolean } = {},
): Promise<void> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });

  expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);

  await page.locator("main").waitFor({ state: "visible" });
  // Wait for the streamed content, not for the network: the analytics scripts
  // 404 and retry outside a Vercel deployment, so `networkidle` never arrives.
  await waitForStreamedContent(page);

  await expectNoHorizontalScroll(page, path);
  if (a11y) await expectAccessible(page, path);
}
