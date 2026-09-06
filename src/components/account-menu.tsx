"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Icon } from "@/components/ds/primitives";
import { signOut } from "@/lib/auth-actions";

export function AccountMenu({
  email,
  displayName,
}: {
  email: string;
  displayName: string;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const itemClass =
    "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[13.5px] font-medium text-primary no-underline transition-colors hover:bg-[var(--action-ghost-bg-hover)]";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="account-navigation"
        aria-label={t("accountMenu")}
        className="grid size-11 place-items-center rounded-md text-ink-700 transition-colors duration-[90ms] hover:bg-[var(--action-ghost-bg-hover)]"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="UserRound" size="md" />
      </button>

      {open && (
        <div
          id="account-navigation"
          className="absolute right-0 top-[calc(100%+8px)] z-[150] w-[min(88vw,280px)] rounded-md border border-line bg-card p-2 shadow-2"
        >
          <div className="border-b border-line px-3 pb-2.5 pt-1.5">
            <p className="truncate text-[13.5px] font-semibold text-primary">
              {displayName}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-tertiary">
              {email}
            </p>
          </div>

          <nav aria-label={t("accountMenu")} className="mt-1 grid gap-0.5">
            <Link href="/account" className={itemClass} onClick={() => setOpen(false)}>
              <Icon name="Bell" size="sm" />
              {t("watchlist")}
            </Link>
            <Link
              href="/account/profile"
              className={itemClass}
              onClick={() => setOpen(false)}
            >
              <Icon name="UserRound" size="sm" />
              {t("profile")}
            </Link>
            <Link href="/seller" className={itemClass} onClick={() => setOpen(false)}>
              <Icon name="BadgeCheck" size="sm" />
              {t("sellerCentre")}
            </Link>
          </nav>

          <form action={signOut} className="mt-1 border-t border-line pt-1">
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className={itemClass}>
              <Icon name="LogOut" size="sm" />
              {tc("signOut")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
