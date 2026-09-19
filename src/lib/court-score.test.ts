import assert from "node:assert/strict";
import test from "node:test";
import {
  AXIS_WEIGHT,
  MIN_REVIEWS_FOR_PLAYER_SCORE,
  REVIEW_WEIGHT,
  aggregate,
  courtScore,
  playerProfile,
  referenceVariant,
  specProfile,
  specProfileForRacket,
  toScore,
} from "./court-score";
import { BALANCE_MAX_MM, BALANCE_MIN_MM } from "./types";
import type { Racket, Review } from "./types";
import { rackets, reviews } from "./data/seed";

/**
 * The Court Score is the product claim, so it is the thing most worth testing.
 *
 * Two halves, published in full on /methodology: 50% a deterministic spec
 * profile, 50% a player score from verified reviews weighted 3x/2x/1x by
 * verification tier. Under five verified reviews the total is withheld rather
 * than half-published.
 *
 * `src/lib/guardrails/court-score-purity.test.ts` asserts the other half of
 * the claim — that this file reads no seller, offer, price or promotion. What
 * is checked here is that the arithmetic does what the page says it does.
 */

/* -------------------------------------------------------------- fixtures */

/** The seeded catalogue is the fixture. A second one would drift from it. */
const anyRacket = rackets[0];

const reviewsFor = (racketId: string): Review[] =>
  reviews.filter((review) => review.racketId === racketId);

/** A review with every axis at one value, so a weighting is visible in the
 *  output rather than buried in four different numbers. */
function flatReview(
  tier: Review["tier"],
  value: number,
  id = `${tier}-${value}`,
): Review {
  return {
    id,
    racketId: "r-test",
    authorName: "",
    tier,
    skillLevel: "intermediate",
    format: "singles",
    position: "rear",
    stringModel: "",
    tensionLbs: 24,
    power: value,
    speed: value,
    control: value,
    comfort: value,
    body: { en: "", vi: "" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const flatReviews = (tier: Review["tier"], value: number, count: number) =>
  Array.from({ length: count }, (_, i) => flatReview(tier, value, `${tier}-${i}`));

/* -------------------------------------------------- the withholding rule */

test("under five verified reviews there is no Court Score at all", () => {
  for (let count = 0; count < MIN_REVIEWS_FOR_PLAYER_SCORE; count++) {
    const score = courtScore(anyRacket, flatReviews("purchase", 4, count));

    assert.equal(
      score.total,
      null,
      `${count} reviews produced a total. A Court Score is 50% spec and 50% ` +
        `player by definition; there is no player half here.`,
    );
    assert.equal(score.player, null);
    assert.equal(score.playerScore, null);
    assert.equal(score.specOnly, true);
    assert.equal(score.reviewCount, count);
  }
});

test("the fifth review is what turns the score on", () => {
  const four = courtScore(anyRacket, flatReviews("purchase", 4, 4));
  const five = courtScore(anyRacket, flatReviews("purchase", 4, 5));

  assert.equal(four.total, null);
  assert.equal(four.specOnly, true);

  assert.notEqual(five.total, null);
  assert.equal(five.specOnly, false);
  assert.equal(MIN_REVIEWS_FOR_PLAYER_SCORE, 5);
});

test("the spec half is never substituted for the whole score", () => {
  // The exact failure this guards: someone "fixing" the empty state by
  // falling back to specScore, which publishes half a number under the name
  // of a whole one.
  const score = courtScore(anyRacket, flatReviews("owner", 5, 2));

  assert.equal(score.total, null);
  assert.ok(
    score.specScore > 0,
    "the spec half is still computed and available — it is just not the total.",
  );
});

test("the spec half is always available, reviews or not", () => {
  const withNone = courtScore(anyRacket, []);
  const withMany = courtScore(anyRacket, flatReviews("purchase", 3, 20));

  assert.equal(
    withNone.specScore,
    withMany.specScore,
    "the spec half moved when reviews arrived. It is deterministic from the " +
      "catalogue record and must not depend on them.",
  );
});

/* ----------------------------------------------------------- the weighting */

test("verification tiers weigh 3x, 2x and 1x", () => {
  assert.deepEqual(REVIEW_WEIGHT, { purchase: 3, owner: 2, community: 1 });
});

test("a purchase-verified review counts for three community ones", () => {
  // One purchase review at 5 against three community reviews at 1: weights are
  // 3 and 3, so the weighted mean is exactly halfway.
  const mixed = [
    flatReview("purchase", 5, "p"),
    ...Array.from({ length: 3 }, (_, i) => flatReview("community", 1, `c${i}`)),
    // Two more to clear the threshold, balanced so they do not move the mean.
    flatReview("community", 3, "c3"),
    flatReview("community", 3, "c4"),
  ];

  const profile = playerProfile(mixed);
  assert.ok(profile);

  // (5x3 + 1x1 + 1x1 + 1x1 + 3x1 + 3x1) / (3+1+1+1+1+1) = 24/8 = 3 on the 1–5
  // scale, which is the midpoint, which is 5.0 on the published 0–10 scale.
  assert.equal(profile.power, 5);
  assert.equal(profile.speed, 5);
  assert.equal(profile.control, 5);
  assert.equal(profile.comfort, 5);
});

test("the 1–5 review form maps onto the same 0–10 scale as the specs", () => {
  const floor = playerProfile(flatReviews("owner", 1, 5));
  const ceiling = playerProfile(flatReviews("owner", 5, 5));
  const middle = playerProfile(flatReviews("owner", 3, 5));

  assert.deepEqual(floor, { power: 0, speed: 0, control: 0, comfort: 0 });
  assert.deepEqual(ceiling, { power: 10, speed: 10, control: 10, comfort: 10 });
  assert.deepEqual(middle, { power: 5, speed: 5, control: 5, comfort: 5 });
});

test("the tier of a review changes the answer", () => {
  // Same ratings, different tiers: if the weighting were ignored these would
  // be equal, which is the regression worth catching.
  const weighted = playerProfile([
    flatReview("purchase", 5, "a"),
    ...flatReviews("community", 1, 4),
  ]);
  const unweighted = playerProfile([
    flatReview("community", 5, "a"),
    ...flatReviews("community", 1, 4),
  ]);

  assert.ok(weighted && unweighted);
  assert.ok(
    weighted.power > unweighted.power,
    "a purchase-verified 5 did not outweigh a community-verified 5.",
  );
});

/* ------------------------------------------------------------- the halves */

test("both halves are weighted equally in the total", () => {
  // Checked against the composites rather than against the published scores:
  // toScore clamps at 0 and 100, so two extreme player halves do not average
  // back to the spec-only score even when the weighting is exactly even.
  const ratings = [1, 2, 3, 4, 5];

  for (const rating of ratings) {
    const score = courtScore(anyRacket, flatReviews("owner", rating, 5));
    assert.ok(score.player, `rating ${rating} produced no player half.`);

    const specComposite = aggregate(score.spec);
    const playerComposite = aggregate(score.player);

    assert.equal(
      score.total,
      toScore(specComposite * 0.5 + playerComposite * 0.5),
      `at rating ${rating} the total is not the even mean of the two halves.`,
    );
  }
});

test("moving the player half moves the total, in the same direction", () => {
  // The arithmetic above would also pass if both halves were multiplied by
  // zero. This is the part that says the player half is actually consulted.
  const low = courtScore(anyRacket, flatReviews("owner", 2, 5));
  const high = courtScore(anyRacket, flatReviews("owner", 5, 5));

  assert.ok(low.total !== null && high.total !== null);
  assert.ok(
    high.total > low.total,
    `better reviews did not raise the score: ${low.total} → ${high.total}.`,
  );
});

test("axis weights are the published ones and sum to one", () => {
  assert.deepEqual(AXIS_WEIGHT, {
    power: 0.3,
    control: 0.28,
    speed: 0.25,
    comfort: 0.17,
  });

  const total =
    AXIS_WEIGHT.power + AXIS_WEIGHT.speed + AXIS_WEIGHT.control + AXIS_WEIGHT.comfort;

  assert.ok(
    Math.abs(total - 1) < 1e-9,
    `axis weights sum to ${total}, not 1. The composite would no longer be ` +
      `on the 0–10 axis scale that toScore() is calibrated against.`,
  );
});

test("the axes are not equal, and power leads", () => {
  // Published reasoning: a flat mean ranks a 72 g beginner frame above a
  // flagship, because lightness buys speed and comfort for free.
  assert.ok(AXIS_WEIGHT.power > AXIS_WEIGHT.comfort);
  assert.ok(AXIS_WEIGHT.control > AXIS_WEIGHT.comfort);
  assert.ok(AXIS_WEIGHT.speed > AXIS_WEIGHT.comfort);
});

/* --------------------------------------------------------- the spec profile */

const BASE = {
  balancePointMm: 292,
  shaftFlex: "medium",
  shaftDiameterMm: 6.8,
  frameShape: "isometric",
  weightGrams: 84,
} as const;

test("every axis stays on the 0–10 scale at both extremes", () => {
  const extremes = [
    { ...BASE, balancePointMm: BALANCE_MIN_MM, weightGrams: 75, shaftFlex: "flexible" },
    { ...BASE, balancePointMm: BALANCE_MAX_MM, weightGrams: 94, shaftFlex: "extra-stiff" },
    { ...BASE, balancePointMm: 200, weightGrams: 40, shaftDiameterMm: 4 },
    { ...BASE, balancePointMm: 400, weightGrams: 140, shaftDiameterMm: 9 },
  ] as const;

  for (const input of extremes) {
    const axes = specProfile(input);
    for (const [axis, value] of Object.entries(axes)) {
      assert.ok(
        value >= 0 && value <= 10,
        `${axis} came out at ${value} for ${JSON.stringify(input)}.`,
      );
    }
  }
});

test("a head-heavy frame buys power with speed", () => {
  const light = specProfile({ ...BASE, balancePointMm: 282 });
  const heavy = specProfile({ ...BASE, balancePointMm: 303 });

  assert.ok(heavy.power > light.power, "head-heavy did not raise power.");
  assert.ok(heavy.speed < light.speed, "head-heavy did not cost speed.");
});

test("a stiffer shaft raises power and control and costs comfort", () => {
  const soft = specProfile({ ...BASE, shaftFlex: "flexible" });
  const stiff = specProfile({ ...BASE, shaftFlex: "extra-stiff" });

  assert.ok(stiff.power > soft.power);
  assert.ok(stiff.control > soft.control);
  assert.ok(stiff.comfort < soft.comfort, "a stiff shaft was not less comfortable.");
});

test("the same specs always produce the same number", () => {
  // "Deterministic, computed from the catalogue record" is the published
  // wording. Nothing in here may consult a clock, a random source or an order.
  const once = specProfile(BASE);
  for (let i = 0; i < 25; i++) assert.deepEqual(specProfile(BASE), once);
});

test("scores are published to one decimal", () => {
  const axes = specProfile({ ...BASE, balancePointMm: 288.3, shaftDiameterMm: 6.73 });
  for (const value of Object.values(axes)) {
    assert.equal(
      Math.round(value * 10) / 10,
      value,
      `${value} carries more precision than the design publishes.`,
    );
  }
});

test("a racket is judged on its lightest variant", () => {
  const racket = rackets.find((r) => r.variants.length > 1);
  assert.ok(racket, "no seeded racket has more than one variant.");

  const reference = referenceVariant(racket);
  const lightest = Math.min(...racket.variants.map((v) => v.weightGrams));

  assert.equal(
    reference?.weightGrams,
    lightest,
    "the reference variant is not the lightest configuration.",
  );
});

test("referenceVariant does not reorder the racket's own variants", () => {
  const racket = rackets.find((r) => r.variants.length > 1)!;
  const before = racket.variants.map((v) => v.id);
  referenceVariant(racket);
  assert.deepEqual(
    racket.variants.map((v) => v.id),
    before,
    "referenceVariant sorted the array in place, which reorders the variant " +
      "picker on the detail page as a side effect of scoring.",
  );
});

test("a racket with no variants is still scorable", () => {
  const orphan: Racket = { ...anyRacket, variants: [] };
  const axes = specProfileForRacket(orphan);

  for (const value of Object.values(axes)) {
    assert.ok(Number.isFinite(value), "an empty variant list produced NaN.");
  }
});

/* -------------------------------------------------------------- the mapping */

test("toScore stretches the real band onto a readable one", () => {
  // A raw weighted composite lands every racket ever made between about 5.4
  // and 8.0. Publishing that as "59 to 80" wastes most of the scale, so the
  // band is mapped linearly: 5.4 becomes 58, and each further point of
  // composite is worth 22.
  assert.equal(toScore(5.4), 58);
  assert.equal(toScore(6.4), 80);
  assert.equal(toScore(7.0), 93);

  // The map runs past 100 before the top of the observed band, and clamps
  // there. That is deliberate — the alternative is a scale nothing reaches.
  assert.equal(toScore(8.0), 100);
  assert.equal(toScore(5.4 - 58 / 22), 0);
});

test("toScore is clamped to 0–100 and never returns a fraction", () => {
  for (const composite of [-100, 0, 5, 7, 12, 1000]) {
    const score = toScore(composite);
    assert.ok(score >= 0 && score <= 100, `${composite} mapped to ${score}.`);
    assert.equal(score, Math.round(score));
  }
});

test("toScore is monotonic", () => {
  // A racket that scores better on every axis has to score better overall,
  // or the number means nothing.
  let previous = -1;
  for (let composite = 5.4; composite <= 8; composite += 0.05) {
    const score = toScore(composite);
    assert.ok(score >= previous, `toScore fell from ${previous} to ${score}.`);
    previous = score;
  }
});

/* ------------------------------------------------- against the real catalogue */

test("every seeded racket scores without throwing", () => {
  for (const racket of rackets) {
    const score = courtScore(racket, reviewsFor(racket.id));

    assert.ok(score.specScore >= 0 && score.specScore <= 100, racket.slug);
    if (score.total !== null) {
      assert.ok(score.total >= 0 && score.total <= 100, racket.slug);
      assert.equal(score.specOnly, false);
    } else {
      assert.equal(score.specOnly, true);
      assert.ok(score.reviewCount < MIN_REVIEWS_FOR_PLAYER_SCORE);
    }
  }
});

test("reviewCount reports what it was given, not what it used", () => {
  const score = courtScore(anyRacket, flatReviews("community", 2, 9));
  assert.equal(score.reviewCount, 9);
});

test("playerProfile refuses an empty list rather than dividing by zero", () => {
  assert.equal(playerProfile([]), null);
});
