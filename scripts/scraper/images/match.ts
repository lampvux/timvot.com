/**
 * Deciding whether a manufacturer's product URL is the racket we hold.
 *
 * This is the part of the crawl that can quietly ruin the catalogue, so it is
 * deliberately conservative. A manufacturer's site is not a product catalogue
 * with a clean namespace — yonex.com serves product pages, series landing pages
 * and eight years of press releases from the same root path, so the candidate
 * list for "astrox 99" reads:
 *
 *     astrox-99-series                                    ← a landing page
 *     astrox-99-pure-power                                ← a 2018 press release
 *     astrox-99-pro-ax99-p                                ← the product
 *     astrox-88-s-astrox-88-d-and-astrox-99-out-with-…    ← a press release
 *
 * A similarity score puts all four within a few points of each other, and the
 * cost of getting it wrong is another racket's photographs filed permanently
 * under this racket's id. So there is no similarity score. The rule is set
 * equality on the name tokens, with two narrow allowances on the candidate side
 * only:
 *
 *   * a *code-like* extra token — `ax99`, `p`, `3ax99-t` — because Magento and
 *     Victor both append the SKU to the URL key;
 *   * a token from a short list of site furniture — `sports`, `gear`, the brand
 *     name itself — because some templates bake the page title into the slug.
 *
 * An extra token on the *model* side is never forgivable, and neither is an
 * ordinary English word on the candidate side. `pure`, `power`, `series` and
 * `unveiled` all fail, which is exactly what rejects all three wrong answers
 * above while accepting `astrox-99-pro-ax99-p`.
 */

import { slugify } from "../normalizer";

import type { GalleryImage } from "./gallery";

export type MatchTier = "exact" | "coded";

export interface MatchCandidate {
  url: string;
  /** The slug the match was made against, for the report. */
  slug: string;
  /**
   * The product's own name, when discovery came from a shop API rather than a
   * sitemap. It is a better thing to match on than the URL slug: a shop's
   * permalink is a one-off editorial choice ("krefy-exclusive-japan") while the
   * title is the name the manufacturer prints on the frame.
   */
  title?: string;
  /**
   * The gallery, when discovery already carried it. Shop APIs return the image
   * list alongside the product, so a provider using one never opens a product
   * page at all.
   */
  images?: GalleryImage[];
}

export interface MatchResult {
  /** The canonical page: shortest slug of the winning group. */
  candidate: MatchCandidate;
  tier: MatchTier;
  /**
   * Further pages for the *same* racket — Victor publishes one page per
   * colourway (`auraspeed-3200-a`, `-b`, `-c`, `-h`, `-l`, `-r`, `-s`), each
   * with its own photography of the same frame. They are crawled together and
   * their galleries merged, which is the difference between storing one colour
   * of a racket and storing the racket.
   */
  siblings: MatchCandidate[];
  /**
   * Candidates that matched equally well but are a *different* product. Their
   * presence means the match is unsafe, and the caller refuses it.
   */
  rivals: MatchCandidate[];
}

/**
 * The identity of a product, ignoring a colourway suffix.
 *
 * A single trailing token of one or two characters is a colour or edition code
 * on both providers' URL schemes. Anything longer is part of the model — which
 * is what keeps `ars-70f-a` and `ars-80x-c` apart (they differ at `70f`/`80x`,
 * not only in the suffix) while collapsing `auraspeed-3200-a` and `-h`.
 */
function productKey(slug: string): string {
  const tokens = tokenise(slug);
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && last && last.length <= 2) tokens.pop();
  return tokens.join("-");
}

/** Template furniture that appears in slugs and means nothing about identity. */
const FURNITURE = new Set([
  "sports",
  "gear",
  "sport",
  "badminton",
  "racquet",
  "racquets",
  "racket",
  "rackets",
  "official",
  "site",
  "product",
  "products",
  "en",
  "us",
  "shop",
  "buy",
]);

/**
 * A token is code-like when it is a SKU fragment rather than a word: one or two
 * characters, or a run mixing letters and digits with no vowel pattern of a
 * real word. `ax99`, `p`, `tk`, `3ax99` pass; `pro`, `tour`, `power` do not.
 */
function isCodeLike(token: string): boolean {
  if (token.length <= 2) return true;
  const hasLetter = /[a-z]/.test(token);
  const hasDigit = /\d/.test(token);
  return hasLetter && hasDigit;
}

export function tokenise(text: string): string[] {
  const raw = slugify(text).split("-").filter(Boolean);

  // Collapse runs of single letters back into the initialism they came from.
  // Proace writes the same frame as "S.D.S 350" on its own site and "SDS 350"
  // in the retailer listings, and slugify turns the first into `s-d-s`, so
  // without this the two never compare equal. A lone letter is left alone —
  // the `d` in "Astrox 88 D Pro" is a model designation, not an abbreviation.
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; ) {
    let j = i;
    while (j < raw.length && raw[j].length === 1 && /[a-z]/.test(raw[j])) j++;

    if (j - i >= 2) {
      tokens.push(raw.slice(i, j).join(""));
      i = j;
    } else {
      tokens.push(raw[i]);
      i++;
    }
  }
  return tokens;
}

/** The last path segment, which is the product key on every site we crawl. */
export function slugOfUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const last = path.split("/").pop() ?? "";
    // Some templates use underscores where the rest of the site uses hyphens.
    return slugify(last.replace(/_/g, "-"));
  } catch {
    return "";
  }
}

/**
 * Compare one model against one candidate slug.
 *
 * Returns null when they are not the same product. `exact` means the token sets
 * are equal; `coded` means the candidate carried extra SKU or furniture tokens
 * and nothing else.
 */
export function compare(modelTokens: string[], candidateSlug: string, brandTokens: string[]): MatchTier | null {
  if (modelTokens.length === 0) return null;

  const candidateTokens = tokenise(candidateSlug);
  if (candidateTokens.length === 0) return null;

  // The brand often prefixes the candidate ("victor-thruster-k-330"), and some
  // templates bake the page title into the slug ("…-sports-gear-yonex"). Both
  // are implied by which provider we are talking to, so neither carries
  // information about which product this is.
  const brand = new Set(brandTokens);
  const remaining = candidateTokens.filter((token) => !brand.has(token) && !FURNITURE.has(token));

  if (remaining.length < modelTokens.length) return null;

  // The model has to be a *prefix* of what is left, in order — not merely a
  // subset of it. Containment alone is too generous: it let "Blizzard Pro New"
  // take the page for "Blizzard Pro ZZ (New)", because `zz` is short enough to
  // look like a SKU fragment and containment did not care that it sat between
  // two model tokens rather than after them. A code that trails the whole model
  // name is a SKU; a code wedged inside it is a different model.
  for (let i = 0; i < modelTokens.length; i++) {
    if (remaining[i] !== modelTokens[i]) return null;
  }

  const extras = remaining.slice(modelTokens.length);
  if (extras.length === 0) return "exact";

  // What trails the model may only be a SKU fragment. A real word there means
  // a different product — `pure`, `power`, `series`, `unveiled` all land here,
  // which is what rejects the press releases sharing Yonex's root path.
  for (const token of extras) {
    if (!isCodeLike(token)) return null;
  }

  return "coded";
}

/**
 * Pick the best candidate for one model, or nothing.
 *
 * Exact beats coded. Within a tier, matching candidates are grouped by product
 * identity: one group means one racket published across several colourway
 * pages, and all of them are crawled. More than one group means the model name
 * genuinely does not pick out a single product — the catalogue holds a racket
 * called just "ARS", which matches `ars-70f-a` and `ars-80x-c` equally — and
 * the caller is handed the collision in `rivals` so it can refuse.
 */
export function bestMatch(
  modelName: string,
  brandName: string,
  candidates: MatchCandidate[],
): MatchResult | null {
  const modelTokens = tokenise(modelName);
  const brandTokens = tokenise(brandName);

  const exact: MatchCandidate[] = [];
  const coded: MatchCandidate[] = [];

  for (const candidate of candidates) {
    // Try the product's own name first where discovery supplied one, and fall
    // back to the URL slug. Taking the better of the two matters both ways:
    // Apacs' "Pro Commander 6.4 New" has a permalink that drops the "new",
    // while some shops give a tidy slug to a title cluttered with marketing.
    const byTitle = candidate.title ? compare(modelTokens, candidate.title, brandTokens) : null;
    const bySlug = compare(modelTokens, candidate.slug, brandTokens);
    const tier = byTitle === "exact" || bySlug === "exact" ? "exact" : (byTitle ?? bySlug);

    if (tier === "exact") exact.push(candidate);
    else if (tier === "coded") coded.push(candidate);
  }

  const tier: MatchTier = exact.length > 0 ? "exact" : "coded";
  const pool = exact.length > 0 ? exact : coded;
  if (pool.length === 0) return null;

  const groups = new Map<string, MatchCandidate[]>();
  for (const candidate of pool) {
    const key = productKey(candidate.slug);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  // The shortest slug in the pool is the canonical page; its group is the one
  // we take, and any other group is a different product that matched as well.
  const sorted = [...pool].sort((a, b) => a.slug.length - b.slug.length || a.slug.localeCompare(b.slug));
  const winner = sorted[0];
  const winningKey = productKey(winner.slug);

  const family = (groups.get(winningKey) ?? [winner]).sort((a, b) =>
    a.slug.length - b.slug.length || a.slug.localeCompare(b.slug),
  );
  const rivals = [...groups.entries()]
    .filter(([key]) => key !== winningKey)
    .map(([, group]) => group[0]);

  return {
    candidate: family[0],
    tier,
    siblings: family.slice(1),
    rivals,
  };
}
