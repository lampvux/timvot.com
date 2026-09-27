import type { Experience, Format, Position } from "@/lib/finder";
import { LISTING_CONDITIONS, type ListingCondition } from "@/lib/price-context";

/**
 * The listing check's URL, read strictly.
 *
 * The URL is the whole state of a check — it survives a back button, a
 * refresh and an edit — so it carries only what the buyer typed about the
 * racket and, optionally, three answers about how they play. Never a Facebook
 * URL, a photo, post text, a seller's identity or a health answer: unknown
 * keys are dropped, every value is bounded, and `shareQuery` narrows further
 * to what a buyer chooses to send someone else.
 */

export const CHECK_KEYS = ["model", "variant", "price", "condition", "q", "exp", "fmt", "pos"] as const;

/** A buyer's profile is optional and partial. Shoulder and elbow answers are
 *  deliberately not part of it. */
export interface CheckProfile {
  experience: Experience | null;
  format: Format | null;
  position: Position | null;
}

export interface CheckInput {
  /** `brandSlug/racketSlug`, the canonical model the buyer confirmed. */
  model: { brandSlug: string; slug: string } | null;
  variantId: string | null;
  priceVnd: number | null;
  condition: ListingCondition;
  /** What the buyer typed when no catalogue model fits. Never shared. */
  query: string;
  profile: CheckProfile;
}

export const MAX_QUERY_LENGTH = 60;
export const MIN_PRICE_VND = 50_000;
export const MAX_PRICE_VND = 50_000_000;

const SLUG = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const VARIANT_ID = /^[A-Za-z0-9_-]{1,80}$/;

const EXPERIENCES: readonly Experience[] = ["under1", "1to3", "over3"];
const FORMATS: readonly Format[] = ["singles", "doubles", "both"];
const POSITIONS: readonly Position[] = ["net", "mid", "rear"];

type Params = Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string {
  const value = params[key];
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * A Vietnamese asking price as buyers write it: `2.500.000`, `2,5tr`, `2tr5`,
 * `2500k`, `₫2.500.000đ`. Returns whole dong inside the accepted range, or
 * null for anything malformed, negative or implausible.
 */
export function parsePriceVnd(text: string): number | null {
  const raw = text
    .toLowerCase()
    .replace(/[₫đ\s]|vn[dđ]|dong/g, "")
    .trim();
  if (!raw || raw.length > 16) return null;

  let amount: number;
  const million = raw.match(/^(\d{1,3})(?:[.,](\d{1,3}))?(?:tr|triệu|m)(\d{1,3})?$/);
  const thousand = raw.match(/^(\d{1,6})(?:[.,](\d{1,3}))?k$/);

  if (million) {
    // "2tr5" and "2,5tr" are both 2.500.000; the tail is a fraction of a million.
    const tail = million[2] ?? million[3] ?? "";
    amount = Number(million[1]) * 1_000_000 + (tail ? Number(`0.${tail}`) * 1_000_000 : 0);
  } else if (thousand) {
    const tail = thousand[2] ?? "";
    amount = Number(thousand[1]) * 1_000 + (tail ? Number(`0.${tail}`) * 1_000 : 0);
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(raw) || /^\d+$/.test(raw)) {
    amount = Number(raw.replace(/[.,]/g, ""));
  } else {
    return null;
  }

  amount = Math.round(amount);
  return Number.isSafeInteger(amount) && amount >= MIN_PRICE_VND && amount <= MAX_PRICE_VND
    ? amount
    : null;
}

export function parseCheckInput(params: Params): CheckInput {
  const [brandSlug, slug, ...rest] = first(params, "model").toLowerCase().split("/");
  const model =
    rest.length === 0 && SLUG.test(brandSlug ?? "") && SLUG.test(slug ?? "")
      ? { brandSlug, slug }
      : null;

  const variant = first(params, "variant");

  return {
    model,
    variantId: model && VARIANT_ID.test(variant) ? variant : null,
    priceVnd: parsePriceVnd(first(params, "price")),
    condition: oneOf(first(params, "condition"), LISTING_CONDITIONS) ?? "unknown",
    query: model ? "" : first(params, "q").replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH),
    profile: {
      experience: oneOf(first(params, "exp"), EXPERIENCES),
      format: oneOf(first(params, "fmt"), FORMATS),
      position: oneOf(first(params, "pos"), POSITIONS),
    },
  };
}

export function hasProfile(profile: CheckProfile): boolean {
  return Boolean(profile.experience || profile.format || profile.position);
}

/** The full URL state of a check, for editing it or linking to its result. */
export function checkQuery(input: CheckInput): Record<string, string> {
  const query: Record<string, string> = {};
  if (input.model) query.model = `${input.model.brandSlug}/${input.model.slug}`;
  else if (input.query) query.q = input.query;
  if (input.variantId) query.variant = input.variantId;
  if (input.priceVnd !== null) query.price = String(input.priceVnd);
  if (input.condition !== "unknown") query.condition = input.condition;
  if (input.profile.experience) query.exp = input.profile.experience;
  if (input.profile.format) query.fmt = input.profile.format;
  if (input.profile.position) query.pos = input.profile.position;
  return query;
}

/**
 * What a share link may carry: the model, variant, asking price and condition.
 * Not the profile, and not the free text a buyer typed.
 */
export function shareQuery(input: CheckInput): Record<string, string> {
  const { exp: _e, fmt: _f, pos: _p, q: _q, ...shared } = checkQuery(input);
  return shared;
}
