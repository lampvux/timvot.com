import assert from "node:assert/strict";
import test from "node:test";
import {
  FRESH_HOURS,
  currentOfferPrice,
  displayPrice,
  priceContext,
  type PriceContextInput,
} from "./price-context";
import type { Offer } from "./types";

/**
 * The price policy behind every "good price" sentence. Each case here is a
 * way the product could otherwise praise a listing it has no evidence for.
 */

const NOW = new Date("2026-09-27T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

let serial = 0;
const offer = (overrides: Partial<Offer> = {}): Offer => ({
  id: `o${serial++}`,
  variantId: "v4u",
  racketId: "r1",
  sellerId: `s${serial}`,
  price: 3_000_000,
  currency: "VND",
  qtyAvailable: 5,
  condition: "new",
  warrantyMonths: 12,
  includesStringing: false,
  shipsFrom: "Hà Nội",
  leadTimeDays: 2,
  promoted: false,
  status: "live",
  updatedAt: hoursAgo(1),
  ...overrides,
});

const input = (overrides: Partial<PriceContextInput> = {}): PriceContextInput => ({
  offers: [],
  msrp: 4_000_000,
  variantId: "v4u",
  condition: "new",
  askingPrice: null,
  now: NOW,
  ...overrides,
});

const threeSellers = () => [
  offer({ price: 2_800_000, sellerId: "a" }),
  offer({ price: 3_000_000, sellerId: "b" }),
  offer({ price: 3_400_000, sellerId: "c" }),
];

test("three fresh offers from two or more sellers give a comparable range", () => {
  const context = priceContext(input({ offers: threeSellers(), askingPrice: 2_900_000 }));
  assert.equal(context.status, "comparable");
  assert.deepEqual(context.range, { low: 2_800_000, median: 3_000_000, high: 3_400_000 });
  assert.equal(context.sampleSize, 3);
  assert.equal(context.sellerCount, 3);
  assert.equal(context.asking, "within");
});

test("asking position is below or above the range, never a verdict word", () => {
  assert.equal(priceContext(input({ offers: threeSellers(), askingPrice: 1 })).asking, "below");
  assert.equal(
    priceContext(input({ offers: threeSellers(), askingPrice: 9_000_000 })).asking,
    "above",
  );
  assert.equal(priceContext(input({ offers: threeSellers() })).asking, null);
});

test("a 3U price never decides a 4U listing", () => {
  const offers = threeSellers().map((o) => ({ ...o, variantId: "v3u" }));
  const context = priceContext(input({ offers }));
  assert.equal(context.status, "insufficient");
  assert.equal(context.sampleSize, 0);
});

test("unknown variant is a reference, not a verdict", () => {
  const context = priceContext(input({ offers: threeSellers(), variantId: null, askingPrice: 1 }));
  assert.equal(context.status, "reference_only");
  assert.equal(context.reason, "variant_unknown");
  assert.equal(context.asking, null);
  assert.equal(context.range, null);
});

test("a used listing is never judged against new offers", () => {
  const context = priceContext(input({ offers: threeSellers(), condition: "used", askingPrice: 1 }));
  assert.equal(context.status, "reference_only");
  assert.equal(context.reason, "condition_used");
  assert.equal(context.asking, null);
});

test("seller-declared used offers do not make a used range either", () => {
  const used = threeSellers().map((o) => ({ ...o, condition: "used-good" as const }));
  const context = priceContext(input({ offers: used, condition: "used" }));
  assert.equal(context.status, "reference_only");
  // The reference shown is new retail only.
  assert.equal(context.sampleSize, 0);
});

test("unknown condition is a reference", () => {
  const context = priceContext(input({ offers: threeSellers(), condition: "unknown" }));
  assert.equal(context.status, "reference_only");
  assert.equal(context.reason, "condition_unknown");
});

test("open-box is compared only with open-box", () => {
  const offers = [
    ...threeSellers(),
    offer({ condition: "open-box", sellerId: "x" }),
  ];
  const context = priceContext(input({ offers, condition: "open-box" }));
  assert.equal(context.status, "insufficient");
  assert.equal(context.sampleSize, 1);
});

test("one seller with many offers is insufficient", () => {
  const offers = [offer({ sellerId: "a" }), offer({ sellerId: "a" }), offer({ sellerId: "a" })];
  assert.equal(priceContext(input({ offers })).status, "insufficient");
});

test("no offers is insufficient, with MSRP kept apart", () => {
  const context = priceContext(input());
  assert.equal(context.status, "insufficient");
  assert.equal(context.currentOfferPrice, null);
  assert.equal(context.msrp, 4_000_000);
});

test("enough offers that are all old are stale, not comparable", () => {
  const offers = threeSellers().map((o) => ({ ...o, updatedAt: hoursAgo(FRESH_HOURS + 1) }));
  const context = priceContext(input({ offers, askingPrice: 1 }));
  assert.equal(context.status, "stale");
  assert.equal(context.range, null);
  assert.equal(context.asking, null);
  assert.equal(context.sampleSize, 3);
});

test("out of stock and paused offers are not evidence", () => {
  const offers = [
    ...threeSellers().slice(0, 2),
    offer({ sellerId: "c", qtyAvailable: 0 }),
    offer({ sellerId: "d", status: "paused" }),
  ];
  assert.equal(priceContext(input({ offers })).status, "insufficient");
});

test("several prices on one day from different sellers all count", () => {
  const sameDay = hoursAgo(2);
  const offers = threeSellers().map((o) => ({ ...o, updatedAt: sameDay }));
  const context = priceContext(input({ offers }));
  assert.equal(context.status, "comparable");
  assert.equal(context.observedAt, sameDay);
});

test("an outlier moves the range but not the median", () => {
  const offers = [...threeSellers(), offer({ price: 9_900_000, sellerId: "d" })];
  const context = priceContext(input({ offers }));
  assert.equal(context.range?.high, 9_900_000);
  assert.equal(context.range?.median, 3_200_000);
});

test("currentOfferPrice is the lowest live new offer, never MSRP", () => {
  assert.equal(currentOfferPrice([]), null);
  assert.equal(
    currentOfferPrice([
      offer({ price: 1_000_000, condition: "used-fair" }),
      offer({ price: 2_000_000, qtyAvailable: 0 }),
      offer({ price: 2_500_000 }),
    ]),
    2_500_000,
  );
});

test("displayPrice labels MSRP when there is no offer", () => {
  assert.deepEqual(displayPrice({ lowestPrice: null, msrp: 4_000_000 }), {
    amount: 4_000_000,
    kind: "msrp",
  });
  assert.deepEqual(displayPrice({ lowestPrice: 3_000_000, msrp: 4_000_000 }), {
    amount: 3_000_000,
    kind: "offer",
  });
});
