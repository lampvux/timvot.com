import { skillFits } from "@/lib/finder";
import type { ListingCondition } from "@/lib/price-context";
import type { AxisScores, BalanceType, ShaftFlex, SkillLevel } from "@/lib/types";
import { hasProfile, type CheckProfile } from "./input";

/**
 * Fit, tradeoffs and what to ask the seller — as explicit states with message
 * keys, never a single score. The UI words each state; this module decides
 * which state the evidence supports.
 */

export interface Sentence {
  key: string;
  values?: Record<string, string | number>;
}

export type FitStatus = "supported" | "needs_profile" | "uncertain";

export interface Fit {
  status: FitStatus;
  reasons: Sentence[];
  tradeoffs: Sentence[];
}

/** The spec facts fit is judged on — a subset of `RacketWithMarket`. */
export interface FitRacket {
  balancePointMm: number;
  balanceType: BalanceType;
  shaftFlex: ShaftFlex;
  skillLevel: SkillLevel;
  spec: AxisScores;
}

const STIFF: readonly ShaftFlex[] = ["stiff", "extra-stiff"];

/** What the frame gives up, from its specs alone. Always at least one. */
export function tradeoffsFor(racket: FitRacket): Sentence[] {
  const mm = racket.balancePointMm;
  const tradeoffs: Sentence[] = [
    racket.balanceType === "head-heavy"
      ? { key: "tradeHeadHeavy", values: { mm } }
      : racket.balanceType === "head-light"
        ? { key: "tradeHeadLight", values: { mm } }
        : { key: "tradeEven", values: { mm } },
  ];
  if (STIFF.includes(racket.shaftFlex)) tradeoffs.push({ key: "tradeStiff" });
  else if (racket.shaftFlex === "flexible") tradeoffs.push({ key: "tradeFlexible" });
  return tradeoffs;
}

export function fitFor(racket: FitRacket, profile: CheckProfile): Fit {
  const tradeoffs = tradeoffsFor(racket);
  if (!hasProfile(profile)) return { status: "needs_profile", reasons: [], tradeoffs };

  const mm = racket.balancePointMm;
  const reasons: Sentence[] = [];
  const concerns: Sentence[] = [];
  const { experience, format, position } = profile;

  if (experience) {
    if (!skillFits(racket.skillLevel, experience)) concerns.push({ key: "concernSkill" });
    else if (experience === "under1" && STIFF.includes(racket.shaftFlex))
      concerns.push({ key: "concernStiffBeginner" });
    else if (experience === "under1" && racket.skillLevel === "beginner")
      reasons.push({ key: "reasonBeginner", values: { mm } });
  }

  if (position === "rear") {
    if (racket.balanceType === "head-heavy") reasons.push({ key: "reasonRear", values: { mm } });
    else if (racket.balanceType === "head-light") concerns.push({ key: "concernRear", values: { mm } });
  } else if (position === "net") {
    if (racket.balanceType === "head-heavy") concerns.push({ key: "concernNet", values: { mm } });
    else reasons.push({ key: "reasonNet", values: { mm } });
  }

  if (format === "doubles" && racket.spec.speed >= 6)
    reasons.push({ key: "reasonDoubles", values: { speed: racket.spec.speed.toFixed(1) } });
  if (format === "singles" && racket.spec.power >= 7)
    reasons.push({ key: "reasonSingles", values: { power: racket.spec.power.toFixed(1) } });
  if (racket.spec.control >= 7)
    reasons.push({ key: "reasonControl", values: { control: racket.spec.control.toFixed(1) } });

  // A concern outranks any number of reasons: it is the thing to know first.
  if (concerns.length)
    return { status: "uncertain", reasons: concerns.slice(0, 2), tradeoffs };
  if (reasons.length === 0) return { status: "uncertain", reasons: [], tradeoffs };
  return { status: "supported", reasons: reasons.slice(0, 2), tradeoffs };
}

/**
 * Three questions for the seller, most useful first. Used or unknown
 * condition leads with photos and wear; an unconfirmed variant always asks
 * for it, because price and feel depend on it.
 */
export function questionsForSeller(condition: ListingCondition, variantKnown: boolean): Sentence[] {
  const questions: Sentence[] = [];
  if (!variantKnown) questions.push({ key: "askVariant" });

  if (condition === "new" || condition === "open-box") {
    questions.push({ key: "askAuthenticity" }, { key: "askWarranty" }, { key: "askStringing" });
  } else {
    questions.push({ key: "askPhotos" }, { key: "askDamage" }, { key: "askInspect" });
  }
  return questions.slice(0, 3);
}

/** What to look at before paying for a used racket. No certification: an
 *  uninspected racket is never called genuine. */
export const INSPECTION_CHECKLIST: readonly string[] = [
  "inspectFrame",
  "inspectGrommets",
  "inspectShaft",
  "inspectGrip",
  "inspectRepairs",
  "inspectInPerson",
];

export function needsInspection(condition: ListingCondition): boolean {
  return condition === "used" || condition === "unknown";
}
