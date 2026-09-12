import { Archivo, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";

/**
 * Three faces, three jobs, no overlap.
 *
 * All three carry the full Vietnamese diacritic set — a hard requirement that
 * eliminated most display faces. Loaded through next/font so the binaries are
 * self-hosted rather than fetched from the Google CDN at runtime.
 *
 * FILE COUNT IS A BUDGET HERE. Every (face × weight × subset) is one `woff2`
 * the browser can be asked for, and this layout renders all three faces on
 * every route. Three subsets × (Archivo + six Be Vietnam Pro weights +
 * JetBrains) was twenty-four files and 432 KB — the figure the production
 * baseline measured — of which a Vietnamese page fetched the sixteen matching
 * `latin` and `vietnamese`, ahead of the resource that decides LCP.
 *
 * Two changes, neither of them visual, take the emitted set to twelve and the
 * set a page actually fetches to twelve as well:
 *
 *   - `latin-ext` is no longer *preloaded*. `subsets` decides what next/font
 *     preloads, not which `@font-face` rules it writes: the build still emits
 *     the latin-ext rules, so a stray extended glyph still renders — it just
 *     fetches its file when the browser meets it instead of ahead of the page.
 *     Google's `vietnamese` subset carries only the codepoints Vietnamese
 *     adds, so `latin` has to stay preloaded in both locales.
 *
 *     That the site does not routinely need the extended range is checked
 *     rather than assumed: `src/lib/font-subsets.test.ts` scans both message
 *     files and the seed, and `scripts/audit-font-glyphs.ts` scans the live
 *     catalogue, which is where a scraped racket name would introduce one.
 *     Run the script after a scrape that adds a new source — a name that
 *     needs latin-ext on every card is a reason to preload it again.
 *
 *   - Be Vietnam Pro drops two of its six weights. 300 was declared and used
 *     nowhere. 800 is used, but only ever alongside `font-display` — every
 *     `font-extrabold` in the codebase is on an Archivo element — so it never
 *     resolved to this face.
 *
 * There is no variable Be Vietnam Pro to collapse the rest into; Google serves
 * the family as static weights only (`axes: null` in next/font's own font
 * data), which is why this face costs four files where the other two cost one
 * each. Going below twelve means self-hosting a custom subset through
 * `next/font/local`, which is a build step rather than a config change.
 *
 * `display: "swap"` stays on all three. The alternative, `optional`, would
 * leave a slow first load showing the fallback for the whole page view — and
 * on this site that means prices and spec values.
 */

/** Display. The width axis is a real tool: condensed 78 for dense table
 *  headers and eyebrows, expanded 112 for editorial headlines. */
export const archivo = Archivo({
  subsets: ["latin", "vietnamese"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

/** UI and body. Drawn for Vietnamese; diacritics hold at 13px. */
export const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  // 400 body, 500 `font-medium`, 600 `font-semibold`, 700 `font-bold`.
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
});

/** Data. Prices, spec codes, serials, deltas, tension. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "vietnamese"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const fontVariables = `${archivo.variable} ${beVietnamPro.variable} ${jetbrainsMono.variable}`;
