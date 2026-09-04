import type { BalanceType, Condition, ShaftFlex } from "./types";
import {
  BALANCE_MAX_MM,
  BALANCE_MIN_MM,
  EVEN_BAND_MAX_MM,
  EVEN_BAND_MIN_MM,
} from "./types";

/**
 * House style for money, from the design system:
 *   - symbol leads: ₫3.290.000
 *   - thousands separated by full stops (VN convention), never commas
 *   - never abbreviated. Approximation is what the product is fixing.
 */
export function formatDong(amount: number): string {
  const rounded = Math.round(Math.abs(amount));
  const grouped = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "−" : ""}₫${grouped}`;
}

/** Deltas always carry a sign. Minus is U+2212, not a hyphen. */
export function formatDelta(amount: number): string {
  if (amount === 0) return "₫0";
  const sign = amount < 0 ? "−" : "+";
  const grouped = Math.round(Math.abs(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}₫${grouped}`;
}

/** Spec codes are written exactly as the manufacturer writes them. */
export function variantCode(weightClass: string, gripSize: string): string {
  return `${weightClass} ${gripSize}`;
}

export function formatTension([min, max]: [number, number]): string {
  return `${min} – ${max} lbs`;
}

/**
 * Tension is stored in pounds everywhere (`maxTensionLbs`, `tensionLbs`)
 * because that is the unit manufacturers publish. Vietnamese stringers work
 * in kilograms, so the unit shown is a display decision made here and nowhere
 * else — never a second stored value.
 */
const KG_PER_LB = 0.45359237;

export function tensionUnit(locale: string): "kg" | "lbs" {
  return locale === "vi" ? "kg" : "lbs";
}

/** The number alone, so a range can carry one unit at the end. */
function tensionAmount(lbs: number, locale: string): string {
  if (tensionUnit(locale) === "lbs") return `${lbs}`;
  // One decimal: a stringing machine's dial reads to 0.1 kg, and rounding
  // 20 lbs to a whole 9 kg would move the recommendation by over a pound.
  return (Math.round(lbs * KG_PER_LB * 10) / 10).toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** A single tension with its unit — "24 lbs" in en, "10,9 kg" in vi. */
export function formatTensionValue(lbs: number, locale: string): string {
  return `${tensionAmount(lbs, locale)} ${tensionUnit(locale)}`;
}

/** A tension range with one unit — "20 – 22 lbs" in en, "9,1 – 10,0 kg" in vi. */
export function formatTensionRange(
  [min, max]: [number, number],
  locale: string,
): string {
  if (min === max) return formatTensionValue(min, locale);
  return `${tensionAmount(min, locale)} – ${tensionAmount(max, locale)} ${tensionUnit(locale)}`;
}

export function balanceTypeOf(mm: number): BalanceType {
  if (mm < EVEN_BAND_MIN_MM) return "head-light";
  if (mm > EVEN_BAND_MAX_MM) return "head-heavy";
  return "even";
}

/** Position on the fixed 280–305 mm rule, as a 0–100 percentage. */
export function balancePercent(mm: number): number {
  const clamped = Math.min(Math.max(mm, BALANCE_MIN_MM), BALANCE_MAX_MM);
  return ((clamped - BALANCE_MIN_MM) / (BALANCE_MAX_MM - BALANCE_MIN_MM)) * 100;
}

/**
 * Stock language rules: exact count up to 10, then "10+". Below 4, switch to
 * "3 left" in amber. Never invent scarcity.
 */
export type StockTone = "normal" | "low" | "out";

export function stockTone(qty: number): StockTone {
  if (qty <= 0) return "out";
  if (qty < 4) return "low";
  return "normal";
}

/** Dates are relative under 30 days, absolute after. */
export function formatReviewDate(
  iso: string,
  locale: string,
  now = new Date(),
): string {
  const then = new Date(iso);
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 30) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return rtf.format(-days, "day");
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(then);
}

export const FLEX_MESSAGE_KEY: Record<ShaftFlex, string> = {
  "extra-stiff": "flexExtraStiff",
  stiff: "flexStiff",
  medium: "flexMedium",
  flexible: "flexFlexible",
};

export const BALANCE_MESSAGE_KEY: Record<BalanceType, string> = {
  "head-light": "balanceHeadLight",
  even: "balanceEven",
  "head-heavy": "balanceHeadHeavy",
};

export const CONDITION_MESSAGE_KEY: Record<Condition, string> = {
  new: "conditionNew",
  "open-box": "conditionOpenBox",
  "used-excellent": "conditionUsedExcellent",
  "used-good": "conditionUsedGood",
  "used-fair": "conditionUsedFair",
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}
