import { at, expect, LOCALES, test, waitForStreamedContent } from "./fixtures";

/**
 * The seller directory ranks on measured numbers, filters through the URL,
 * and states no order or stock counts — on the card or on the seller page.
 */

const cards = "main ol > li";

for (const locale of LOCALES) {
  test.describe(`seller directory (${locale})`, () => {
    test("ranks every seller, numbered from one", async ({ page }) => {
      await page.goto(at(locale, "/sellers"));
      await waitForStreamedContent(page);
      const ranks = await page.locator(`${cards} span[aria-label]`).allInnerTexts();
      expect(ranks.length).toBeGreaterThan(1);
      expect(ranks).toEqual(ranks.map((_, i) => `#${i + 1}`));
    });

    test("the default ranking is by rackets in stock, highest first", async ({ page }) => {
      await page.goto(at(locale, "/sellers"));
      await waitForStreamedContent(page);
      // The first stat on each card is its rackets-in-stock count.
      const counts = await page
        .locator(`${cards} dl > div:first-child dd`)
        .allInnerTexts()
        .then((values) => values.map(Number));
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    test("a city filter is a link, lands in the URL and narrows the list", async ({ page }) => {
      await page.goto(at(locale, "/sellers"));
      await waitForStreamedContent(page);
      const all = await page.locator(cards).count();
      await page.getByRole("link", { name: "Hà Nội", exact: true }).click();
      await expect(page).toHaveURL(/city=H%C3%A0\+N%E1%BB%99i|city=H%C3%A0%20N%E1%BB%99i/);
      await waitForStreamedContent(page);
      const shown = page.locator(cards);
      await expect(shown.first()).toBeVisible();
      expect(await shown.count()).toBeLessThan(all);
      const shownCities = await page
        .locator(`${cards} [data-seller-city]`)
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-seller-city")));
      expect(shownCities.length).toBeGreaterThan(0);
      for (const city of shownCities) {
        expect(city).toBe("Hà Nội");
      }
      // The chip that is applied says so to assistive tech.
      await expect(page.getByRole("link", { name: "Hà Nội", exact: true })).toHaveAttribute(
        "aria-current",
        "true",
      );
    });

    test("a filter with no match says how to get back, with the count", async ({ page }) => {
      await page.goto(at(locale, "/sellers?city=H%E1%BA%A3i+Ph%C3%B2ng&tier=authorised"));
      await waitForStreamedContent(page);
      await expect(page.locator(cards)).toHaveCount(0);
      const main = await page.locator("main").innerText();
      expect(main).toMatch(/\d+/);
    });

    test("an unknown sort falls back to the default instead of failing", async ({ page }) => {
      const response = await page.goto(at(locale, "/sellers?sort=orders&city=Paris"));
      expect(response?.status()).toBe(200);
      await waitForStreamedContent(page);
      expect(await page.locator(cards).count()).toBeGreaterThan(1);
    });

    test("neither the directory nor a seller page shows orders or stock", async ({ page }) => {
      const banned = locale === "en" ? /\b(Orders|Stock)\b/ : /Đơn hàng|Tồn kho/;
      await page.goto(at(locale, "/sellers"));
      await waitForStreamedContent(page);
      expect(await page.locator("main ol").innerText()).not.toMatch(banned);

      // Use a stable seeded seller here. The directory order is the subject of
      // the ranking tests above; coupling this content check to whichever
      // seller ranks first makes it depend on mutable inventory data.
      await page.goto(at(locale, "/sellers/shuttle-pro-hn"));
      await waitForStreamedContent(page);
      await expect(page.locator("main h1").first()).toBeVisible();
      const stats = await page.locator("main dl").first().innerText();
      expect(stats).not.toMatch(banned);
      const headers = await page.locator("main table thead").innerText().catch(() => "");
      expect(headers).not.toMatch(banned);
    });
  });
}
