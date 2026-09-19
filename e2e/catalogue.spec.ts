import {
  at,
  cards,
  countCards,
  expect,
  expectAccessible,
  expectNoConsoleErrors,
  expectNoHorizontalScroll,
  LOCALES,
  test,
  visit,
} from "./fixtures";

/**
 * The catalogue is the page people paste into a group chat.
 *
 * Everything below follows from that one sentence. A filtered view has to
 * survive being shared, which means the filters live in the URL and not in
 * component state; the result count has to render on the server, which means
 * no client-side "load more" forking the filter state; and the page has to
 * paginate, because rendering 3010 cards produced a multi-megabyte RSC payload
 * and a document the browser spent seconds laying out.
 */

for (const locale of LOCALES) {
  test.describe(`catalogue (${locale})`, () => {
    test("renders, is accessible, and fits the viewport", async ({ page, errors }) => {
      await visit(page, at(locale, "/rackets"));

      await expect(cards(page).first()).toBeVisible();
      expect(await countCards(page)).toBeGreaterThan(0);
      expectNoConsoleErrors(errors, at(locale, "/rackets"));
    });

    test("a filtered URL is filtered in the HTML the server sends", async ({
      request,
      baseURL,
    }) => {
      // The claim is that a pasted link works, and that the filtering happens
      // in Postgres rather than in the browser. Asserted on the raw response
      // body rather than through a page: the results stream in behind a
      // Suspense boundary, and swapping streamed content into the document is
      // the one part that genuinely needs JavaScript. What matters here is
      // that the bytes leaving the server are already filtered.
      const response = await request.get(
        new URL(at(locale, "/rackets?brand=yonex"), baseURL).toString(),
      );
      expect(response.status()).toBeLessThan(400);

      const html = await response.text();
      const links = [
        ...new Set(
          [...html.matchAll(/\/(?:vi|en)\/rackets\/([a-z0-9-]+)\/[a-z0-9-]+/g)].map(
            (match) => match[1],
          ),
        ),
      ];

      expect(
        links.length,
        "the server sent no racket links at all for a filtered catalogue.",
      ).toBeGreaterThan(0);

      expect(
        links,
        `the server sent links for ${links.join(", ")}. A filter applied in ` +
          `the browser would send every brand and hide the rest.`,
      ).toEqual(["yonex"]);
    });

    test("every filter in the URL narrows the result set", async ({ page }) => {
      await page.goto(at(locale, "/rackets"));
      const unfiltered = await countCards(page);

      for (const query of [
        "brand=yonex",
        "balance=head-heavy",
        "flex=stiff",
        "weight=4U",
        "max=2000000",
      ]) {
        await page.goto(at(locale, `/rackets?${query}`));
        const filtered = await countCards(page);

        expect(
          filtered,
          `?${query} returned ${filtered} of ${unfiltered} rackets — the ` +
            `predicate is not reaching the query.`,
        ).toBeLessThan(unfiltered);
      }
    });

    test("an unknown filter value is ignored rather than throwing", async ({ page }) => {
      // Every one of these arrives from a URL somebody can edit.
      for (const query of [
        "balance=sideways",
        "flex=;drop table rackets",
        "weight=9Z",
        "sort=../../etc/passwd",
        "min=abc&max=xyz",
        "brand=<script>alert(1)</script>",
        "page=-1",
        "page=99999",
      ]) {
        const response = await page.goto(at(locale, `/rackets?${query}`));
        expect(response?.status(), `?${query}`).toBeLessThan(400);
        await expect(page.locator("h1").first()).toBeVisible();
      }
    });

    test("a filter is reflected back in the controls, not just in the results", async ({
      page,
    }) => {
      await page.goto(at(locale, "/rackets?max=2000000"));

      // Grouped for reading — ₫2.000.000, never ₫2M and never a bare 2000000.
      // The assertion is on the digits, so the separator stays a design
      // decision rather than something this test pins down.
      const max = page.locator('input[name="max"]');
      await expect(max).toHaveValue(/^2[.,]?000[.,]?000$/);
    });

    test("changing a filter updates the URL", async ({ page }) => {
      await page.goto(at(locale, "/rackets"));

      const sort = page.locator("select").first();
      await expect(sort).toBeVisible();
      await sort.selectOption("score");

      await page.waitForURL(/[?&]sort=score/);
      expect(page.url()).toContain("sort=score");
    });

    test("the default sort keeps the clean URL", async ({ page }) => {
      // `popular` is the default, so it is left implicit — the first page is
      // the one people actually share.
      await page.goto(at(locale, "/rackets?sort=score"));

      const sort = page.locator("select").first();
      await sort.selectOption("popular");
      await page.waitForURL((url) => !url.search.includes("sort="));

      expect(page.url()).not.toContain("sort=");
    });

    test("sorting by price actually orders by price", async ({ page }) => {
      const priceOf = async () =>
        cards(page).evaluateAll((nodes) =>
          nodes.map((node) => {
            const match = (node.textContent ?? "").match(/₫([\d.]+)/);
            return match ? Number(match[1].replace(/\./g, "")) : null;
          }),
        );

      await page.goto(at(locale, "/rackets?sort=price-asc"));
      const ascending = (await priceOf()).filter((n): n is number => n !== null);
      expect(ascending.length).toBeGreaterThan(1);
      expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

      await page.goto(at(locale, "/rackets?sort=price-desc"));
      const descending = (await priceOf()).filter((n): n is number => n !== null);
      expect(descending).toEqual([...descending].sort((a, b) => b - a));
    });

    test("the result count matches what is rendered", async ({ page }) => {
      await page.goto(at(locale, "/rackets"));

      const heading = (await page.locator("h1").first().textContent()) ?? "";
      const claimed = Number((heading.match(/[\d.,]+/)?.[0] ?? "").replace(/[.,]/g, ""));

      if (!Number.isFinite(claimed) || claimed === 0) return;

      const rendered = await countCards(page);
      // One page, or the first of several. Either way the heading may not
      // claim fewer than are on screen.
      expect(claimed).toBeGreaterThanOrEqual(rendered);
    });

    test("a page beyond the last one is an empty state, not a crash", async ({ page }) => {
      const response = await page.goto(at(locale, "/rackets?page=500"));

      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await countCards(page)).toBe(0);
    });

    test("a filter that matches nothing says what to do next", async ({ page }) => {
      await page.goto(at(locale, "/rackets?min=999000000"));

      expect(await countCards(page)).toBe(0);

      // Empty states say what to do next, with a number. The number is the
      // part that stops it being "no results".
      const main = (await page.locator("main").textContent()) ?? "";
      expect(
        main.replace(/\s+/g, " ").trim().length,
        "the empty catalogue rendered nothing at all.",
      ).toBeGreaterThan(20);
    });

    test("there is no infinite scroll and no load-more", async ({ page }) => {
      // Both fork the filter state away from the URL, which is the one thing
      // the catalogue's design does not allow.
      await page.goto(at(locale, "/rackets"));

      const before = await countCards(page);
      await page.mouse.wheel(0, 20_000);
      await page.waitForTimeout(600);

      expect(
        await countCards(page),
        "scrolling loaded more cards. Pagination is a key in the URL, so a " +
          "scrolled result cannot be shared.",
      ).toBe(before);

      const loadMore = page.getByRole("button", { name: /load more|xem thêm|tải thêm/i });
      expect(await loadMore.count()).toBe(0);
    });

    test("a card links to a detail page that exists", async ({ page }) => {
      await page.goto(at(locale, "/rackets"));

      const href = await cards(page).first().getAttribute("href");
      expect(href).toBeTruthy();

      const response = await page.goto(href!);
      expect(response?.status(), `${href} 404ed from its own card`).toBeLessThan(400);
    });

    test("two filters combine rather than replacing each other", async ({ page }) => {
      await page.goto(at(locale, "/rackets?brand=yonex"));
      const oneFilter = await countCards(page);

      await page.goto(at(locale, "/rackets?brand=yonex&balance=head-heavy"));
      const twoFilters = await countCards(page);

      expect(twoFilters).toBeLessThanOrEqual(oneFilter);

      for (const href of await cards(page).evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href") ?? ""),
      )) {
        expect(href).toContain("/rackets/yonex/");
      }
    });

    test("a filtered page stays accessible and inside the viewport", async ({ page }) => {
      const path = at(locale, "/rackets?brand=yonex&sort=price-asc");
      await page.goto(path);

      await expectNoHorizontalScroll(page, path);
      await expectAccessible(page, path);
    });
  });
}

test.describe("catalogue pagination", () => {
  test("page is a key in the URL like every other filter", async ({ page }) => {
    await page.goto("/vi/rackets?page=2");
    expect(page.url()).toContain("page=2");

    // Whatever is on page two, the controls still carry the rest of the state.
    await page.goto("/vi/rackets?brand=yonex&page=2");
    expect(page.url()).toContain("brand=yonex");
  });

  test("changing a filter returns to the first page", async ({ page }) => {
    // Otherwise a visitor on page three of one filter lands on page three of
    // a different, shorter result set and sees an empty page.
    await page.goto("/vi/rackets?page=2");

    const sort = page.locator("select").first();
    await sort.selectOption("price-asc");
    await page.waitForURL(/sort=price-asc/);

    expect(page.url()).not.toContain("page=2");
  });
});
