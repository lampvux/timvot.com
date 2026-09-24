import type {
  AxisScores,
  FrameShape,
  Racket,
  RacketVariant,
  Review,
  ReviewTier,
  ShaftFlex,
} from "./types";
import { BALANCE_MAX_MM, BALANCE_MIN_MM } from "./types";

/**
 * COURT SCORE
 *
 * Two honest halves, published in full on /methodology:
 *
 *   50%  Spec profile  — deterministic, from the catalogue record.
 *   50%  Player score  — from verified reviews on the same four axes,
 *                        weighted by verification tier.
 *
 * Nothing here reads a seller, an offer, a price or a promotion. That is the
 * point: the score is un-buyable, and this file is the proof.
 */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Stiffer shaft → higher index. */
const FLEX_INDEX: Record<ShaftFlex, number> = {
  "extra-stiff": 1,
  stiff: 0.7,
  medium: 0.4,
  flexible: 0.15,
};

/** How much the frame cuts air. Aero frames swing faster, hold less. */
const AERO_INDEX: Record<FrameShape, number> = {
  "aero-box": 1,
  isometric: 0.5,
  conventional: 0.2,
};

/** How forgiving the sweet spot is. Isometric is the wide one. */
const SHAPE_CONTROL: Record<FrameShape, number> = {
  isometric: 1,
  "aero-box": 0.5,
  conventional: 0.35,
};

/** Verification tier weights, from the reviews table in the brief. */
export const REVIEW_WEIGHT: Record<ReviewTier, number> = {
  purchase: 3,
  owner: 2,
  community: 1,
};

/** Reviews needed before a Player Score is shown at all. */
export const MIN_REVIEWS_FOR_PLAYER_SCORE = 5;

interface SpecInputs {
  balancePointMm: number;
  shaftFlex: ShaftFlex;
  shaftDiameterMm: number;
  frameShape: FrameShape;
  weightGrams: number;
}

/**
 * The four axes, 0–10. Every coefficient below is published; changing one is
 * a versioned change to the methodology page, not a silent tweak.
 */
export function specProfile(input: SpecInputs): AxisScores {
  const balance = clamp01(
    (input.balancePointMm - BALANCE_MIN_MM) / (BALANCE_MAX_MM - BALANCE_MIN_MM),
  );
  const flex = FLEX_INDEX[input.shaftFlex];
  const weight = clamp01((input.weightGrams - 75) / 19);
  const aero = AERO_INDEX[input.frameShape];
  const shape = SHAPE_CONTROL[input.frameShape];
  const diameter = clamp01((input.shaftDiameterMm - 6.4) / 0.8);

  /** Swingweight proxy: mass distribution matters more than raw mass. */
  const swing = 0.62 * balance + 0.38 * weight;

  /** How close the racket sits to the middle of the balance rule. */
  const evenness = 1 - Math.abs(balance - 0.5) * 2;

  return {
    power: round1(
      10 * clamp01(0.3 + 0.42 * balance + 0.22 * flex + 0.14 * weight),
    ),
    speed: round1(10 * clamp01(0.98 - 0.8 * swing + 0.1 * aero)),
    control: round1(
      10 * clamp01(0.2 + 0.26 * shape + 0.24 * flex + 0.2 * evenness),
    ),
    comfort: round1(
      10 * clamp01(1.05 - 0.48 * flex - 0.2 * diameter - 0.24 * weight),
    ),
  };
}

/** The variant a racket is judged on: its lightest/most common configuration. */
export function referenceVariant(racket: Racket): RacketVariant | undefined {
  return [...racket.variants].sort((a, b) => a.weightGrams - b.weightGrams)[0];
}

export function specProfileForRacket(racket: Racket): AxisScores {
  const variant = referenceVariant(racket);
  return specProfile({
    balancePointMm: racket.balancePointMm,
    shaftFlex: racket.shaftFlex,
    shaftDiameterMm: racket.shaftDiameterMm,
    frameShape: racket.frameShape,
    weightGrams: variant?.weightGrams ?? 83,
  });
}

/**
 * Axis weights for the composite.
 *
 * Not equal, and not a peak-take-all. A flat mean would rank a 72 g beginner
 * frame above a flagship, because lightness buys both speed and comfort for
 * free while power and control have to be earned. These are the weights the
 * market actually puts on the four axes, published so they can be argued
 * with — see /methodology.
 */
export const AXIS_WEIGHT: AxisScores = {
  power: 0.3,
  control: 0.28,
  speed: 0.25,
  comfort: 0.17,
};

/** Weighted composite of the four axes, still on the 0–10 axis scale. */
export function aggregate(axes: AxisScores): number {
  return (
    axes.power * AXIS_WEIGHT.power +
    axes.speed * AXIS_WEIGHT.speed +
    axes.control * AXIS_WEIGHT.control +
    axes.comfort * AXIS_WEIGHT.comfort
  );
}

/**
 * The four axes trade against each other — a head-heavy frame buys power with
 * speed — so a raw weighted composite lands every racket ever made between
 * about 5.4 and 8.0. Publishing that as "59 to 80 out of 100" wastes most of
 * the scale and makes two genuinely different rackets look identical.
 *
 * This stretches the real band onto a readable one. It is a linear map with
 * no free parameters hidden in it, and it is on /methodology.
 */
export function toScore(composite: number): number {
  return Math.min(100, Math.max(0, Math.round((composite - 5.4) * 22 + 58)));
}

/** The only fields of a review the score reads. */
export type ReviewRating = Pick<Review, "tier" | "power" | "speed" | "control" | "comfort">;

/** Per-tier count and raw axis sums — no weights, no averages. */
export interface TierTotals {
  count: number;
  power: number;
  speed: number;
  control: number;
  comfort: number;
}

/**
 * Reviews reduced to what the player half needs.
 *
 * Unweighted on purpose: a tally is a count and four sums per tier, which
 * Postgres can produce for a racket with ten thousand reviews without sending
 * them (`get_racket_detail_market` does exactly that). Every weight and every
 * threshold is applied below, in this file, so the methodology still has one
 * definition.
 */
export type ReviewTally = Record<ReviewTier, TierTotals>;

const emptyTotals = (): TierTotals => ({
  count: 0,
  power: 0,
  speed: 0,
  control: 0,
  comfort: 0,
});

export function emptyTally(): ReviewTally {
  return { purchase: emptyTotals(), owner: emptyTotals(), community: emptyTotals() };
}

export function tallyReviews(reviews: readonly ReviewRating[]): ReviewTally {
  const tally = emptyTally();
  for (const review of reviews) {
    const totals = tally[review.tier];
    totals.count += 1;
    totals.power += review.power;
    totals.speed += review.speed;
    totals.control += review.control;
    totals.comfort += review.comfort;
  }
  return tally;
}

export function tallyCount(tally: ReviewTally): number {
  return tally.purchase.count + tally.owner.count + tally.community.count;
}

/** Weighted average of review axes, mapped from the 1–5 form to 0–10. */
export function playerProfile(reviews: readonly ReviewRating[]): AxisScores | null {
  return playerProfileFromTally(tallyReviews(reviews));
}

export function playerProfileFromTally(tally: ReviewTally): AxisScores | null {
  if (tallyCount(tally) < MIN_REVIEWS_FOR_PLAYER_SCORE) return null;

  let totalWeight = 0;
  const sums = { power: 0, speed: 0, control: 0, comfort: 0 };

  for (const tier of Object.keys(REVIEW_WEIGHT) as ReviewTier[]) {
    const weight = REVIEW_WEIGHT[tier];
    const totals = tally[tier];
    totalWeight += totals.count * weight;
    sums.power += totals.power * weight;
    sums.speed += totals.speed * weight;
    sums.control += totals.control * weight;
    sums.comfort += totals.comfort * weight;
  }

  if (totalWeight === 0) return null;

  /** 1–5 → 0–10, so both halves share one scale. */
  const toTen = (v: number) => round1(((v / totalWeight - 1) / 4) * 10);

  return {
    power: toTen(sums.power),
    speed: toTen(sums.speed),
    control: toTen(sums.control),
    comfort: toTen(sums.comfort),
  };
}

export interface CourtScore {
  /**
   * null when the racket has too few verified reviews.
   *
   * A Court Score is 50% spec and 50% player by definition. Publishing the
   * spec half alone under the same name would be the product telling a small
   * lie about how much it knows — so it publishes nothing, and the page says
   * "spec profile only" instead.
   */
  total: number | null;
  spec: AxisScores;
  specScore: number;
  player: AxisScores | null;
  playerScore: number | null;
  reviewCount: number;
  specOnly: boolean;
}

export function courtScore(racket: Racket, reviews: readonly ReviewRating[]): CourtScore {
  return courtScoreFromTally(racket, tallyReviews(reviews));
}

export function courtScoreFromTally(racket: Racket, tally: ReviewTally): CourtScore {
  const spec = specProfileForRacket(racket);
  const player = playerProfileFromTally(tally);

  const specComposite = aggregate(spec);
  const playerComposite = player ? aggregate(player) : null;

  return {
    spec,
    specScore: toScore(specComposite),
    player,
    playerScore: playerComposite === null ? null : toScore(playerComposite),
    reviewCount: tallyCount(tally),
    specOnly: player === null,
    total:
      playerComposite === null
        ? null
        : toScore(specComposite * 0.5 + playerComposite * 0.5),
  };
}
