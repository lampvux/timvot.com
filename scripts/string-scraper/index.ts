import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../scraper/env";
import { STRING_SITES, scrapeWooStrings } from "./woocommerce";
import { verifyStringOffers } from "./verify";
import type { ScrapedStringOffer, StringSource } from "./types";

const validSources = Object.keys(STRING_SITES) as StringSource[];
const args = new Map(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
  const [key, value] = arg.slice(2).split("="); return [key, value ?? "true"];
}));
const selected = args.get("site") && args.get("site") !== "all"
  ? args.get("site")!.split(",").filter((source): source is StringSource => validSources.includes(source as StringSource))
  : validSources;
const shouldSync = args.get("sync-db") === "true";
const shouldVerify = args.get("verify") === "true";
const output = args.get("out") ?? "scripts/string-scraper/output/strings.json";

async function sync(offers: ScrapedStringOffer[], completedSources: StringSource[]) {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --sync-db");
  const supabase = createClient(url, key);
  const today = new Date().toISOString().slice(0, 10);
  for (const source of selected) {
    const { error } = await supabase.from("sellers").upsert({ id: `s-${source}`, slug: source, name: `${source.toUpperCase()} Store`, tier: "verified", city: "Việt Nam", rating: 0, orders_count: 0, since: new Date().getFullYear() }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`sellers: ${error.message}`);
  }
  const offerRows = offers.map((offer) => ({ id: `so-${offer.source}-${offer.stringId}`, string_id: offer.stringId, seller_id: `s-${offer.source}`, price: offer.price, currency: "VND", qty_available: offer.qtyAvailable, status: offer.inStock ? "live" : "paused", updated_at: offer.scrapedAt }));
  const lowest = new Map<string, number>();
  for (const offer of offers.filter((item) => item.inStock)) lowest.set(offer.stringId, Math.min(lowest.get(offer.stringId) ?? Infinity, offer.price));
  const historyRows = [...lowest].map(([string_id, price]) => ({ string_id, observed_on: today, price }));
  const offerResult = await supabase.from("string_offers").upsert(offerRows, { onConflict: "id" });
  if (offerResult.error) throw new Error(`string_offers: ${offerResult.error.message}`);
  const historyResult = await supabase.from("string_price_points").upsert(historyRows, { onConflict: "string_id,observed_on" });
  if (historyResult.error) throw new Error(`string_price_points: ${historyResult.error.message}`);
  // A successful full search is authoritative for availability. Pause a
  // seller's old rows that disappeared; never do this for a failed source.
  let retired = 0;
  for (const source of completedSources) {
    const seenIds = new Set(offerRows.filter((row) => row.seller_id === `s-${source}`).map((row) => row.id));
    const existing = await supabase.from("string_offers").select("id").eq("seller_id", `s-${source}`).eq("status", "live");
    if (existing.error) throw new Error(`string_offers availability read: ${existing.error.message}`);
    const stale = (existing.data ?? []).map((row) => String(row.id)).filter((id) => !seenIds.has(id));
    if (stale.length) {
      const paused = await supabase.from("string_offers").update({ status: "paused", qty_available: 0, updated_at: new Date().toISOString() }).in("id", stale);
      if (paused.error) throw new Error(`string_offers availability update: ${paused.error.message}`);
      retired += stale.length;
    }
  }
  console.log(`📡 Synced ${offerRows.length} offers, ${historyRows.length} daily prices, and paused ${retired} unavailable offers.`);
}

async function main() {
  if (!selected.length) throw new Error(`No valid sites selected. Choose: ${validSources.join(", ")}`);
  const results = [];
  for (const source of selected) {
    console.log(`🔄 [${source.toUpperCase()}] crawling badminton strings…`);
    const result = await scrapeWooStrings(STRING_SITES[source], { verbose: args.get("verbose") === "true" });
    results.push(result);
    console.log(result.success ? `✅ ${result.offers.length} offers from ${result.productsExamined} candidate products` : `❌ ${result.error}`);
  }
  const offers = results.flatMap((result) => result.offers);
  const path = resolve(output); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ scrapedAt: new Date().toISOString(), results, offers }, null, 2));
  console.log(`💾 Wrote ${offers.length} offers to ${output}`);
  if (shouldVerify) {
    const verification = await verifyStringOffers(offers, Number(args.get("sample") ?? 3));
    if (verification.skipped) console.warn(`⚠️ Browser verification skipped: ${verification.skipped}`);
    else console.log(`${verification.failures.length ? "❌" : "✅"} Browser checked ${verification.checked} listings (${verification.failures.length} failures).`);
    if (verification.failures.length) process.exitCode = 1;
  }
  if (shouldSync) await sync(offers, results.filter((result) => result.success).map((result) => result.source));
  if (results.some((result) => !result.success)) process.exitCode = 1;
}

main().catch((error) => { console.error(`❌ ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
