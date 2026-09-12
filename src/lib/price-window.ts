import { median } from "./format";
import type { PricePoint } from "./types";

/**
 * What a variant's price has been doing, and what counts as a drop.
 *
 * This lives outside `data/repository.ts` for one reason: the repository is
 * `server-only`, and `scripts/refresh-market.ts` is a node script. Both need
 * this arithmetic — the repository to answer a detail page, the script to
 * materialise `deal_watch` — and a second copy in SQL or in the script is how
 * the number on the homepage and the number on the chart start to disagree.
 * Same rule as `court-score.ts`: one definition, computed in TypeScript, and
 * only the result is ever stored.
 */

export interface VariantPrice {
  variantId: string;
  latest: number;
  median30: number;
  delta90: number;
  delta30: number;
  /**
   * The observed series, oldest first.
   *
   * Whole when this came from `price_points`; a bounded trailing window when
   * it came from `deal_watch`, which stores `DEAL_WINDOW_POINTS` of it. The
   * sparkline reads the last eight either way. Anything that needs the
   * complete history has to read `price_points` — see `getVariantPrice`.
   */
  points: PricePoint[];
}

/**
 * How many trailing observations `deal_watch` carries per variant.
 *
 * The homepage sparkline draws eight. The headroom is so a chart that grows a
 * couple of points does not need a migration, and it is small on purpose:
 * a projection that quietly carried the full series would let a caller come to
 * depend on it, and then the bound becomes a silent truncation instead of a
 * documented one.
 */
export const DEAL_WINDOW_POINTS = 12;

/**
 * Shape one variant's series.
 *
 * `median30` and `delta30` are both measured over the last third of whatever
 * was observed, not over a fixed thirty days — the scraper's cadence decides
 * how many observations that is. The name is the window the product talks
 * about, not a row count.
 *
 * Points must already be ascending by `observedOn`. Callers sort once when
 * they group; sorting here would be once per variant.
 */
export function variantPriceFromPoints(
  variantId: string,
  points: PricePoint[],
): VariantPrice | null {
  if (points.length === 0) return null;

  const latest = points[points.length - 1].price;
  const lastThird = points.slice(Math.floor((points.length * 2) / 3));

  return {
    variantId,
    latest,
    median30: median(lastThird.map((point) => point.price)),
    delta90: latest - points[0].price,
    delta30: latest - lastThird[0].price,
    points,
  };
}

/**
 * A deal is below its own recent median *and* still falling.
 *
 * Both halves matter. Below the median alone catches a price that has already
 * bottomed out and started back up; falling alone catches a price still above
 * where it has been sitting. "Never invent scarcity" applies to discounts too.
 */
export function isPriceDrop(price: VariantPrice): boolean {
  return price.latest < price.median30 && price.delta30 < 0;
}

/** Steepest drop first, which is the order both deal surfaces render in. */
export function bySteepestDrop(a: VariantPrice, b: VariantPrice): number {
  return a.delta30 - b.delta30;
}
