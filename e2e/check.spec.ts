import { at, expect, LOCALES, test, visit } from "./fixtures";

/**
 * The listing check: a buyer arrives from a Facebook post with a model name,
 * a price and a condition, and leaves with a fit answer, an honest price
 * answer and three questions for the seller.
 *
 * Runs against the seeded catalogue, where `Astrox 77 Pro` exists and has
 * several variants — enough to exercise confirmation without guessing.
 */

const MODEL = "yonex/astrox-77-pro";

for (const locale of LOCALES) {
  test.describe(`listing check (${locale})`, () => {
    test("the form finds a model, and the result answers all three questions", async ({ page }) => {
      await visit(page, at(locale, "/check"));

      const combobox = page.getByRole("combobox");
      await combobox.fill("astrox 77");
      const option = page.getByRole("option").first();
      await expect(option).toBeVisible();
      await option.click();

      await page.locator('input[inputmode="decimal"]').fill("2tr5");
      await page.locator('input[name="condition"][value="used"]').check();
      await page.locator('button[type="submit"]').click();

      await page.waitForURL(/model=/);
      const url = new URL(page.url());
      expect(url.searchParams.get("price")).toBe("2500000");
      expect(url.searchParams.get("condition")).toBe("used");

      // Model, fit, price, questions — in that order on a phone.
      const headings = await page.locator("main h2").allInnerTexts();
      expect(headings.length).toBeGreaterThanOrEqual(4);
      await expect(page.locator("#check-questions")).toBeVisible();
      await expect(page.locator("#check-inspection")).toBeVisible();
    });

    test("a used listing is never judged against new prices", async ({ page }) => {
      await visit(page, at(locale, `/check?model=${MODEL}&price=100000&condition=used`));
      const price = await page.locator("#check-price").locator("..").innerText();
      // Reference only: no range, no below/above verdict.
      expect(price).not.toMatch(/median|trung vị/i);
    });

    test("an unknown model still gets questions, and says it is unconfirmed", async ({ page }) => {
      await visit(page, at(locale, "/check?q=Mystery%20Frame%20X"));
      await expect(page.locator("h1")).toHaveText("Mystery Frame X");
      await expect(page.locator("#check-questions")).toBeVisible();
    });

    test("the result is noindex, and the empty form is not", async ({ page }) => {
      await page.goto(at(locale, `/check?model=${MODEL}&condition=new`));
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await page.goto(at(locale, "/check"));
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    });
  });
}

test("a share link carries no profile answers", async ({ page }) => {
  await page.goto(at("en", `/check?model=${MODEL}&condition=new&price=3000000&exp=under1&pos=net`));
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy share link" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("model=");
  expect(copied).not.toMatch(/exp=|pos=|fmt=/);
});

test("model search rejects a query it should not scan for", async ({ request }) => {
  expect((await request.get("/api/rackets/search?q=a")).status()).toBe(400);
  expect((await request.get(`/api/rackets/search?q=${"x".repeat(61)}`)).status()).toBe(400);
  const ok = await request.get("/api/rackets/search?q=astrox%2077");
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { candidates: unknown[] };
  expect(body.candidates.length).toBeLessThanOrEqual(8);
});
