import type { CourtPosition, MatchFormat, SkillLevel } from "@/lib/types";

/**
 * The community standards a review has to meet before it is published.
 *
 * Two layers, on purpose. `submit_review` in
 * `supabase/migrations/20260924000000_community_reviews.sql` is the gate: it
 * enforces the limits below, the one-review-per-racket rule and the daily
 * rate limit, so a direct RPC call cannot skip them. This module repeats the
 * structural limits so the form can say *which* rule a draft broke without a
 * round trip, and adds the heuristics that are not worth restating in SQL —
 * contact details, repeated characters, shouting, abuse. The numbers must
 * agree; `guardrails/review-limits.test.ts` fails when they do not.
 *
 * Every rule here is mechanical and explained to the author on the page. A
 * rule that needs judgement belongs to staff, who can reject any review.
 */

export const REVIEW_LIMITS = {
  bodyMin: 40,
  bodyMax: 2000,
  stringMin: 2,
  stringMax: 60,
  tensionMin: 15,
  tensionMax: 35,
  perDay: 5,
  cooldownSeconds: 60,
} as const;

export type ReviewViolation =
  | "context"
  | "rating"
  | "stringModel"
  | "tension"
  | "bodyLength"
  | "links"
  | "contact"
  | "repetition"
  | "shouting"
  | "abuse";

export interface ReviewDraft {
  racketId: string;
  skillLevel: SkillLevel;
  format: MatchFormat;
  position: CourtPosition;
  stringModel: string;
  tensionLbs: number;
  power: number;
  speed: number;
  control: number;
  comfort: number;
  body: string;
}

const SKILLS = new Set<string>(["beginner", "intermediate", "advanced"]);
const FORMATS = new Set<string>(["singles", "doubles"]);
const POSITIONS = new Set<string>(["net", "mid", "rear"]);

export const RATING_AXES = ["power", "speed", "control", "comfort"] as const;

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|vn|net|org|shop|store|io|me|info|xyz|link|ly)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
/** Nine or more digits with the separators people write phone numbers with. */
const PHONE = /(?:\+?\d[\s.-]?){9,}/;
const MESSENGER = /\b(zalo|telegram|whatsapp|viber|inbox|ib)\b/i;
const REPEATED = /(.)\1{5,}/u;

/**
 * Words that are abuse in any sentence. Short on purpose: a long list starts
 * catching racket talk, and a false positive tells an honest reviewer they
 * were rude. Matched as whole words, diacritics intact.
 */
const ABUSE = [
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "cunt",
  "địt",
  "đụ",
  "đm",
  "đcm",
  "dcm",
  "vcl",
  "lồn",
  "cặc",
  "buồi",
];
const ABUSE_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(${ABUSE.join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

function isShouting(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return false;
  const upper = letters.filter(
    (ch) => ch !== ch.toLowerCase() && ch === ch.toUpperCase(),
  ).length;
  return upper / letters.length > 0.7;
}

function isRating(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Every rule a draft breaks, in the order the form lists them. */
export function reviewViolations(draft: ReviewDraft): ReviewViolation[] {
  const out: ReviewViolation[] = [];
  const body = draft.body.trim();
  const stringModel = draft.stringModel.trim();

  if (
    !draft.racketId ||
    !SKILLS.has(draft.skillLevel) ||
    !FORMATS.has(draft.format) ||
    !POSITIONS.has(draft.position)
  ) {
    out.push("context");
  }
  if (!RATING_AXES.every((axis) => isRating(draft[axis]))) out.push("rating");
  if (
    stringModel.length < REVIEW_LIMITS.stringMin ||
    stringModel.length > REVIEW_LIMITS.stringMax
  ) {
    out.push("stringModel");
  }
  if (
    !Number.isInteger(draft.tensionLbs) ||
    draft.tensionLbs < REVIEW_LIMITS.tensionMin ||
    draft.tensionLbs > REVIEW_LIMITS.tensionMax
  ) {
    out.push("tension");
  }
  if (body.length < REVIEW_LIMITS.bodyMin || body.length > REVIEW_LIMITS.bodyMax) {
    out.push("bodyLength");
  }

  const text = `${body}\n${stringModel}`;
  if (LINK.test(text)) out.push("links");
  if (EMAIL.test(text) || PHONE.test(text) || MESSENGER.test(text)) {
    out.push("contact");
  }
  if (REPEATED.test(body)) out.push("repetition");
  if (isShouting(body)) out.push("shouting");
  if (ABUSE_PATTERN.test(text)) out.push("abuse");

  return out;
}

/** Read a draft out of the form. Missing numbers become NaN and fail. */
export function draftFromForm(formData: FormData): ReviewDraft {
  const text = (key: string) => String(formData.get(key) ?? "");
  const number = (key: string) => {
    const raw = text(key).trim();
    return raw === "" ? Number.NaN : Number(raw);
  };
  return {
    racketId: text("racketId"),
    skillLevel: text("skillLevel") as SkillLevel,
    format: text("format") as MatchFormat,
    position: text("position") as CourtPosition,
    stringModel: text("stringModel"),
    tensionLbs: number("tensionLbs"),
    power: number("power"),
    speed: number("speed"),
    control: number("control"),
    comfort: number("comfort"),
    body: text("body"),
  };
}
