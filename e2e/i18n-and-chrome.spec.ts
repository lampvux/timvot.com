import { at, expect, LOCALES, PUBLIC_ROUTES, test } from "./fixtures";

/**
 * The shell, the language switch, and the one route that must not be
 * locale-prefixed.
 *
 * `vi` is the default and `en` is available, with `localePrefix: "always"`.
 * The interesting failures are all at the edges of that rule: an unprefixed
 * path that should redirect, a callback that must *not* be rewritten, and a
 * switcher that drops the query string and therefore the whole filtered view
 * somebody was looking at.
 */

/* ------------------------------------------------------------- the routing */

test("an unprefixed path reaches the default locale", async ({ page }) => {
  await page.goto("/rackets");
  await page.waitForURL(/\/(vi|en)\/rackets/);
  expect(page.url()).toContain("/vi/rackets");
});

test("the root redirects into a locale", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/(vi|en)(\/|$)/);
  expect(page.url()).toMatch(/\/(vi|en)(\/|$)/);
});

test("/auth/callback is not locale-prefixed", async ({ request, baseURL }) => {
  // next-intl rewrites unprefixed paths, so /auth/callback?code=… became
  // /vi/auth/callback?code=… — a 404, with the one-time code already spent.
  // Every OAuth and email confirmation in the product returns through here.
  const response = await request.get(
    new URL("/auth/callback?error=test_probe", baseURL).toString(),
    { maxRedirects: 0 },
  );

  expect(
    response.status(),
    "/auth/callback did not answer. If it started 404ing, next-intl is " +
      "rewriting it again — check the proxy matcher in src/proxy.ts.",
  ).not.toBe(404);

  // It answers by redirecting to sign-in with the reason, never by rendering.
  expect([302, 303, 307, 308]).toContain(response.status());

  const location = response.headers()["location"] ?? "";
  expect(location).toContain("/sign-in");
});

test("the callback refuses an off-site next parameter", async ({ request, baseURL }) => {
  // Without a code it redirects to sign-in, so the reachable assertion here is
  // that it never redirects off-site. `open-redirect.test.ts` covers safeNext
  // exhaustively as a unit.
  for (const next of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
    const response = await request.get(
      new URL(`/auth/callback?next=${encodeURIComponent(next)}`, baseURL).toString(),
      { maxRedirects: 0 },
    );

    const location = response.headers()["location"] ?? "";
    if (!location) continue;

    // Compared by host rather than by origin: the route builds its redirect
    // from the request's own Host header, so a suite driving 127.0.0.1 gets
    // localhost back — the same machine, a different origin string, and not
    // the thing being tested. What matters is that it is not evil.example.
    const resolved = new URL(location, baseURL);
    expect(
      resolved.hostname,
      `/auth/callback?next=${next} redirected to ${resolved.href}`,
    ).toMatch(/^(localhost|127\.0\.0\.1|\[::1\])$/);
  }
});

/* ------------------------------------------------------- the language switch */

test("switching language keeps the path and the query", async ({ page }) => {
  // Losing the query loses the filtered view somebody was looking at, which is
  // the one thing the catalogue's URL-first design exists to prevent.
  await page.goto("/vi/rackets?brand=yonex&sort=price-asc");
  await page.waitForLoadState("load");

  // A button, not a link: switching is a transition that preserves the
  // current route, so it is `router.replace` rather than an href.
  const switcher = page.getByRole("button", { name: /Ngôn ngữ|Language/i }).first();

  await expect(switcher).toBeVisible({ timeout: 15_000 });
  await switcher.click();

  await page.waitForURL(/\/en\//, { timeout: 15_000 });

  const url = new URL(page.url());
  expect(url.pathname).toBe("/en/rackets");
  expect(url.searchParams.get("brand")).toBe("yonex");
  expect(url.searchParams.get("sort")).toBe("price-asc");
});

test("both locales serve every public route", async ({ request, baseURL }) => {
  const broken: string[] = [];

  for (const locale of LOCALES) {
    for (const route of PUBLIC_ROUTES) {
      const path = at(locale, route);
      const response = await request.get(new URL(path, baseURL).toString());
      if (response.status() >= 400) broken.push(`${response.status()} ${path}`);
    }
  }

  expect(broken, broken.join(", ")).toEqual([]);
});

test("an unknown locale is not served", async ({ request, baseURL }) => {
  const response = await request.get(new URL("/de/rackets", baseURL).toString());
  expect(response.status()).toBe(404);
});

/* --------------------------------------------------------------- the shell */

test("navigation links are in the static shell, before hydration", async ({
  browser,
}) => {
  // Site chrome appears on every route, so a URL hook read outside a Suspense
  // boundary there blocks the static shell for the whole app. The links stay
  // in the shell — crawlable and clickable from the first byte — and only the
  // active highlight streams.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto("/vi/rackets");

  for (const href of ["/vi/rackets", "/vi/deals", "/vi/compare", "/vi/finder"]) {
    expect(
      await page.locator(`a[href="${href}"]`).count(),
      `${href} is missing from the shell, so it needs JavaScript to exist.`,
    ).toBeGreaterThan(0);
  }

  await context.close();
});

test("the skip link is the first thing a keyboard reaches", async ({ page }) => {
  await page.goto("/vi/rackets");
  await page.waitForLoadState("load");

  await page.keyboard.press("Tab");

  const focused = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return { text: element?.textContent?.trim() ?? "", href: element?.getAttribute("href") ?? "" };
  });

  expect(
    focused.href,
    `the first tab stop was "${focused.text}" rather than the skip link.`,
  ).toBe("#main");
});

test("the active nav link is marked for assistive technology", async ({ page }) => {
  await page.goto("/vi/rackets");
  await page.waitForLoadState("load");

  // Colour alone is not a state. The highlight streams in behind a Suspense
  // boundary, so this waits for the mark rather than for paint — and counts
  // rather than requiring visibility, because the desktop header and the
  // mobile tab bar are each hidden at the other's width.
  await expect
    .poll(() => page.locator('a[aria-current="page"]').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const marked = await page
    .locator('a[aria-current="page"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));

  expect(
    marked.every((href) => href?.endsWith("/rackets")),
    `the catalogue marked ${marked.join(", ")} as the current page.`,
  ).toBe(true);
});

test("the document declares the locale it is in", async ({ page }) => {
  for (const locale of LOCALES) {
    await page.goto(at(locale, "/rackets"));
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
});

test("every page has one h1 and a title", async ({ page }) => {
  for (const route of ["/rackets", "/deals", "/finder", "/methodology", "/sellers"]) {
    await page.goto(at("vi", route));
    await page.waitForLoadState("load");

    expect(await page.title(), `${route} has no title`).not.toBe("");
    expect(
      await page.locator("h1").count(),
      `${route} has no h1`,
    ).toBeGreaterThan(0);
  }
});

test("alternate language links are declared", async ({ page }) => {
  await page.goto("/vi/rackets");

  const alternates = await page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("hreflang")));

  for (const locale of LOCALES) {
    expect(alternates, `no hreflang for ${locale}`).toContain(locale);
  }
});
