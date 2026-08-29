import assert from "node:assert/strict";
import test from "node:test";
import { matchString } from "./catalogue";
import { parseWooStringProducts } from "./woocommerce";

test("matches familiar retailer spellings without matching accessories", () => {
  assert.equal(matchString("Cước cầu lông Yonex BG 80 Power chính hãng")?.slug, "bg80-power");
  assert.equal(matchString("Dây cước Victor VBS-66N màu trắng")?.slug, "vbs-66-nano");
  assert.equal(matchString("Gosen G-TONE 5 200m")?.slug, "g-tone-5");
  assert.equal(matchString("Kìm cắt cước Yonex"), null);
});

test("normalizes WooCommerce price and availability", () => {
  const parsed = parseWooStringProducts("fbshop", [{ id: 42, name: "Li-Ning No.1 Boost", permalink: "https://example.test/no1", prices: { price: "18900000", currency_minor_unit: 2 }, is_in_stock: true, low_stock_remaining: 4 }], "2026-08-29T00:00:00Z");
  assert.equal(parsed.offers.length, 1);
  assert.deepEqual({ price: parsed.offers[0].price, qty: parsed.offers[0].qtyAvailable, id: parsed.offers[0].stringId }, { price: 189000, qty: 4, id: "str-li-ning-no-1-boost" });
});

test("keeps one lowest in-stock listing per seller and string", () => {
  const product = (id: number, price: string, inStock: boolean) => ({ id, name: "Yonex BG80", permalink: `https://example.test/${id}`, prices: { price, currency_minor_unit: 0 }, is_in_stock: inStock });
  const parsed = parseWooStringProducts("hvshop", [product(1, "150000", false), product(2, "210000", true), product(3, "190000", true)]);
  assert.equal(parsed.offers.length, 1);
  assert.equal(parsed.offers[0].externalId, "3");
  assert.equal(parsed.offers[0].price, 190000);
});
