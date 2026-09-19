import {
  at,
  countCards,
  expect,
  expectNoConsoleErrors,
  LOCALES,
  test,
  visit,
} from "./fixtures";

/**
 * The racket detail page is the deepest read in the app and the one that
 * publishes the product's central claim.
 *
 * Two things it must never do: publish half a Court Score under the name of a
 * whole one, and plot a racket on a rule it scaled to fit.
 */

/** A seeded racket that has enough reviews to carry a full score, and one
 *  that does not. Both are asserted to exist by the guardrail suite. */
const SCORED = "/rackets/yonex/astrox-99-pro";

for (const locale of LOCALES) {
  test.describe(`racket detail (${locale})`, () => {
    test("renders, is accessible, and fits the viewport", async ({ page, errors }) => {
      await visit(page, at(locale, SCORED));

      await expect(page.locator("h1").first()).toBeVisible();
      expectNoConsoleErrors(errors, at(locale, SCORED));
    });

    test("the model name is never translated", async ({ page }) => {
      await page.goto(at(locale, SCORED));

      const heading = (await page.locator("h1").first().textContent()) ?? "";
      expect(
        heading,
        "the model name changed between locales. A spec code is what is " +
          "printed on the racket.",
      ).toContain("Astrox");
    });

    test("a Court Score is either whole or absent, never half", async ({ page }) => {
      await page.goto(at(locale, SCORED));
      await page.waitForLoadState("load");
      await page.waitForTimeout(400);
      const main = (await page.locator("main").innerText()) ?? "";

      const saysSpecOnly = /spec profile only|chỉ có hồ sơ thông số/i.test(main);
      const hasScore = /court score/i.test(main);

      expect(hasScore, "the detail page no longer mentions the Court Score").toBe(true);

      if (saysSpecOnly) {
        // Under the threshold the page says so, and the sentence carries the
        // real numbers rather than a raw placeholder.
        expect(main).not.toContain("{needed}");
        expect(main).not.toContain("{count}");
        expect(main).toMatch(/\d/);

        // And it publishes no total. A number out of 100 beside those words
        // would be the spec half wearing the whole score's name.
        expect(
          main,
          "the page says spec profile only and still shows a score out of 100.",
        ).not.toMatch(/\/\s*100/);
      } else {
        // Over it, a whole score is published — a number out of 100, and a
        // route to the methodology that explains where it came from.
        expect(main).toMatch(/\/\s*100/);
        await expect(
          page.locator(`main a[href="${at(locale, "/methodology")}"]`).first(),
        ).toBeVisible();
      }
    });

    test("no message placeholder is rendered to a visitor", async ({ page }) => {
      // `t(key, {...})` against a message whose placeholder was renamed
      // renders the brace form. It is invisible in review and obvious on screen.
      await page.goto(at(locale, SCORED));
      const main = await page.locator("main").innerText();

      expect(main, "an uninterpolated ICU placeholder reached the page").not.toMatch(
        /\{[a-zA-Z]+\}/,
      );
    });

    test("the balance ruler plots on the fixed 280–305 mm rule", async ({ page }) => {
      await page.goto(at(locale, SCORED));
      await page.waitForLoadState("load");
      await page.waitForTimeout(400);

      // The ruler labels its own endpoints. Both have to be the constants, or
      // the rule has been fitted to its data — and two rackets 2 mm apart
      // would then look like opposites.
      const main = await page.locator("main").innerText();
      expect(main).toContain("280");
      expect(main).toContain("305");

      // The marker itself sits inside the rule, expressed as a percentage of
      // it rather than of whatever range this page happens to show.
      const marker = page.locator('[role="img"][aria-label*="mm"]').first();
      await expect(marker).toBeVisible();
    });

    test("the spec sheet renders values, not the raw enum", async ({ page }) => {
      await page.goto(at(locale, SCORED));
      const main = await page.locator("main").innerText();

      for (const raw of [
        "extra-stiff",
        "head-heavy",
        "head-light",
        "aero-box",
        "all-round",
        "open-box",
        "used-excellent",
      ]) {
        expect(main, `the raw enum "${raw}" reached the page`).not.toContain(raw);
      }
    });

    test("prices are written in full", async ({ page }) => {
      await page.goto(at(locale, SCORED));
      const main = await page.locator("main").innerText();

      const abbreviated = main.match(/₫\s*\d+([.,]\d+)?\s*(M|K|tr)\b/g) ?? [];
      expect(
        abbreviated,
        `the detail page abbreviated ${abbreviated.join(", ")}. Approximation ` +
          `is what the product is fixing.`,
      ).toEqual([]);

      // Whatever prices there are use the house grouping.
      for (const price of main.match(/₫[\d.,]+/g) ?? []) {
        expect(price, `${price} is not grouped with full stops`).toMatch(
          /^₫\d{1,3}(\.\d{3})*$/,
        );
      }
    });

    test("a minus sign is U+2212, never a hyphen", async ({ page }) => {
      await page.goto(at(locale, "/deals"));
      const main = await page.locator("main").innerText();

      const hyphenated = main.match(/-₫[\d.]+/g) ?? [];
      expect(
        hyphenated,
        `${hyphenated.join(", ")} uses a hyphen-minus. It renders visibly ` +
          `shorter than the plus it has to align with in a table.`,
      ).toEqual([]);
    });

    test("there is no radar chart", async ({ page }) => {
      await page.goto(at(locale, SCORED));

      const radar = await page.evaluate(() =>
        document.body.innerHTML.toLowerCase().includes("radar"),
      );
      expect(radar, "a radar chart appeared on the detail page").toBe(false);
    });

    test("an unknown racket renders the not-found state with a way back", async ({
      page,
    }) => {
      // Deliberately not a status assertion. Under Cache Components an
      // unlisted path serves its App Shell immediately and resolves behind it,
      // so `notFound()` runs after the response has already been flushed and
      // cannot change the status code. What a visitor gets is what matters
      // here: the not-found state, and a link back to the catalogue.
      await page.goto(at(locale, "/rackets/yonex/does-not-exist"));
      await page.waitForLoadState("load");
      await page.waitForTimeout(400);

      const main = await page.locator("main").innerText();
      expect(main.replace(/\s+/g, " ").trim().length).toBeGreaterThan(20);

      await expect(
        page.locator(`main a[href="${at(locale, "/rackets")}"]`).first(),
      ).toBeVisible();
    });

    test("an unknown brand does not render another brand's racket", async ({ page }) => {
      await page.goto(at(locale, "/rackets/nope/astrox-99-pro"));
      await page.waitForLoadState("load");
      await page.waitForTimeout(400);

      const main = await page.locator("main").innerText();
      expect(
        /court score/i.test(main),
        "a racket under the wrong brand rendered its full detail page.",
      ).toBe(false);
    });

    test("a path-traversal attempt reads nothing off disk", async ({ page }) => {
      for (const path of [
        "/rackets/yonex/..%2f..%2fetc%2fpasswd",
        "/rackets/%2e%2e/%2e%2e/admin",
      ]) {
        const response = await page.goto(at(locale, path));
        const status = response?.status() ?? 0;
        expect([200, 400, 404]).toContain(status);

        const body = await page.locator("body").innerText();
        expect(body).not.toMatch(/root:x:|\[extensions\]|BEGIN (RSA|OPENSSH)/);
      }
    });
  });
}

test.describe("racket detail — every seeded racket", () => {
  test("every card on the catalogue reaches a page that renders", async ({
    page,
    request,
    baseURL,
  }) => {
    // The 1000-row truncation bug 404ed every detail page past the cap while
    // the rows sat in Postgres. Walking the whole seeded catalogue is the
    // cheap version of that check.
    await page.goto("/vi/rackets");

    // The results stream in behind a Suspense boundary, so `load` is not when
    // they are there. Under a parallel run the gap is wide enough to read an
    // empty grid — which is a flake, and a flake in a suite this size is worse
    // than the bug it would have caught.
    await countCards(page);

    const hrefs = await page
      .locator('main a[href*="/rackets/"]')
      .evaluateAll((nodes) =>
        [...new Set(nodes.map((node) => node.getAttribute("href") ?? ""))].filter(
          (href) => /\/rackets\/[^/]+\/[^/]+$/.test(href),
        ),
      );

    expect(hrefs.length).toBeGreaterThan(5);

    const broken: string[] = [];
    for (const href of hrefs) {
      const response = await request.get(new URL(href, baseURL).toString());
      if (response.status() >= 400) broken.push(`${response.status()} ${href}`);
    }

    expect(broken, `${broken.join(", ")} 404ed from its own catalogue card`).toEqual([]);
  });
});
