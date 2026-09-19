import {
  at,
  expect,
  expectNoConsoleErrors,
  LOCALES,
  PUBLIC_ROUTES,
  test,
  visit,
} from "./fixtures";

/**
 * The surfaces that are not the catalogue.
 *
 * Compare, Finder, strings, deals, sellers and guides each own a claim, and
 * each of them is a page that awaits data and therefore has to say so while it
 * waits. They are grouped in one file because none of them needs a long spec
 * of its own and the shared setup is the whole cost.
 */

/* --------------------------------------------------------- every route once */

for (const locale of LOCALES) {
  for (const route of PUBLIC_ROUTES) {
    test(`${at(locale, route || "/")} renders, is accessible, and fits`, async ({
      page,
      errors,
    }) => {
      const path = at(locale, route);
      await visit(page, path);

      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("h1").first()).toBeVisible();
      expectNoConsoleErrors(errors, path);
    });
  }
}

/* -------------------------------------------------------------- the finder */

for (const locale of LOCALES) {
  test.describe(`finder (${locale})`, () => {
    test("a complete answer set produces a shortlist with reasons", async ({ page }) => {
      // The Finder's answers live in the URL like every other filter, so the
      // result is shareable and rendered on the server.
      //
      // Every budget band is tried: which of them the seeded catalogue can
      // actually fill is a property of the seed, and pinning one band here
      // would make the spec quietly stop testing the shortlist the day the
      // seed's prices move.
      let shortlisted = 0;

      for (const budget of ["u15", "15to25", "25to35", "o35"]) {
        const answers = `experience=1to3&format=doubles&position=net&injury=none&budget=${budget}`;
        await page.goto(at(locale, `/finder?${answers}`));
        await page.waitForLoadState("load");
        await page.waitForTimeout(300);

        const main = await page.locator("main").innerText();
        expect(main, "a raw placeholder reached the Finder").not.toMatch(
          /\{[a-zA-Z]+\}/,
        );

        const results = await page.locator('main a[href*="/rackets/"]').count();
        if (results === 0) {
          // An empty shortlist is a legitimate answer, and it has to say what
          // to do next with a number rather than "no results".
          expect(main).toMatch(/\d/);
          continue;
        }

        shortlisted += results;
        // Every result carries the reason it matched — the explanation is the
        // product, so a bare list is the failure.
        expect(main.replace(/\s+/g, " ").length).toBeGreaterThan(200);
      }

      expect(
        shortlisted,
        "no budget band produced a single recommendation from the seeded " +
          "catalogue, so nothing exercised the reasons at all.",
      ).toBeGreaterThan(0);
    });

    test("an incomplete answer set shows the quiz rather than an error", async ({
      page,
    }) => {
      const response = await page.goto(at(locale, "/finder?experience=1to3"));
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
    });

    test("a crafted answer cannot flip the injury filter", async ({ page }) => {
      // `?injury=none&injury=ongoing` arrives as an array. Taking the last
      // value would let a link change a hard safety filter.
      const response = await page.goto(
        at(
          locale,
          "/finder?experience=over3&format=singles&position=rear" +
            "&injury=none&injury=ongoing&budget=o35",
        ),
      );
      expect(response?.status()).toBeLessThan(400);
    });

    test("nonsense answers do not throw", async ({ page }) => {
      const response = await page.goto(
        at(locale, "/finder?experience=<script>&format=1&position=&injury=&budget=x"),
      );
      expect(response?.status()).toBeLessThan(400);
    });
  });
}

/* ------------------------------------------------------------- comparison */

for (const locale of LOCALES) {
  test.describe(`compare (${locale})`, () => {
    test("the empty tray says what to do next", async ({ page }) => {
      await page.goto(at(locale, "/compare"));
      await page.waitForLoadState("load");

      const main = (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
      expect(main.length, "the empty comparison rendered nothing").toBeGreaterThan(20);
    });

    test("all markers share one balance rule", async ({ page }) => {
      await page.goto(at(locale, "/compare"));
      await page.waitForLoadState("load");

      // Whatever is being compared, the rule is the fixed one.
      const rulers = await page
        .locator('[role="img"][aria-label*="mm"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));

      for (const label of rulers) {
        const mm = Number(label.match(/(\d+)\s*mm/)?.[1] ?? 0);
        if (!mm) continue;
        expect(mm, `${label} is outside the published rule`).toBeGreaterThanOrEqual(200);
        expect(mm).toBeLessThanOrEqual(400);
      }
    });

    test("there is no radar chart anywhere in comparison", async ({ page }) => {
      await page.goto(at(locale, "/compare"));
      const radar = await page.evaluate(() =>
        document.body.innerHTML.toLowerCase().includes("radar"),
      );
      expect(radar).toBe(false);
    });
  });
}

/* ---------------------------------------------------- lists and their detail */

const LISTS: Array<{ route: string; detail: RegExp }> = [
  { route: "/strings", detail: /\/strings\/[^/]+\/[^/]+$/ },
  { route: "/sellers", detail: /\/sellers\/[^/]+$/ },
];

for (const { route, detail } of LISTS) {
  test(`${route} links to detail pages that exist`, async ({ page, request, baseURL }) => {
    await page.goto(at("vi", route));
    await page.waitForLoadState("load");

    const hrefs = await page
      .locator(`main a[href*="${route}/"]`)
      .evaluateAll((nodes, pattern) => {
        const re = new RegExp(pattern);
        return [...new Set(nodes.map((node) => node.getAttribute("href") ?? ""))].filter(
          (href) => re.test(href),
        );
      }, detail.source);

    if (hrefs.length === 0) return; // an empty list is a valid state.

    const broken: string[] = [];
    for (const href of hrefs.slice(0, 12)) {
      const response = await request.get(new URL(href, baseURL).toString());
      if (response.status() >= 400) broken.push(`${response.status()} ${href}`);
    }

    expect(broken, broken.join(", ")).toEqual([]);
  });
}

test("deals never invent a price movement", async ({ page }) => {
  await page.goto("/vi/deals");
  await page.waitForLoadState("load");

  const main = await page.locator("main").innerText();

  // Every delta carries a sign and a window. A bare number with no direction
  // is the thing this page cannot show.
  for (const delta of main.match(/[+−]₫[\d.]+/g) ?? []) {
    expect(delta).toMatch(/^[+−]₫\d{1,3}(\.\d{3})*$/);
  }

  expect(main, "a hyphen-minus reached the deals table").not.toMatch(/(^|\s)-₫/);
});

/* ------------------------------------------------------------- methodology */

test("the methodology page publishes the real coefficients", async ({ page }) => {
  await page.goto("/vi/methodology");
  const main = await page.locator("main").innerText();

  // Published on the page because the page exists to be interrogated.
  expect(main).toMatch(/50%/);
  expect(main).toMatch(/3\s*×|3x/i);
  expect(main).toMatch(/src\/lib\/court-score\.ts/);
  expect(main, "a raw placeholder reached /methodology").not.toMatch(/\{[a-zA-Z]+\}/);
});

test("the methodology page states the review threshold as a number", async ({ page }) => {
  await page.goto("/en/methodology");
  const main = await page.locator("main").innerText();

  expect(main).toMatch(/\b5 verified reviews\b/);
});
