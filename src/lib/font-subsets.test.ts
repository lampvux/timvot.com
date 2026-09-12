import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LOADED_SUBSETS, uncoveredCodepoints } from "./font-subsets";

/**
 * The guard on dropping `latin-ext`.
 *
 * Three faces × three subsets is twenty-four preloaded font files and 432 KB,
 * and `latin-ext` is a third of it. Dropping a subset does not fail loudly —
 * the browser falls back per glyph, so the page still renders and a single
 * Vietnamese name somewhere in a 3.010-racket catalogue quietly turns into
 * boxes. The only safe way to drop one is to check the actual text.
 *
 * So this reads every string the site can render — both message files and the
 * seeded catalogue, which is also the shape the scraper writes — and asserts
 * that nothing in them needs a subset that is no longer loaded.
 *
 * If this fails after a scrape, the answer is not to delete the racket. It is
 * to put the subset back in `src/app/fonts.ts` and here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

/** Where a missing glyph would actually be seen. */
const RENDERED_TEXT: { label: string; path: string[] }[] = [
  { label: "messages/vi.json", path: ["messages", "vi.json"] },
  { label: "messages/en.json", path: ["messages", "en.json"] },
  { label: "the seeded catalogue", path: ["src", "lib", "data", "seed.ts"] },
  { label: "the seeded strings", path: ["src", "lib", "data", "string-seed.ts"] },
];

const describe = (codepoint: number) =>
  `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")} ` +
  `(${String.fromCodePoint(codepoint)})`;

for (const source of RENDERED_TEXT) {
  test(`every glyph in ${source.label} is in a loaded subset`, () => {
    const missing = uncoveredCodepoints(read(...source.path));

    assert.deepEqual(
      [...missing].map(describe),
      [],
      `${source.label} needs glyphs no loaded font subset covers. Either the ` +
        `text is wrong, or src/app/fonts.ts needs its subset back.`,
    );
  });
}

test("Vietnamese still renders with its tone marks and its currency", () => {
  // The exact characters that would go missing first, and the ones that make
  // the failure obvious rather than subtle.
  const sample = "Vợt cầu lông · Yonex Astrox 88D Pro · ₫3.290.000 · Đã xác minh";
  assert.deepEqual([...uncoveredCodepoints(sample)].map(describe), []);
});

test("the typographic characters the design system mandates are covered", () => {
  // "Deltas carry a sign, a window, and U+2212 for minus" — a minus that falls
  // back to another face is exactly the kind of drift nobody reports.
  const sample = "−12% · 3 left · 10+ · “quoted” — dashed … ↑ ↓";
  assert.deepEqual([...uncoveredCodepoints(sample)].map(describe), []);
});

test("latin-ext is genuinely absent, not accidentally still covered", () => {
  // If this starts passing, the ranges above have drifted into latin-ext and
  // the test above stopped proving anything. U+0143 (Ń) is squarely inside
  // latin-ext and outside both loaded subsets.
  assert.equal(uncoveredCodepoints("Ń").size, 1);
  assert.ok(LOADED_SUBSETS.length > 0);
});
