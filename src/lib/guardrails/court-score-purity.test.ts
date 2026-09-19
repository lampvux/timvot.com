import assert from "node:assert/strict";
import test from "node:test";
import {
  importedModules,
  namedImportsFrom,
  read,
  readRoot,
  stripCommentsAndStrings,
} from "./source";

/**
 * The Court Score is un-buyable, and this is the proof.
 *
 * "Nothing here reads a seller, an offer, a price or a promotion" is the
 * product claim, published on /methodology and printed at the bottom of that
 * page as a path to this very file. A claim a customer can check is a claim
 * that has to be true after every refactor, not only on the day it was
 * written — so it is asserted here rather than trusted to a doc comment.
 *
 * The second half of the file guards the other direction: the methodology page
 * has to keep showing the *real* coefficients. It does that today by importing
 * the constants rather than restating them, which is the right design; what
 * this protects is that nobody replaces the import with a typed-out number.
 */

const COURT_SCORE = ["lib", "court-score.ts"] as const;
const METHODOLOGY = ["app", "[locale]", "methodology", "page.tsx"] as const;

/* ----------------------------------------------------------- no commerce in */

/**
 * Words that only appear in this file if it has started reading the market.
 *
 * `msrp` is on the list even though it lives on `Racket`: it is a price, the
 * distributor's, and a score that moved when a list price moved would be
 * exactly the thing the page promises it is not.
 */
const COMMERCIAL_TERMS = [
  "offer",
  "Offer",
  "price",
  "Price",
  "seller",
  "Seller",
  "promoted",
  "promotion",
  "msrp",
  "msrpVnd",
  "lowestPrice",
  "sellerCount",
  "qtyAvailable",
  "discount",
  "currency",
];

test("court-score.ts reads no commercial data", () => {
  const code = stripCommentsAndStrings(read(...COURT_SCORE));

  const found = COMMERCIAL_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`).test(code),
  );

  assert.deepEqual(
    found,
    [],
    `src/lib/court-score.ts references ${found.join(", ")}. The published ` +
      `claim on /methodology is that nothing in this file reads a seller, an ` +
      `offer, a price or a promotion. Either the claim is false or the ` +
      `reference is a mistake — both are worth stopping for.`,
  );
});

test("court-score.ts imports nothing that could carry a price", () => {
  const modules = importedModules(read(...COURT_SCORE));

  const allowed = new Set(["./types"]);
  const unexpected = modules.filter((m) => !allowed.has(m));

  assert.deepEqual(
    unexpected,
    [],
    `src/lib/court-score.ts imports ${unexpected.join(", ")}. It is allowed ` +
      `exactly one import — the schema — so that "reads no commercial data" ` +
      `is checkable by reading one file rather than a dependency tree.`,
  );
});

test("the type it imports carries no market data either", () => {
  // `Racket` is the catalogue record. `RacketWithMarket` is the one with
  // lowestPrice and sellerCount on it, and importing that here would let a
  // price reach the score through the back door.
  const named = namedImportsFrom(read(...COURT_SCORE), "./types") ?? [];

  assert.ok(
    !named.includes("RacketWithMarket"),
    `court-score.ts imports RacketWithMarket, which carries lowestPrice and ` +
      `sellerCount. Take Racket and the reviews, nothing else.`,
  );
  assert.ok(
    !named.includes("Offer") && !named.includes("OfferWithSeller"),
    "court-score.ts imports an offer type.",
  );
});

/* -------------------------------------------------- the published half holds */

test("the score is withheld rather than half-published", () => {
  const code = read(...COURT_SCORE);

  // `total` is null when there is no player half. The failure this guards is
  // someone "improving" the empty state by falling back to specScore, which
  // would publish the spec half under the name of the whole score.
  assert.ok(
    /total:\s*\n?\s*playerComposite === null\s*\n?\s*\?\s*null/.test(code),
    `courtScore().total no longer returns null when the player half is ` +
      `missing. A Court Score is 50% spec and 50% player by definition; ` +
      `publishing the spec half under that name is the product telling a lie ` +
      `about how much it knows.`,
  );
});

test("both halves are weighted equally", () => {
  const code = read(...COURT_SCORE);

  assert.ok(
    /specComposite \* 0\.5 \+ playerComposite \* 0\.5/.test(code),
    `the 50/50 split is no longer written as 0.5 and 0.5 in courtScore(). ` +
      `/methodology publishes "Spec profile — 50%" and "Player score — 50%"; ` +
      `change both or neither.`,
  );
});

/* ------------------------------------------- the methodology page stays true */

test("the methodology page imports the coefficients rather than restating them", () => {
  const page = read(...METHODOLOGY);
  const named = namedImportsFrom(page, "@/lib/court-score") ?? [];

  for (const constant of [
    "AXIS_WEIGHT",
    "REVIEW_WEIGHT",
    "MIN_REVIEWS_FOR_PLAYER_SCORE",
  ]) {
    assert.ok(
      named.includes(constant),
      `/methodology no longer imports ${constant} from court-score.ts. The ` +
        `page exists so the weights can be interrogated; a typed-out copy ` +
        `silently becomes a different number from the one actually used.`,
    );
  }
});

test("the methodology page renders each imported coefficient", () => {
  const page = read(...METHODOLOGY);

  for (const usage of [
    "AXIS_WEIGHT.power",
    "AXIS_WEIGHT.control",
    "AXIS_WEIGHT.speed",
    "AXIS_WEIGHT.comfort",
    "REVIEW_WEIGHT.purchase",
    "REVIEW_WEIGHT.owner",
    "REVIEW_WEIGHT.community",
    "MIN_REVIEWS_FOR_PLAYER_SCORE",
  ]) {
    assert.ok(
      page.includes(usage),
      `/methodology imports but never renders ${usage}, so a change to it ` +
        `would not reach the published page.`,
    );
  }
});

/**
 * Every message that states the review threshold, and the argument it must
 * interpolate rather than spell out.
 *
 * The failure is silent in a way that matters: `t(key, { count })` against a
 * message that has typed the number instead ignores the argument entirely, so
 * the page keeps publishing the old threshold and nothing anywhere errors.
 * That is how /methodology came to promise five reviews from a constant it was
 * no longer reading, and the racket detail page said the same thing twice.
 */
const THRESHOLD_MESSAGES: Array<[string, string]> = [
  ["methodology.minReviews", "count"],
  ["racket.specOnlyNote", "needed"],
];

test("the review threshold is a placeholder in both locales, not a typed-out number", () => {
  for (const locale of ["en", "vi"]) {
    const messages = JSON.parse(readRoot("messages", `${locale}.json`));

    for (const [path, placeholder] of THRESHOLD_MESSAGES) {
      const copy: string = path
        .split(".")
        .reduce((node: Record<string, unknown>, key) => node[key] as never, messages) as unknown as string;

      assert.equal(
        typeof copy,
        "string",
        `messages/${locale}.json has no ${path}; update THRESHOLD_MESSAGES.`,
      );

      assert.ok(
        copy.includes(`{${placeholder}}`),
        `messages/${locale}.json ${path} hardcodes the review threshold ` +
          `instead of using {${placeholder}}. The call site already passes ` +
          `MIN_REVIEWS_FOR_PLAYER_SCORE; the message has to read it.`,
      );

      assert.ok(
        !/\b\d+\s+(verified|đánh giá)/.test(copy),
        `messages/${locale}.json ${path} still spells a number next to the ` +
          `review noun: "${copy}"`,
      );
    }
  }
});

test("every page that states the threshold reads it from the constant", () => {
  // The other half: a message with a placeholder and a call site that never
  // passes it renders the placeholder's name to a visitor.
  const detail = read("app", "[locale]", "rackets", "[brand]", "[model]", "page.tsx");

  const named = namedImportsFrom(detail, "@/lib/court-score") ?? [];
  assert.ok(
    named.includes("MIN_REVIEWS_FOR_PLAYER_SCORE"),
    "the racket detail page states the review threshold but no longer imports it.",
  );

  for (const [, placeholder] of THRESHOLD_MESSAGES) {
    if (placeholder === "count") continue;
    const usages = detail.match(new RegExp(`${placeholder}:\\s*MIN_REVIEWS_FOR_PLAYER_SCORE`, "g")) ?? [];
    assert.ok(
      usages.length >= 2,
      `the detail page renders specOnlyNote in two places; ${usages.length} ` +
        `of them pass the threshold. The other would render "{${placeholder}}" ` +
        `to a visitor.`,
    );
  }
});

test("the page still points a reader at the source file", () => {
  const page = read(...METHODOLOGY);
  assert.ok(
    page.includes("src/lib/court-score.ts"),
    `/methodology stopped naming src/lib/court-score.ts. That line is what ` +
      `makes the claim checkable; if the file moved, update the page.`,
  );
});
