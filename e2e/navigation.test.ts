import { expect, test } from "@playwright/test";
import { instant } from "@next/playwright";

test.describe("public route App Shells", () => {
  test("catalogue has useful UI on the initial response", async ({
    page,
    baseURL,
  }) => {
    await instant(
      page,
      async () => {
        await page.goto("/vi/rackets");
        await expect(page.getByRole("status")).toContainText("Loading rackets");
      },
      { baseURL },
    );

    await expect(page.locator("h1")).toBeVisible();
  });

  test("catalogue commits immediately on client navigation", async ({ page }) => {
    await page.goto("/vi");

    await instant(page, async () => {
      await page.locator('a[href="/vi/rackets"]').first().click();
      await page.waitForURL((url) => url.pathname === "/vi/rackets");
      await expect(page.getByRole("status")).toContainText("Loading rackets");
    });

    await expect(page.locator("h1")).toBeVisible();
  });

  test("racket detail commits a geometry-matched shell", async ({ page }) => {
    await page.goto("/vi");
    const target = page.locator('a[href^="/vi/rackets/"]').first();
    const href = await target.getAttribute("href");
    expect(href).toBeTruthy();
    const path = new URL(href!, "http://local").pathname;

    await instant(page, async () => {
      await target.click();
      await page.waitForURL((url) => url.pathname === path);
      await expect(page.getByRole("status")).toContainText("Loading racket");
    });

    await expect(page.locator("h1")).toBeVisible();
  });
});
