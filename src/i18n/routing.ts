import { defineRouting } from "next-intl/routing";

/**
 * Shuttlecraft ships Vietnamese-first with English available.
 *
 * The proxy bypasses browser language detection until a valid NEXT_LOCALE
 * cookie exists. This makes Vietnamese the entry language while preserving
 * a language chosen with the switcher on later unprefixed visits.
 */
export const routing = defineRouting({
  locales: ["vi", "en"],
  defaultLocale: "vi",
  localePrefix: "always",
  localeDetection: true,
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },
});

export type Locale = (typeof routing.locales)[number];

export const localeNames: Record<Locale, { label: string; short: string }> = {
  vi: { label: "Tiếng Việt", short: "VI" },
  en: { label: "English", short: "EN" },
};
