"use client";

import { useParams } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { localeNames, routing, type Locale } from "@/i18n/routing";
import { Icon, cx } from "@/components/ds/primitives";

/**
 * The locale the visitor arrives in is detected from their browser. This
 * switcher writes the explicit choice to the NEXT_LOCALE cookie, so it wins
 * from then on.
 */
export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [pending, startTransition] = useTransition();

  const current = (params.locale as Locale) ?? routing.defaultLocale;
  const other =
    routing.locales.find((locale) => locale !== current) ?? routing.defaultLocale;

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`${t("language")}: ${localeNames[other].label}`}
      onClick={() =>
        startTransition(() => {
          router.replace(
            // @ts-expect-error — pathname is a known route at runtime
            { pathname, params },
            { locale: other },
          );
        })
      }
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
