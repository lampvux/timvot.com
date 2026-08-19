import { Archivo, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";

/**
 * Three faces, three jobs, no overlap.
 *
 * All three carry the full Vietnamese diacritic set — a hard requirement that
 * eliminated most display faces. Loaded through next/font so the binaries are
 * self-hosted rather than fetched from the Google CDN at runtime.
 */

/** Display. The width axis is a real tool: condensed 78 for dense table
 *  headers and eyebrows, expanded 112 for editorial headlines. */
export const archivo = Archivo({
  subsets: ["latin", "latin-ext", "vietnamese"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

/** UI and body. Drawn for Vietnamese; diacritics hold at 13px. */
export const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-be-vietnam",
  display: "swap",
});

/** Data. Prices, spec codes, serials, deltas, tension. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext", "vietnamese"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const fontVariables = `${archivo.variable} ${beVietnamPro.variable} ${jetbrainsMono.variable}`;
