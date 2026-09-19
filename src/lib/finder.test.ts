import assert from "node:assert/strict";
import test from "node:test";
import {
  BUDGET_RANGE,
  FINDER_KEYS,
  parseAnswers,
  runFinder,
  weightsFor,
  type FinderAnswers,
} from "./finder";
import { courtScore, specProfileForRacket } from "./court-score";
import { balanceTypeOf } from "./format";
import type { RacketWithMarket } from "./types";
import { rackets, reviews } from "./data/seed";

/**
 * The Finder's output is never a bare list.
 *
 * Five questions, four of them weights on the spec profile and one — injury —
 * a hard filter, because a stiff shaft on a bad elbow is not a trade-off to be
 * scored. Every result carries the reason it matched, and the reasons are
 * assigned across the shortlist rather than per racket, because five results
 * carrying the same sentence is a bare list with extra words.
 *
 * That last property is the one worth testing hardest: it is the product, and
 * it is the one a refactor would quietly lose.
 */

/* -------------------------------------------------------------- fixtures */

/**
 * The seeded catalogue, enriched the way the repository enriches it.
 *
 * Built from the same `courtScore` and `balanceTypeOf` the app uses, so a
 * coefficient change shows up here rather than being modelled around.
 */
const catalogue: RacketWithMarket[] = rackets.map((racket) => {
  const racketReviews = reviews.filter((review) => review.racketId === racket.id);
  const score = courtScore(racket, racketReviews);

  return {
    ...racket,
    balanceType: balanceTypeOf(racket.balancePointMm),
    spec: specProfileForRacket(racket),
    player: score.player,
    reviewCount: racketReviews.length,
    courtScore: score.total,
    specScore: score.specScore,
    lowestPrice: null,
    sellerCount: 3,
    history: [],
  };
});

const ANSWERS: FinderAnswers = {
  experience: "1to3",
  format: "doubles",
  position: "net",
  injury: "none",
  budget: "o35",
};

const answering = (overrides: Partial<FinderAnswers>): FinderAnswers => ({
  ...ANSWERS,
  ...overrides,
});

/** Every combination of the five questions. 3 x 3 x 3 x 3 x 4 = 324. */
function everyAnswer(): FinderAnswers[] {
  const out: FinderAnswers[] = [];
  for (const experience of ["under1", "1to3", "over3"] as const)
    for (const format of ["singles", "doubles", "both"] as const)
      for (const position of ["net", "mid", "rear"] as const)
        for (const injury of ["none", "sometimes", "ongoing"] as const)
          for (const budget of ["u15", "15to25", "25to35", "o35"] as const)
            out.push({ experience, format, position, injury, budget });
  return out;
}

/* ---------------------------------------------------------- the questions */

test("there are five questions and no more", () => {
  assert.equal(FINDER_KEYS.length, 5);
  assert.deepEqual([...FINDER_KEYS], [
    "experience",
    "format",
    "position",
    "injury",
    "budget",
  ]);
});

test("the budget bands tile the whole range with no gap and no overlap", () => {
  const bands = [
    BUDGET_RANGE.u15,
    BUDGET_RANGE["15to25"],
    BUDGET_RANGE["25to35"],
    BUDGET_RANGE.o35,
  ];

  assert.equal(bands[0][0], 0, "the cheapest band does not start at zero.");

  for (let i = 1; i < bands.length; i++) {
    assert.equal(
      bands[i][0],
      bands[i - 1][1],
      `band ${i} starts at ${bands[i][0]} but the one before ends at ` +
        `${bands[i - 1][1]}, so a racket priced between them matches neither.`,
    );
  }

  assert.ok(
    bands[bands.length - 1][1] >= Number.MAX_SAFE_INTEGER,
    "the top band has a ceiling, so the most expensive rackets match nothing.",
  );
});

test("every question moves at least one weight", () => {
  const base = weightsFor(ANSWERS);

  const variants: Array<[string, FinderAnswers]> = [
    ["format", answering({ format: "singles" })],
    ["position", answering({ position: "rear" })],
    ["experience", answering({ experience: "under1" })],
    ["injury", answering({ injury: "ongoing" })],
  ];

  for (const [name, answers] of variants) {
    assert.notDeepEqual(
      weightsFor(answers),
      base,
      `changing ${name} changed no weight, so the question is decorative.`,
    );
  }
});

test("weights are never zero or negative", () => {
  // A zero weight silently removes an axis from the ranking.
  for (const answers of everyAnswer()) {
    const weights = weightsFor(answers);
    for (const [axis, value] of Object.entries(weights)) {
      assert.ok(
        value > 0,
        `${axis} weighs ${value} for ${JSON.stringify(answers)}.`,
      );
    }
  }
});

test("an injury is worth more comfort than inexperience is", () => {
  const ongoing = weightsFor(answering({ injury: "ongoing", experience: "over3" }));
  const beginner = weightsFor(answering({ injury: "none", experience: "under1" }));

  assert.ok(ongoing.comfort > beginner.comfort);
});

test("the net rewards speed and the rear rewards power", () => {
  const net = weightsFor(answering({ position: "net" }));
  const rear = weightsFor(answering({ position: "rear" }));

  assert.ok(net.speed > rear.speed);
  assert.ok(rear.power > net.power);
});

/* ------------------------------------------------------- the hard filters */

test("an ongoing injury excludes every stiff shaft, whatever it scores", () => {
  // Not a trade-off to be scored: a racket to exclude.
  for (const budget of ["u15", "15to25", "25to35", "o35"] as const) {
    const results = runFinder(catalogue, answering({ injury: "ongoing", budget }), 50);

    for (const { racket } of results) {
      assert.ok(
        racket.shaftFlex === "flexible" || racket.shaftFlex === "medium",
        `${racket.slug} has an ${racket.shaftFlex} shaft and was recommended ` +
          `to someone with an ongoing injury.`,
      );
    }
  }
});

test("an occasional injury excludes only the extra-stiff", () => {
  const results = runFinder(catalogue, answering({ injury: "sometimes" }), 50);

  for (const { racket } of results) {
    assert.notEqual(racket.shaftFlex, "extra-stiff", racket.slug);
  }
});

test("a beginner is never sold an advanced frame", () => {
  const results = runFinder(
    catalogue,
    answering({ experience: "under1", injury: "none" }),
    50,
  );

  for (const { racket } of results) {
    assert.notEqual(
      racket.skillLevel,
      "advanced",
      `${racket.slug} is an advanced frame and was recommended to someone ` +
        `with under a year of play.`,
    );
  }
});

test("every result is inside the budget that was asked for", () => {
  for (const budget of ["u15", "15to25", "25to35", "o35"] as const) {
    const [min, max] = BUDGET_RANGE[budget];
    const results = runFinder(catalogue, answering({ budget }), 50);

    for (const { racket } of results) {
      const price = racket.lowestPrice ?? racket.msrp;
      assert.ok(
        price >= min && price <= max,
        `${racket.slug} at ${price} was returned for the ${budget} band ` +
          `(${min}–${max}).`,
      );
    }
  }
});

test("the lowest live price is what the budget is judged against, not the MSRP", () => {
  const discounted = catalogue.map((racket) => ({
    ...racket,
    msrp: 9_000_000,
    lowestPrice: 1_000_000,
  }));

  const results = runFinder(discounted, answering({ budget: "u15" }), 50);

  assert.ok(
    results.length > 0,
    "a racket discounted into the cheapest band was judged on its list price.",
  );
});

/* ------------------------------------------------------------ the output */

test("no answer combination throws or returns an unhandled shape", () => {
  for (const answers of everyAnswer()) {
    const results = runFinder(catalogue, answers);

    assert.ok(Array.isArray(results), JSON.stringify(answers));
    assert.ok(results.length <= 5, "the default shortlist grew past five.");

    for (const entry of results) {
      assert.ok(entry.racket, "a result with no racket.");
      assert.ok(Number.isFinite(entry.score), `score ${entry.score}.`);
      assert.ok(entry.reason?.key, "a result with no reason.");
      assert.ok(
        entry.reason.values && typeof entry.reason.values === "object",
        "a reason with no values to interpolate.",
      );
    }
  }
});

test("results are ordered best first", () => {
  for (const answers of everyAnswer().slice(0, 40)) {
    const scores = runFinder(catalogue, answers).map((entry) => entry.score);
    const sorted = [...scores].sort((a, b) => b - a);
    assert.deepEqual(scores, sorted, JSON.stringify(answers));
  }
});

test("every result carries a distinct reason where one is available", () => {
  // The explanation is the product. Five results carrying the same sentence
  // is a bare list with extra words.
  for (const answers of everyAnswer()) {
    const results = runFinder(catalogue, answers);
    if (results.length < 2) continue;

    const keys = results.map((entry) => entry.reason.key);
    const distinct = new Set(keys);

    assert.ok(
      distinct.size > 1 || results.length === 1,
      `every one of ${results.length} results for ${JSON.stringify(answers)} ` +
        `gave the same reason (${keys[0]}).`,
    );
  }
});

test("a reason interpolates this racket's own numbers", () => {
  const results = runFinder(catalogue, answering({ position: "rear" }), 5);

  for (const { racket, reason } of results) {
    const values = Object.values(reason.values);
    assert.ok(values.length > 0, `${reason.key} carries nothing to say.`);

    if ("mm" in reason.values) {
      assert.equal(
        reason.values.mm,
        racket.balancePointMm,
        `${racket.slug}'s reason quotes a balance point that is not its own.`,
      );
    }
  }
});

test("the shortlist honours the limit it is given", () => {
  for (const limit of [1, 3, 8]) {
    const results = runFinder(catalogue, answering({ budget: "o35" }), limit);
    assert.ok(results.length <= limit);
  }
});

test("an empty catalogue produces an empty shortlist, not a crash", () => {
  // `runFinder` takes a Math.min over the shortlist's prices, and Math.min of
  // nothing is Infinity — the kind of value that renders as "₫Infinity".
  const results = runFinder([], ANSWERS);
  assert.deepEqual(results, []);
});

test("a shortlist of one still gets a reason", () => {
  const results = runFinder([catalogue[0]], ANSWERS, 1);
  if (results.length === 0) return; // filtered out by budget; nothing to assert.
  assert.ok(results[0].reason.key);
});

/* ------------------------------------------------------------ the parsing */

test("a complete, valid answer set parses", () => {
  assert.deepEqual(
    parseAnswers({
      experience: "over3",
      format: "singles",
      position: "rear",
      injury: "none",
      budget: "25to35",
    }),
    {
      experience: "over3",
      format: "singles",
      position: "rear",
      injury: "none",
      budget: "25to35",
    },
  );
});

test("an incomplete or invalid answer set is refused outright", () => {
  const valid = {
    experience: "over3",
    format: "singles",
    position: "rear",
    injury: "none",
    budget: "25to35",
  };

  assert.equal(parseAnswers({}), null);

  for (const key of FINDER_KEYS) {
    assert.equal(
      parseAnswers({ ...valid, [key]: undefined }),
      null,
      `a missing ${key} was accepted.`,
    );
    assert.equal(
      parseAnswers({ ...valid, [key]: "nonsense" }),
      null,
      `an invalid ${key} was accepted.`,
    );
  }
});

test("a repeated query parameter takes its first value", () => {
  // `?injury=none&injury=ongoing` arrives as an array. Taking the last would
  // let a crafted link flip a hard filter.
  const answers = parseAnswers({
    experience: ["over3", "under1"],
    format: "singles",
    position: "rear",
    injury: ["none", "ongoing"],
    budget: "25to35",
  });

  assert.equal(answers?.experience, "over3");
  assert.equal(answers?.injury, "none");
});
