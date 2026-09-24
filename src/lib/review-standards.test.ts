import assert from "node:assert/strict";
import test from "node:test";
import {
  REVIEW_LIMITS,
  draftFromForm,
  reviewViolations,
  type ReviewDraft,
} from "./review-standards";

const good: ReviewDraft = {
  racketId: "r-1",
  skillLevel: "intermediate",
  format: "doubles",
  position: "rear",
  stringModel: "BG65 Ti",
  tensionLbs: 25,
  power: 4,
  speed: 3,
  control: 4,
  comfort: 3,
  body: "Solid clears from the rear court, a little slow on drives at the net in doubles.",
};

const with_ = (patch: Partial<ReviewDraft>): ReviewDraft => ({ ...good, ...patch });

test("a specific, contextual review passes", () => {
  assert.deepEqual(reviewViolations(good), []);
});

test("Vietnamese prose with diacritics passes", () => {
  assert.deepEqual(
    reviewViolations(
      with_({ body: "Vợt đầm tay, đập cầu uy lực nhưng phòng thủ trên lưới hơi chậm khi đánh đôi." }),
    ),
    [],
  );
});

test("length bounds are the published limits", () => {
  assert.deepEqual(reviewViolations(with_({ body: "Great racket, 5 stars." })), ["bodyLength"]);
  assert.deepEqual(
    reviewViolations(with_({ body: "a b ".repeat(REVIEW_LIMITS.bodyMax) })),
    ["bodyLength"],
  );
  assert.deepEqual(reviewViolations(with_({ stringModel: " " })), ["stringModel"]);
});

test("ratings are whole numbers from 1 to 5", () => {
  for (const bad of [0, 6, 3.5, Number.NaN]) {
    assert.deepEqual(reviewViolations(with_({ power: bad })), ["rating"], String(bad));
  }
});

test("tension stays inside the table's check constraint", () => {
  assert.deepEqual(reviewViolations(with_({ tensionLbs: 40 })), ["tension"]);
  assert.deepEqual(reviewViolations(with_({ tensionLbs: 14 })), ["tension"]);
});

test("links and contact details are refused", () => {
  const cases: Array<[string, string]> = [
    ["Buy it cheaper at https://example.com today, great deal honestly.", "links"],
    ["Buy it cheaper at shopvot.vn today, great deal honestly for everyone.", "links"],
    ["Call me on 0912 345 678 for a good price on this frame, fast shipping.", "contact"],
    ["Contact me by zalo for a good price on this frame, fast shipping anywhere.", "contact"],
    ["Email seller@example.test for a good price on this frame, fast shipping.", "contact"],
  ];
  for (const [body, rule] of cases) {
    assert.ok(reviewViolations(with_({ body })).includes(rule as never), body);
  }
});

test("spec numbers are not mistaken for a phone number", () => {
  assert.deepEqual(
    reviewViolations(
      with_({ body: "Strung at 24-26 lbs, 4U 83 g, balance 295 mm, 675 mm long; fine for doubles." }),
    ),
    [],
  );
});

test("repetition, shouting and abuse are refused", () => {
  assert.ok(
    reviewViolations(with_({ body: "Sooooooo good, the best racket I have ever used in my life." })).includes(
      "repetition",
    ),
  );
  assert.ok(
    reviewViolations(with_({ body: "THIS IS THE WORST RACKET I HAVE EVER PLAYED WITH IN MY LIFE" })).includes(
      "shouting",
    ),
  );
  assert.ok(
    reviewViolations(with_({ body: "This shit frame cracked after two weeks of normal doubles play." })).includes(
      "abuse",
    ),
  );
});

test("an abuse word inside a longer word is not abuse", () => {
  // Whole-word matching: "Scunthorpe" and "shitake" are not the words.
  assert.deepEqual(
    reviewViolations(with_({ body: "Played it in Scunthorpe all winter, feels like a solid all-round frame." })),
    [],
  );
});

test("draftFromForm turns a missing number into a failure, not a zero", () => {
  const form = new FormData();
  form.set("racketId", "r-1");
  const draft = draftFromForm(form);
  assert.ok(Number.isNaN(draft.power));
  assert.ok(reviewViolations(draft).includes("rating"));
  assert.ok(reviewViolations(draft).includes("context"));
});
