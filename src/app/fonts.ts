import { Archivo, Google_Sans_Flex, JetBrains_Mono } from "next/font/google";

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
  subsets: ["latin", "vietnamese"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

/** UI and body. Primary font: Google Sans Flex.
 *
 *  `adjustFontFallback: false` because next/font's metrics table has no entry
 *  for this face: it cannot generate a size-adjusted fallback, and says so on
 *  every build ("Failed to find font override values"). Turning it off states
 *  that rather than warning about it. The fallback stack is the one
 *  `--font-ui` in globals.css already names. */
export const googleSansFlex = Google_Sans_Flex({
  subsets: ["latin", "vietnamese"],
  variable: "--font-google-sans-flex",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/** Data. Prices, spec codes, serials, deltas, tension. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "vietnamese"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const fontVariables = `${archivo.variable} ${googleSansFlex.variable} ${jetbrainsMono.variable}`;


