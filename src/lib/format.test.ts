import assert from "node:assert/strict";
import test from "node:test";
import {
  BALANCE_MESSAGE_KEY,
  CONDITION_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  PLAY_STYLE_MESSAGE_KEY,
  balancePercent,
  formatReviewDate,
  formatTension,
  formatTensionRange,
  formatTensionValue,
  median,
  tensionUnit,
  variantCode,
} from "./format";
import { BALANCE_MAX_MM, BALANCE_MIN_MM } from "./types";
import type { BalanceType, Condition, PlayStyle, ShaftFlex } from "./types";
import en from "../../messages/en.json" with { type: "json" };

/**
 * Display decisions, made here and nowhere else.
 *
 * The money and stock rules are asserted in the design guardrails, where they
 * belong — they are house style. What is left is the part that is genuinely
 * arithmetic: the pound/kilogram conversion, the balance rule's geometry, and
 * the enum-to-message-key tables that decide whether a spec renders as a word
 * or as a missing translation.
 */

/* ---------------------------------------------------------------- tension */

test("tension is stored in pounds and shown in the reader's unit", () => {
  // Manufacturers publish pounds; Vietnamese stringers work in kilograms. The
  // unit is a display decision, never a second stored value.
  assert.equal(tensionUnit("en"), "lbs");
  assert.equal(tensionUnit("vi"), "kg");
  assert.equal(tensionUnit("fr"), "lbs", "an unknown locale should not become kg.");
});

test("a pound value converts to kilograms at one decimal", () => {
  // A stringing machine's dial reads to 0,1 kg. Rounding 24 lbs to a whole
  // 11 kg would move the recommendation by most of a pound.
  assert.equal(formatTensionValue(24, "en"), "24 lbs");

  // 24 lb = 10,8862 kg, which reads as 10,9 — not 10,8, and not a whole 11.
  // The decimal separator is the locale's, so the assertion allows either.
  const vi = formatTensionValue(24, "vi");
  assert.match(vi, /^10[.,]9 kg$/);
});

test("a range carries one unit at the end, not two", () => {
  assert.equal(formatTensionRange([20, 22], "en"), "20 – 22 lbs");

  const vi = formatTensionRange([20, 22], "vi");
  assert.equal(
    (vi.match(/kg/g) ?? []).length,
    1,
    `"${vi}" repeats the unit; the design puts it once, at the end.`,
  );
});

test("a range whose ends are equal is written as one value", () => {
  assert.equal(formatTensionRange([24, 24], "en"), formatTensionValue(24, "en"));
  assert.equal(formatTensionRange([24, 24], "vi"), formatTensionValue(24, "vi"));
});

test("formatTension writes the stored pounds unchanged", () => {
  // The un-localised form, used where the unit is already in the label.
  assert.equal(formatTension([20, 24]), "20 – 24 lbs");
});

test("the range separator is an en dash, not a hyphen", () => {
  assert.ok(formatTension([20, 24]).includes("–"));
  assert.ok(!formatTension([20, 24]).includes(" - "));
});

/* ---------------------------------------------------------------- balance */

test("balancePercent places the rule's endpoints at 0 and 100", () => {
  assert.equal(balancePercent(BALANCE_MIN_MM), 0);
  assert.equal(balancePercent(BALANCE_MAX_MM), 100);
  assert.equal(balancePercent((BALANCE_MIN_MM + BALANCE_MAX_MM) / 2), 50);
});

test("a racket outside the rule is clamped onto it, not drawn off the end", () => {
  assert.equal(balancePercent(200), 0);
  assert.equal(balancePercent(400), 100);
});

test("balancePercent is monotonic across the rule", () => {
  let previous = -1;
  for (let mm = BALANCE_MIN_MM; mm <= BALANCE_MAX_MM; mm += 0.5) {
    const percent = balancePercent(mm);
    assert.ok(percent >= previous, `${mm} mm went backwards.`);
    previous = percent;
  }
});

/* ------------------------------------------------------------- spec codes */

test("a variant code is the manufacturer's own spelling", () => {
  assert.equal(variantCode("4U", "G5"), "4U G5");
  assert.equal(variantCode("2U", "G4"), "2U G4");
});

/* ------------------------------------------------------------------ dates */

test("a recent review date is relative, an old one is absolute", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");

  const recent = formatReviewDate("2026-09-17T00:00:00.000Z", "en", now);
  assert.ok(/day|yesterday/i.test(recent), recent);

  const old = formatReviewDate("2026-01-05T00:00:00.000Z", "en", now);
  assert.ok(/2026/.test(old), old);
  assert.ok(!/day/i.test(old), `${old} is still relative after eight months.`);
});

test("the relative/absolute boundary is thirty days", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");

  const at29 = formatReviewDate("2026-08-21T00:00:00.000Z", "en", now);
  const at31 = formatReviewDate("2026-08-19T00:00:00.000Z", "en", now);

  assert.ok(/ago|day/i.test(at29), at29);
  assert.ok(/2026/.test(at31), at31);
});

test("a review date renders in both locales without throwing", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");
  for (const locale of ["en", "vi"]) {
    for (const iso of ["2026-09-18T00:00:00.000Z", "2025-02-02T00:00:00.000Z"]) {
      const rendered = formatReviewDate(iso, locale, now);
      assert.ok(rendered.length > 0, `${locale} / ${iso}`);
    }
  }
});

/* ----------------------------------------------------------------- median */

test("the median of an even-length series is the mean of the middle two", () => {
  assert.equal(median([10, 20, 30, 40]), 25);
});

test("the median of an odd-length series is the middle value", () => {
  assert.equal(median([30, 10, 20]), 20);
});

test("median does not reorder its input", () => {
  // It is called on price series the caller then plots in observation order.
  const series = [30, 10, 20];
  median(series);
  assert.deepEqual(series, [30, 10, 20]);
});

test("the median of nothing is zero, not NaN", () => {
  assert.equal(median([]), 0);
});

/* -------------------------------------------------- the enum lookup tables */

/**
 * Every spec enum has to reach a message key, and every key has to exist.
 *
 * A missing entry here renders as the raw enum — `extra-stiff` in the middle
 * of a Vietnamese sentence — and a key that no longer exists in the message
 * file renders as the key itself. Both are only visible on the one page that
 * shows that one value.
 */
const ENUM_TABLES: Array<[string, Record<string, string>, readonly string[]]> = [
  [
    "shaft flex",
    FLEX_MESSAGE_KEY,
    ["extra-stiff", "stiff", "medium", "flexible"] satisfies ShaftFlex[],
  ],
  [
    "balance type",
    BALANCE_MESSAGE_KEY,
    ["head-light", "even", "head-heavy"] satisfies BalanceType[],
  ],
  [
    "play style",
    PLAY_STYLE_MESSAGE_KEY,
    ["attack", "all-round", "speed", "defence", "control"] satisfies PlayStyle[],
  ],
  [
    "condition",
    CONDITION_MESSAGE_KEY,
    [
      "new",
      "open-box",
      "used-excellent",
      "used-good",
      "used-fair",
    ] satisfies Condition[],
  ],
];

test("every spec enum value maps to a message key", () => {
  for (const [name, table, values] of ENUM_TABLES) {
    for (const value of values) {
      assert.ok(
        table[value],
        `the ${name} "${value}" has no message key, so it renders as the raw ` +
          `enum wherever it appears.`,
      );
    }
    assert.equal(
      Object.keys(table).length,
      values.length,
      `the ${name} table has an entry for a value that is not in the union.`,
    );
  }
});

test("every message key the tables name actually exists", () => {
  // The message file is typed as its own literal shape, and its namespaces are
  // not uniform, so it is read here as plain data.
  const enums =
    ((en as unknown as Record<string, unknown>).enums as Record<string, string>) ?? {};

  for (const [name, table] of ENUM_TABLES) {
    for (const key of Object.values(table)) {
      assert.ok(
        key in enums,
        `the ${name} table points at messages.enums.${key}, which does not ` +
          `exist — the page would render the key instead of the word.`,
      );
    }
  }
});
