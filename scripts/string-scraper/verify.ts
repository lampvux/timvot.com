import { chromium } from "playwright";
import type { ScrapedStringOffer } from "./types";

export async function verifyStringOffers(offers: ScrapedStringOffer[], sampleSize = 3): Promise<{ checked: number; failures: string[]; skipped?: string }> {
  if (!offers.length) return { checked: 0, failures: [] };
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    return { checked: 0, failures: [], skipped: `Chromium unavailable: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
  }
  const failures: string[] = [];
  let checked = 0;
  try {
    const page = await browser.newPage();
    for (const offer of offers.slice(0, sampleSize)) {
      const response = await page.goto(offer.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
      checked++;
      if (!response?.ok()) failures.push(`${offer.url} returned ${response?.status() ?? "no response"}`);
      else if (!(await page.locator("body").innerText()).toLowerCase().includes(offer.title.toLowerCase().slice(0, 12))) failures.push(`${offer.url} did not contain the listing title`);
    }
  } finally {
    await browser.close();
  }
  return { checked, failures };
}
