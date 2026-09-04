"use client";

import {
  Suspense,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { Icon, IconButton, cx, type IconName } from "@/components/ds/primitives";
import { Input } from "@/components/ds/forms";
import { beginNavigation } from "@/components/navigation-progress";
import { LanguageSwitcher } from "./language-switcher";

const NAV: { href: string; key: string }[] = [
  { href: "/rackets", key: "rackets" },
  { href: "/strings", key: "strings" },
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

/** `null` while the pathname is still streaming, which reads as "not active"
 *  rather than as a wrong guess. */
function isActive(pathname: string | null, href: string) {
  if (pathname === null) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Which link is highlighted is the only thing here that depends on the URL, and
 * `usePathname()` is runtime data — under Cache Components, reading it outside
 * a `<Suspense>` boundary blocks the prerender for every route this chrome
 * appears on, which is all of them.
 *
 * So the links themselves are in the static shell, where they belong: they are
 * navigation, and they have to work and be crawlable from the first byte. Only
 * the highlight streams. The fallback renders the same markup with nothing
 * marked active, so the settle is one underline appearing, not a layout shift.
 */
function NavLinks({ pathname }: { pathname: string | null }) {
  const t = useTranslations("nav");

  return (
    <>
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
    </>
  );
}

function LiveNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

function TabLinks({ pathname }: { pathname: string | null }) {
  const t = useTranslations("nav");

  return (
    <>
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
    </>
  );
}

function LiveTabLinks() {
  return <TabLinks pathname={usePathname()} />;
}

interface SearchFormProps {
  id: string;
  className: string;
  size: "sm" | "md";
  autoFocus?: boolean;
  onComplete?: () => void;
}

function SearchFormShell({
  id,
  className,
  size,
}: Omit<SearchFormProps, "onComplete">) {
  const t = useTranslations("nav");
  return (
    <form className={className}>
      <label className="sr-only" htmlFor={id}>
        {t("search")}
      </label>
      <Input
        id={id}
        name="q"
        size={size}
        type="search"
        disabled
        iconLeft="Search"
        placeholder={t("searchPlaceholder")}
      />
    </form>
  );
}

/** `useRouter()` is URL data in next-intl's navigation wrapper. Keep it in a
 *  leaf Suspense boundary so adding client-side search does not opt the shared
 *  header — and therefore every route — out of its static shell. */
function SearchForm({
  id,
  className,
  size,
  autoFocus,
  onComplete,
}: SearchFormProps) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();

    onComplete?.();
    beginNavigation();
    startTransition(() => {
      router.push({ pathname: "/rackets", query: query ? { q: query } : {} });
    });
  };

  return (
    <form onSubmit={submit} aria-busy={pending} className={className}>
      <label className="sr-only" htmlFor={id}>
        {t("search")}
      </label>
      <Input
        id={id}
        name="q"
        size={size}
        type="search"
        autoFocus={autoFocus}
        iconLeft="Search"
        placeholder={t("searchPlaceholder")}
      />
    </form>
  );
}

/** 60px top bar on desktop, 52px on mobile. The only element that pins on
 *  every surface. */
export function TopBar({ accountSlot }: { accountSlot: ReactNode }) {
  const t = useTranslations("nav");
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-[100] border-b border-line bg-card">
      <div className="flex h-[52px] items-center gap-2 px-4 lg:h-[60px] lg:gap-4 lg:px-4 xl:gap-8 xl:px-10">
        <Link
          href="/"
          className="display flex h-11 shrink-0 items-center text-[17px] text-brand no-underline lg:h-auto lg:text-[19px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          Shuttlecraft
        </Link>

        <nav
          aria-label={t("rackets")}
          className="hidden items-center gap-3 lg:flex xl:gap-6"
        >
          <Suspense fallback={<NavLinks pathname={null} />}>
            <LiveNavLinks />
          </Suspense>
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:gap-3">
          <Suspense
            fallback={
              <SearchFormShell
                id="site-search"
                size="sm"
                className="hidden w-[200px] lg:block xl:w-[300px]"
              />
            }
          >
            <SearchForm
              id="site-search"
              size="sm"
              className="hidden w-[200px] lg:block xl:w-[300px]"
            />
          </Suspense>

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
        <Suspense
          fallback={
            <SearchFormShell
              id="mobile-search"
              size="md"
              className="border-t border-line px-4 py-2.5 lg:hidden"
            />
          }
        >
          <SearchForm
            id="mobile-search"
            size="md"
            autoFocus
            onComplete={() => setSearchOpen(false)}
            className="border-t border-line px-4 py-2.5 lg:hidden"
          />
        </Suspense>
      )}
    </header>
  );
}

/** 58px tab bar, five destinations, 44px minimum target. */
export function MobileTabBar() {
  const t = useTranslations("nav");

  return (
    <nav
      aria-label={t("home")}
      className="sticky bottom-0 z-[100] grid h-[58px] grid-cols-5 border-t border-line bg-card lg:hidden"
    >
      {/* Five fixed cells either way, so the bar's geometry is in the shell and
          only the active tint arrives later. */}
      <Suspense fallback={<TabLinks pathname={null} />}>
        <LiveTabLinks />
      </Suspense>
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
