/**
 * Which Google Fonts subsets this site actually needs.
 *
 * Three faces × three subsets, with Be Vietnam Pro at six static weights, was
 * twenty-four font files and 432 KB — all of them preloaded at the highest
 * priority the browser has, competing with the LCP image for the same
 * connection. Dropping a subset is the cheapest way to halve that, and it is
 * also the one change that can silently break Vietnamese: a missing subset
 * does not error, it renders tofu.
 *
 * So the decision is written down here as ranges, and `font-subsets.test.ts`
 * checks every string the site can render against them. A scraped racket name
 * that introduces a codepoint outside these ranges fails the test rather than
 * shipping a box.
 *
 * The ranges are Google Fonts' own, as served in the `unicode-range`
 * descriptors for these families.
 */

export interface CodepointRange {
  from: number;
  to: number;
}

const range = (from: number, to = from): CodepointRange => ({ from, to });

/** Google's `latin` subset. Basic Latin, Latin-1, punctuation, currency. */
export const LATIN: CodepointRange[] = [
  range(0x0000, 0x00ff),
  range(0x0131),
  range(0x0152, 0x0153),
  range(0x02bb, 0x02bc),
  range(0x02c6),
  range(0x02da),
  range(0x02dc),
  range(0x0304),
  range(0x0308),
  range(0x0329),
  range(0x2000, 0x206f),
  range(0x2074),
  range(0x20ac),
  range(0x2122),
  range(0x2191),
  range(0x2193),
  range(0x2212),
  range(0x2215),
  range(0xfeff),
  range(0xfffd),
];

/**
 * Google's `vietnamese` subset.
 *
 * It carries only the codepoints Vietnamese adds — the precomposed vowels of
 * U+1EA0–1EF9, the horned and barred letters, the combining tone marks, and
 * the đồng sign at U+20AB. It does **not** carry basic Latin, which is why
 * `latin` stays loaded on Vietnamese pages too and is not a subset that can be
 * dropped in either locale.
 */
export const VIETNAMESE: CodepointRange[] = [
  range(0x0102, 0x0103),
  range(0x0110, 0x0111),
  range(0x0128, 0x0129),
  range(0x0168, 0x0169),
  range(0x01a0, 0x01a1),
  range(0x01af, 0x01b0),
  range(0x0300, 0x0301),
  range(0x0303, 0x0304),
  range(0x0308, 0x0309),
  range(0x0323),
  range(0x0329),
  range(0x1ea0, 0x1ef9),
  range(0x20ab),
];

/**
 * Google's `latin-ext` subset — the one this site no longer loads.
 *
 * Kept so the audit can answer the question that actually matters when a glyph
 * turns up missing: would loading this back fix it? A character outside these
 * ranges too was never covered and is a data problem, not a font decision.
 * The live catalogue has exactly one, and it is CJK — see
 * `scripts/audit-font-glyphs.ts`.
 */
export const LATIN_EXT: CodepointRange[] = [
  range(0x0100, 0x02ba),
  range(0x02bd, 0x02c5),
  range(0x02c7, 0x02cc),
  range(0x02ce, 0x02d7),
  range(0x02dd, 0x02ff),
  range(0x0304),
  range(0x0308),
  range(0x0329),
  range(0x1d00, 0x1dbf),
  range(0x1e00, 0x1e9f),
  range(0x1ef2, 0x1eff),
  range(0x2020),
  range(0x20a0, 0x20ab),
  range(0x20ad, 0x20c0),
  range(0x2113),
  range(0x2c60, 0x2c7f),
  range(0xa720, 0xa7ff),
];

/** What the app loads. `latin-ext` is deliberately absent — see the test. */
export const LOADED_SUBSETS = [...LATIN, ...VIETNAMESE];

export function isCovered(
  codepoint: number,
  subsets: CodepointRange[] = LOADED_SUBSETS,
): boolean {
  return subsets.some((r) => codepoint >= r.from && codepoint <= r.to);
}

/** Every codepoint in `text` that no loaded subset can render. */
export function uncoveredCodepoints(
  text: string,
  subsets: CodepointRange[] = LOADED_SUBSETS,
): Set<number> {
  const missing = new Set<number>();
  for (const character of text) {
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined) continue;
    if (!isCovered(codepoint, subsets)) missing.add(codepoint);
  }
  return missing;
}
