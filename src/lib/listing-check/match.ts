/**
 * Turning what a buyer typed into catalogue candidates they can confirm.
 *
 * Search is token-based and bounded; the decision is the buyer's. A similar
 * slug is never an exact-match claim: "Astrox 77" matches Astrox 77 Pro,
 * Play and Tour, and stays ambiguous until one is chosen — Play/Tour/Pro,
 * generations and 3U/4U are different rackets with different prices.
 */

export const MAX_CANDIDATES = 8;
export const MIN_QUERY_CHARS = 2;
export const MAX_QUERY_CHARS = 60;
const MAX_TOKENS = 5;

export type ModelMatch = "exact" | "ambiguous" | "missing";

export interface RacketCandidate {
  id: string;
  brandSlug: string;
  brandName: string;
  slug: string;
  name: string;
  releaseYear: number;
  thumbUrl: string | null;
  variants: { id: string; weightClass: string; gripSize: string; colourway: string | null }[];
}

/** Lowercase, strip diacritics and separators, split letters from digits so
 *  "astrox77", "Astrox-77" and "ASTROX 77" all search the same. */
export function normalizeQuery(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .trim()
    .replace(/\s+/g, " ");
}

/** The tokens a query searches on, or null when it is too short or too long
 *  to be a model name — the API answers 400 rather than scanning. */
export function searchTokens(text: string): string[] | null {
  if (text.length > MAX_QUERY_CHARS) return null;
  const normalized = normalizeQuery(text);
  if (normalized.replace(/\s/g, "").length < MIN_QUERY_CHARS) return null;
  return normalized.split(" ").slice(0, MAX_TOKENS);
}

/** True when every token appears in the brand-and-model text. */
export function matchesTokens(tokens: readonly string[], brandName: string, name: string): boolean {
  const haystack = ` ${normalizeQuery(`${brandName} ${name}`)} `;
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Exact only when one candidate's full name is what was typed, with or
 * without the brand, and nothing else shares that prefix. Everything else
 * with a candidate is ambiguous and waits for the buyer.
 */
export function modelMatch(query: string, candidates: readonly RacketCandidate[]): ModelMatch {
  if (candidates.length === 0) return "missing";
  const typed = normalizeQuery(query);
  const exact = candidates.filter(
    (c) => normalizeQuery(c.name) === typed || normalizeQuery(`${c.brandName} ${c.name}`) === typed,
  );
  return exact.length === 1 && candidates.length === 1 ? "exact" : "ambiguous";
}
