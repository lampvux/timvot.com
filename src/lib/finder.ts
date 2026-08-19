import type { RacketWithMarket, SkillLevel } from "./types";

/**
 * The Racket Finder.
 *
 * Five questions, no more. Each maps to a weight on the spec profile, except
 * question four, which is a hard filter — a stiff shaft on a bad elbow is not
 * a trade-off to be scored, it is a racket to exclude.
 *
 * The output is never a bare list. Every result carries the reason it
 * matched, because the explanation is the product.
 */

export type Experience = "under1" | "1to3" | "over3";
export type Format = "singles" | "doubles" | "both";
export type Position = "net" | "mid" | "rear";
export type Injury = "none" | "sometimes" | "ongoing";
export type Budget = "u15" | "15to25" | "25to35" | "o35";

export interface FinderAnswers {
  experience: Experience;
  format: Format;
  position: Position;
  injury: Injury;
  budget: Budget;
}

export const FINDER_KEYS = ["experience", "format", "position", "injury", "budget"] as const;

export const BUDGET_RANGE: Record<Budget, [number, number]> = {
  u15: [0, 1_500_000],
  "15to25": [1_500_000, 2_500_000],
  "25to35": [2_500_000, 3_500_000],
  o35: [3_500_000, Number.MAX_SAFE_INTEGER],
};

const SKILL_FOR: Record<Experience, SkillLevel> = {
  under1: "beginner",
  "1to3": "intermediate",
  over3: "advanced",
};

const SKILL_RANK: Record<SkillLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

export interface AxisWeights {
  power: number;
  speed: number;
  control: number;
  comfort: number;
}

export function weightsFor(answers: FinderAnswers): AxisWeights {
  const weights: AxisWeights = { power: 1, speed: 1, control: 1, comfort: 1 };

  // Singles rewards power and control; doubles rewards speed at the net.
  if (answers.format === "singles") {
    weights.power += 0.6;
    weights.control += 0.4;
  } else if (answers.format === "doubles") {
    weights.speed += 0.8;
    weights.control += 0.2;
  } else {
    weights.speed += 0.3;
    weights.control += 0.3;
  }

  // Where you stand decides the balance you want.
  if (answers.position === "rear") weights.power += 0.8;
  if (answers.position === "net") weights.speed += 0.8;
  if (answers.position === "mid") weights.control += 0.5;

  // A softer shaft is worth more the less time you have played.
  if (answers.experience === "under1") {
    weights.comfort += 0.9;
    weights.control += 0.4;
  }
  if (answers.experience === "1to3") weights.comfort += 0.3;

  if (answers.injury === "sometimes") weights.comfort += 0.9;
  if (answers.injury === "ongoing") weights.comfort += 1.6;

  return weights;
}

export interface FinderMatch {
  racket: RacketWithMarket;
  score: number;
  /** The single strongest reason, ready to be translated at the call site. */
  reason: { key: string; values: Record<string, string | number> };
}

export function runFinder(
  rackets: RacketWithMarket[],
  answers: FinderAnswers,
  limit = 5,
): FinderMatch[] {
  const [budgetMin, budgetMax] = BUDGET_RANGE[answers.budget];
  const weights = weightsFor(answers);
  const skill = SKILL_FOR[answers.experience];

  const eligible = rackets.filter((racket) => {
    // Hard filter: shoulder or elbow trouble excludes stiff shafts outright.
    if (answers.injury === "ongoing" && racket.shaftFlex !== "flexible" && racket.shaftFlex !== "medium")
      return false;
    if (answers.injury === "sometimes" && racket.shaftFlex === "extra-stiff")
      return false;

    // Hard filter: a beginner is not sold an advanced frame.
    if (SKILL_RANK[racket.skillLevel] > SKILL_RANK[skill] + 1) return false;

    const price = racket.lowestPrice ?? racket.msrp;
    return price >= budgetMin && price <= budgetMax;
  });

  const total = weights.power + weights.speed + weights.control + weights.comfort;

  const ranked = eligible
    .map((racket) => {
      const weighted =
        (racket.spec.power * weights.power +
          racket.spec.speed * weights.speed +
          racket.spec.control * weights.control +
          racket.spec.comfort * weights.comfort) /
        total;

      // A racket built for the level asked about earns a small nudge.
      const skillBonus = racket.skillLevel === skill ? 0.4 : 0;

      return {
        racket,
        score: Math.round((weighted + skillBonus) * 10) / 10,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const cheapest = Math.min(
    ...ranked.map((entry) => entry.racket.lowestPrice ?? entry.racket.msrp),
  );

  // Reasons are assigned across the shortlist, not per racket in isolation.
  // Five results carrying the same sentence is a bare list with extra words.
  const used = new Set<string>();

  return ranked.map(({ racket, score }) => {
    const candidates = candidateReasons(racket, answers, cheapest).sort(
      (a, b) => b.weight - a.weight,
    );
    const fresh = candidates.find((candidate) => !used.has(candidate.key));
    const chosen = fresh ?? candidates[0];
    used.add(chosen.key);
    return { racket, score, reason: { key: chosen.key, values: chosen.values } };
  });
}

interface ReasonCandidate {
  key: string;
  values: Record<string, string | number>;
  weight: number;
}

/** One line, specific, using this racket's actual numbers. */
function candidateReasons(
  racket: RacketWithMarket,
  answers: FinderAnswers,
  cheapest: number,
): ReasonCandidate[] {
  const candidates: ReasonCandidate[] = [
    {
      key: "reasonBalanced",
      values: {
        mm: racket.balancePointMm,
        score: racket.courtScore ?? racket.specScore,
      },
      weight: 0.1,
    },
  ];

  if (answers.injury !== "none" && racket.shaftFlex === "flexible")
    candidates.push({
      key: "reasonComfort",
      values: { mm: racket.balancePointMm },
      weight: 3.2,
    });

  if (answers.injury !== "none" && racket.spec.comfort >= 6.5)
    candidates.push({
      key: "reasonComfortScore",
      values: { comfort: racket.spec.comfort.toFixed(1) },
      weight: 2.6,
    });

  if (answers.position === "rear" && racket.balanceType === "head-heavy")
    candidates.push({
      key: "reasonRear",
      values: { mm: racket.balancePointMm },
      weight: 3,
    });

  if (answers.position === "net" && racket.balanceType !== "head-heavy")
    candidates.push({
      key: "reasonNet",
      values: { mm: racket.balancePointMm },
      weight: 2.2,
    });

  if (answers.format === "doubles" && racket.spec.speed >= 6)
    candidates.push({
      key: "reasonDoubles",
      values: { speed: racket.spec.speed.toFixed(1) },
      weight: 1.4 + racket.spec.speed / 10,
    });

  if (answers.format === "singles" && racket.spec.power >= 7)
    candidates.push({
      key: "reasonSingles",
      values: { power: racket.spec.power.toFixed(1) },
      weight: 1.4 + racket.spec.power / 10,
    });

  if (answers.experience === "under1" && racket.skillLevel === "beginner")
    candidates.push({
      key: "reasonBeginner",
      values: { mm: racket.balancePointMm },
      weight: 2.5,
    });

  if (racket.spec.control >= 7)
    candidates.push({
      key: "reasonControl",
      values: { control: racket.spec.control.toFixed(1) },
      weight: 1.2 + racket.spec.control / 10,
    });

  if ((racket.lowestPrice ?? racket.msrp) === cheapest)
    candidates.push({
      key: "reasonCheapest",
      values: { sellers: racket.sellerCount },
      weight: 1.8,
    });

  if (racket.sellerCount >= 4)
    candidates.push({
      key: "reasonStocked",
      values: { sellers: racket.sellerCount },
      weight: 1.1,
    });

  return candidates;
}

export function parseAnswers(
  params: Record<string, string | string[] | undefined>,
): FinderAnswers | null {
  const read = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };

  const answers = {
    experience: read("experience") as Experience,
    format: read("format") as Format,
    position: read("position") as Position,
    injury: read("injury") as Injury,
    budget: read("budget") as Budget,
  };

  const valid =
    ["under1", "1to3", "over3"].includes(answers.experience) &&
    ["singles", "doubles", "both"].includes(answers.format) &&
    ["net", "mid", "rear"].includes(answers.position) &&
    ["none", "sometimes", "ongoing"].includes(answers.injury) &&
    ["u15", "15to25", "25to35", "o35"].includes(answers.budget);

  return valid ? answers : null;
}
