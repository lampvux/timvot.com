"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { localeNames, routing, type Locale } from "@/i18n/routing";
import { Icon, cx } from "@/components/ds/primitives";
import { beginNavigation } from "@/components/navigation-progress";

/**
 * Visitors start in Vietnamese. This switcher writes the explicit choice to
 * the NEXT_LOCALE cookie, so it wins on later unprefixed visits.
 *
 * Switching needs the current path, and `usePathname()`/`useParams()` are URL
 * data — under Cache Components, reading either outside a `<Suspense>`
 * boundary blocks the prerender for every route this sits on, which is all of
 * them. So the button's *appearance* is in the static shell and only its
 * *behaviour* streams.
 *
 * The label comes from `useLocale()` rather than `params.locale`, which is what
 * makes that split worth having: the fallback shows the right language already,
 * so nothing changes visually when the live version arrives. next-intl reads
 * that from the provider the server layout renders, not from the URL.
 */

function SwitcherButton({
  current,
  compact,
  pending,
  onSwitch,
}: {
  current: Locale;
  compact?: boolean;
  pending?: boolean;
  /** Absent until the pathname has streamed in. */
  onSwitch?: () => void;
}) {
  const t = useTranslations("nav");
  const other =
    routing.locales.find((locale) => locale !== current) ?? routing.defaultLocale;

  return (
    <button
      type="button"
      // Not yet interactive rather than interactive-but-broken: without a
      // pathname there is nowhere to switch to.
      disabled={pending || !onSwitch}
      aria-label={`${t("language")}: ${localeNames[other].label}`}
      onClick={onSwitch}
      className={cx(
        "inline-flex items-center gap-1.5 font-ui text-[12px] font-semibold text-secondary",
        "transition-colors duration-[90ms] ease-out hover:text-primary",
        compact
          ? "h-11 px-2"
          : "h-11 rounded-pill border border-line px-2.5 hover:bg-[var(--action-ghost-bg-hover)] lg:h-8",
        pending && "opacity-70",
      )}
    >
      {!compact && <Icon name="Languages" size="sm" />}
      {localeNames[current].short}
    </button>
  );
}

function LiveLanguageSwitcher({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = (params.locale as Locale) ?? routing.defaultLocale;
  const other =
    routing.locales.find((locale) => locale !== current) ?? routing.defaultLocale;

  return (
    <SwitcherButton
      current={current}
      compact={compact}
      pending={pending}
      onSwitch={() =>
        startTransition(() => {
          beginNavigation();
          router.replace(
            // The query goes with it. Filters live in the URL, so switching
            // language without carrying them drops whatever the visitor was
            // looking at — a filtered, sorted, paginated catalogue becomes an
            // unfiltered first page, in the other language, with no way back.
            // @ts-expect-error — pathname is a known route at runtime
            { pathname, params, query: Object.fromEntries(searchParams) },
            { locale: other },
          );
        })
      }
    />
  );
}

export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const locale = useLocale() as Locale;

  return (
    <Suspense fallback={<SwitcherButton current={locale} compact={compact} />}>
      <LiveLanguageSwitcher compact={compact} />
    </Suspense>
  );
}
