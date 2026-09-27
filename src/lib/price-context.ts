import { median } from "./format";
import type { Condition, Offer } from "./types";

/**
 * What Timvot can honestly say about a price, and nothing more.
 *
 * One definition shared by the listing check, Finder, comparison and cards.
 * The language a page uses follows the evidence: "comparable listings" only
 * when there is enough of it, "retail reference" when the buyer's listing is
 * not like-for-like with anything tracked, and "insufficient data" otherwise.
 * "Insufficient" is a result, not an error.
 *
 * The thresholds are the initial, testable policy from
 * `docs/facebook-first-engineering-plan.md` §5 — change them here, with the
 * tests, never at a call site.
 */

/** An offer older than this is not proof that the price still holds. */
export const FRESH_HOURS = 48;
/** Minimum eligible offers, and independent sellers among them, for a range. */
export const MIN_OBSERVATIONS = 3;
export const MIN_SELLERS = 2;

/** What a buyer can say about a listing without grading wear. */
export type ListingCondition = "new" | "open-box" | "used" | "unknown";

export const LISTING_CONDITIONS: readonly ListingCondition[] = [
  "new",
  "open-box",
  "used",
  "unknown",
];

/** Retail conditions collapse to the three a buyer can name. */
export function conditionClass(condition: Condition): Exclude<ListingCondition, "unknown"> {
  if (condition === "new") return "new";
  if (condition === "open-box") return "open-box";
  return "used";
}

export type PriceStatus = "comparable" | "reference_only" | "insufficient" | "stale";

/** Why a listing could not be judged against comparable offers. */
export type ReferenceReason = "variant_unknown" | "condition_used" | "condition_unknown";

export interface PriceEvidence {
  offerId: string;
  sellerId: string;
  variantId: string;
  price: number;
  condition: Condition;
  observedAt: string;
}

export interface PriceRange {
  low: number;
  median: number;
  high: number;
}

export type AskingPosition = "below" | "within" | "above";

export interface PriceContext {
  status: PriceStatus;
  /** Set when status is `reference_only`. */
  reason: ReferenceReason | null;
  /** Offers the conclusion rests on, cheapest first. */
  evidence: PriceEvidence[];
  sampleSize: number;
  sellerCount: number;
  /** Only when status is `comparable`. */
  range: PriceRange | null;
  /** Newest observation among the evidence. */
  observedAt: string | null;
  /** Where the buyer-entered price sits, only against a comparable range. */
  asking: AskingPosition | null;
  /** Lowest live, in-stock new offer for the racket — never MSRP. */
  currentOfferPrice: number | null;
  /** The distributor's list price: a reference, not a transaction. */
  msrp: number;
}

export interface PriceContextInput {
  offers: readonly Offer[];
  msrp: number;
  variantId: string | null;
  condition: ListingCondition;
  askingPrice: number | null;
  now: Date;
}

/** Live and in stock. `updated_at` alone is not proof of stock, so freshness
 *  is judged separately. */
export function isAvailable(offer: Offer): boolean {
  return offer.status === "live" && offer.qtyAvailable > 0;
}

export function isFresh(offer: Offer, now: Date): boolean {
  const age = now.getTime() - Date.parse(offer.updatedAt);
  return Number.isFinite(age) && age <= FRESH_HOURS * 3_600_000;
}

function toEvidence(offers: readonly Offer[]): PriceEvidence[] {
  return offers
    .map((offer) => ({
      offerId: offer.id,
      sellerId: offer.sellerId,
      variantId: offer.variantId,
      price: offer.price,
      condition: offer.condition,
      observedAt: offer.updatedAt,
    }))
    .sort((a, b) => a.price - b.price);
}

function newest(evidence: readonly PriceEvidence[]): string | null {
  let latest: string | null = null;
  for (const item of evidence) if (!latest || item.observedAt > latest) latest = item.observedAt;
  return latest;
}

function enough(offers: readonly Offer[]): boolean {
  return (
    offers.length >= MIN_OBSERVATIONS &&
    new Set(offers.map((offer) => offer.sellerId)).size >= MIN_SELLERS
  );
}

/** The lowest live, in-stock new offer. Null when there is none — a caller
 *  that wants a number to show must label MSRP as MSRP. */
export function currentOfferPrice(offers: readonly Offer[]): number | null {
  let lowest: number | null = null;
  for (const offer of offers) {
    if (!isAvailable(offer) || offer.condition !== "new") continue;
    if (lowest === null || offer.price < lowest) lowest = offer.price;
  }
  return lowest;
}

export function priceContext(input: PriceContextInput): PriceContext {
  const { offers, msrp, variantId, condition, askingPrice, now } = input;
  const available = offers.filter(isAvailable);
  const base = { currentOfferPrice: currentOfferPrice(offers), msrp };

  // Not like-for-like: show new retail offers for the racket as a labelled
  // reference and draw no conclusion about the asking price.
  const reason: ReferenceReason | null =
    condition === "unknown"
      ? "condition_unknown"
      : condition === "used"
        ? "condition_used"
        : variantId === null
          ? "variant_unknown"
          : null;

  if (reason) {
    const reference = available.filter(
      (offer) =>
        offer.condition === "new" && (variantId === null || offer.variantId === variantId),
    );
    const evidence = toEvidence(reference.filter((offer) => isFresh(offer, now)));
    return {
      ...base,
      status: "reference_only",
      reason,
      evidence,
      sampleSize: evidence.length,
      sellerCount: new Set(evidence.map((item) => item.sellerId)).size,
      range: null,
      observedAt: newest(evidence),
      asking: null,
    };
  }

  const eligible = available.filter(
    (offer) => offer.variantId === variantId && conditionClass(offer.condition) === condition,
  );
  const fresh = eligible.filter((offer) => isFresh(offer, now));

  if (enough(fresh)) {
    const evidence = toEvidence(fresh);
    const prices = evidence.map((item) => item.price);
    const range = { low: prices[0], median: median(prices), high: prices[prices.length - 1] };
    return {
      ...base,
      status: "comparable",
      reason: null,
      evidence,
      sampleSize: evidence.length,
      sellerCount: new Set(evidence.map((item) => item.sellerId)).size,
      range,
      observedAt: newest(evidence),
      asking:
        askingPrice === null
          ? null
          : askingPrice < range.low
            ? "below"
            : askingPrice > range.high
              ? "above"
              : "within",
    };
  }

  // Enough offers exist but too many are old: say the evidence is stale
  // rather than pretend there is none.
  const status: PriceStatus = fresh.length < eligible.length && enough(eligible) ? "stale" : "insufficient";
  const evidence = toEvidence(status === "stale" ? eligible : fresh);
  return {
    ...base,
    status,
    reason: null,
    evidence,
    sampleSize: evidence.length,
    sellerCount: new Set(evidence.map((item) => item.sellerId)).size,
    range: null,
    observedAt: newest(evidence),
    asking: null,
  };
}

/**
 * The price a card or a table shows, with what kind of price it is.
 *
 * `lowestPrice ?? msrp` made a list price look like something a buyer could
 * pay today. A racket with no live offer shows its MSRP labelled as MSRP.
 */
export function displayPrice(racket: { lowestPrice: number | null; msrp: number }): {
  amount: number;
  kind: "offer" | "msrp";
} {
  return racket.lowestPrice === null
    ? { amount: racket.msrp, kind: "msrp" }
    : { amount: racket.lowestPrice, kind: "offer" };
}
