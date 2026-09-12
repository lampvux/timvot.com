import assert from "node:assert/strict";
import test from "node:test";
import {
  DEAL_WINDOW_POINTS,
  bySteepestDrop,
  isPriceDrop,
  variantPriceFromPoints,
} from "./price-window";
import type { PricePoint } from "./types";

/**
 * This module is imported by two things that must agree: the repository, which
 * renders a detail page's chart from `price_points`, and
 * `scripts/refresh-market.ts`, which materialises `deal_watch` from the same
 * arithmetic. If they ever disagree, the homepage reports a drop the chart
 * does not show.
 */

const series = (...prices: number[]): PricePoint[] =>
  prices.map((price, day) => ({
    variantId: "v1",
    // 2026-09-01 onward; the date only has to be ascending and parseable.
    observedOn: `2026-09-${String(day + 1).padStart(2, "0")}`,
    price,
  }));

test("an empty series has no price", () => {
  assert.equal(variantPriceFromPoints("v1", []), null);
});

test("latest is the last observation, not the lowest", () => {
  const price = variantPriceFromPoints("v1", series(100, 80, 120));
  assert.equal(price?.latest, 120);
});

test("the window is the last third of what was observed, not a fixed 30 days", () => {
  // Nine points: the last third is indexes 6,7,8 — prices 40, 30, 20.
  const price = variantPriceFromPoints("v1", series(90, 85, 80, 75, 70, 60, 40, 30, 20));
  assert.ok(price);
  assert.equal(price.median30, 30);
  // Measured from the start of that same window, so 20 - 40.
  assert.equal(price.delta30, -20);
  // And delta90 from the first observation of all.
  assert.equal(price.delta90, 20 - 90);
});

test("a drop is below its own median AND still falling", () => {
  const falling = variantPriceFromPoints("v1", series(100, 100, 100, 90, 80, 70));
  assert.ok(falling);
  assert.equal(isPriceDrop(falling), true);

  // Recovering: the last window rises, so it is not a deal even though the
  // price is under where it started.
  const recovering = variantPriceFromPoints("v1", series(100, 60, 50, 55, 60, 65));
  assert.ok(recovering);
  assert.equal(recovering.delta30 > 0, true);
  assert.equal(isPriceDrop(recovering), false);

  // Flat: nothing moved, so there is nothing to report. "Never invent
  // scarcity" applies to discounts too.
  const flat = variantPriceFromPoints("v1", series(100, 100, 100, 100, 100, 100));
  assert.ok(flat);
  assert.equal(isPriceDrop(flat), false);
});

test("steepest first means the most negative delta leads", () => {
  const small = variantPriceFromPoints("a", series(100, 100, 100, 95))!;
  const large = variantPriceFromPoints("b", series(100, 100, 100, 40))!;
  assert.equal([small, large].sort(bySteepestDrop)[0].variantId, "b");
});

test("the stored window is wider than the sparkline reads", () => {
  // The homepage draws `points.slice(-8)`. deal_watch stores this many, and
  // the headroom is what stops a slightly longer chart needing a migration.
  assert.ok(DEAL_WINDOW_POINTS >= 8);
});
