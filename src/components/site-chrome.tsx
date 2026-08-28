"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { Icon, IconButton, cx, type IconName } from "@/components/ds/primitives";
import { Input } from "@/components/ds/forms";
import { LanguageSwitcher } from "./language-switcher";

const NAV: { href: string; key: string }[] = [
  { href: "/rackets", key: "rackets" },
  { href: "/compare", key: "compare" },
  { href: "/finder", key: "finder" },
  { href: "/deals", key: "deals" },
  { href: "/guides", key: "guides" },
  { href: "/sellers", key: "sellers" },
];

const TABS: { href: string; key: string; icon: IconName }[] = [
  { href: "/", key: "home", icon: "House" },
  { href: "/rackets", key: "rackets", icon: "LayoutGrid" },
  { href: "/compare", key: "compare", icon: "GitCompare" },
  { href: "/deals", key: "deals", icon: "Bell" },
  { href: "/account", key: "account", icon: "UserRound" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** 60px top bar on desktop, 52px on mobile. The only element that pins on
 *  every surface. */
export function TopBar({ accountSlot }: { accountSlot: ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-[100] border-b border-line bg-card">
      <div className="flex h-[52px] items-center gap-2 px-4 lg:h-[60px] lg:gap-8 lg:px-10">
        <Link
          href="/"
          className="display flex h-11 shrink-0 items-center text-[17px] text-brand no-underline lg:h-auto lg:text-[19px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Shuttlecraft
        </Link>

        <nav
          aria-label={t("rackets")}
          className="hidden items-center gap-6 lg:flex"
        >
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "py-[19px] text-[14px] no-underline transition-colors duration-[90ms]",
                  active
                    ? "font-semibold text-brand shadow-[inset_0_-2px_0_var(--green-700)]"
                    : "font-medium text-ink-700 hover:text-brand",
                )}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:gap-3">
          <form action="/rackets" className="hidden w-[300px] lg:block">
            <label className="sr-only" htmlFor="site-search">
              {t("search")}
            </label>
            <Input
              id="site-search"
              name="q"
              size="sm"
              type="search"
              iconLeft="Search"
              placeholder={t("searchPlaceholder")}
            />
          </form>

          <div className="lg:hidden">
            <IconButton
              icon={searchOpen ? "X" : "Search"}
              label={t("search")}
              onClick={() => setSearchOpen((open) => !open)}
            />
          </div>

          <LanguageSwitcher />

          {/* Server-rendered and streamed — see components/auth-slot.tsx. The
              bar is a client component, so who is signed in arrives as a
              rendered slot rather than a prop the client has to be told. */}
          {accountSlot}
        </div>
      </div>

      {searchOpen && (
        <form action="/rackets" className="border-t border-line px-4 py-2.5 lg:hidden">
          <label className="sr-only" htmlFor="mobile-search">
            {t("search")}
          </label>
          <Input
            id="mobile-search"
            name="q"
            size="md"
            type="search"
            autoFocus
            iconLeft="Search"
            placeholder={t("searchPlaceholder")}
          />
        </form>
      )}
    </header>
  );
}

/** 58px tab bar, five destinations, 44px minimum target. */
export function MobileTabBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("home")}
      className="sticky bottom-0 z-[100] grid h-[58px] grid-cols-5 border-t border-line bg-card lg:hidden"
    >
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex flex-col items-center justify-center gap-[3px] no-underline",
              active ? "text-brand" : "text-tertiary",
            )}
          >
            <Icon name={tab.icon} size="md" />
            <span className="text-[10.5px] font-semibold">{t(tab.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** One inverse court-green band per page: the hero and the footer read as the
 *  same band, and nothing between them is tinted. */
export function SiteFooter() {
  const t = useTranslations("nav");

  return (
    <footer
      data-theme="inverse"
      className="bg-green-900 px-4 py-7 lg:px-10"
    >
      <div className="mx-auto flex max-w-[var(--page-max)] flex-wrap items-center gap-x-6 gap-y-3">
        <span className="display text-[15px] text-white">Shuttlecraft</span>
        <div className="flex flex-wrap gap-x-6 text-body-sm">
          {(["methodology", "sellers", "guides"] as const).map((key) => (
            <Link
              key={key}
              href={key === "methodology" ? "/methodology" : `/${key}`}
              className="inline-flex min-h-11 items-center text-secondary no-underline hover:text-white lg:min-h-0"
            >
              {t(key)}
            </Link>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-tertiary">
          Tiếng Việt · English
        </span>
      </div>
    </footer>
  );
}
