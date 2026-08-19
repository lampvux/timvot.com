import { defineRouting } from "next-intl/routing";

/**
 * Shuttlecraft ships Vietnamese-first with English available.
 *
 * `localeDetection` is on, so a first-time visitor lands in whatever locale
 * their browser asks for — "default current locale". The NEXT_LOCALE cookie
 * then pins their explicit choice from the language switcher.
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
