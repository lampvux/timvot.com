"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import {
  Button,
  ButtonLinkStyle,
  cx,
  Icon,
  IconButton,
} from "@/components/ds/primitives";

/**
 * The compare tray.
 *
 * Persistent bottom bar once at least one racket is selected, never a modal —
 * the user is mid-browse and the tray must not take the page away. Capped at
 * four, because a comparison table with five columns stops being readable.
 */

export const COMPARE_MAX = 4;
const STORAGE_KEY = "shuttlecraft:compare";

interface TrayItem {
  slug: string;
  name: string;
  brand: string;
}

interface CompareContextValue {
  items: TrayItem[];
  slugs: string[];
  has: (slug: string) => boolean;
  toggle: (item: TrayItem) => void;
  remove: (slug: string) => void;
  clear: () => void;
  isFull: boolean;
  hydrated: boolean;
}

const CompareContext = createContext<CompareContextValue | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<TrayItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw) as TrayItem[]);
    } catch {
      // A corrupt tray is not worth an error state — start empty.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const toggle = useCallback((item: TrayItem) => {
    setItems((current) => {
      if (current.some((i) => i.slug === item.slug))
        return current.filter((i) => i.slug !== item.slug);
      if (current.length >= COMPARE_MAX) return current;
      return [...current, item];
    });
  }, []);

  const remove = useCallback((slug: string) => {
    setItems((current) => current.filter((i) => i.slug !== slug));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CompareContextValue>(
    () => ({
      items,
      slugs: items.map((i) => i.slug),
      has: (slug) => items.some((i) => i.slug === slug),
      toggle,
      remove,
      clear,
      isFull: items.length >= COMPARE_MAX,
      hydrated,
    }),
    [items, toggle, remove, clear, hydrated],
  );

  return (
    <CompareContext.Provider value={value}>{children}</CompareContext.Provider>
  );
}

export function useCompare(): CompareContextValue {
  const context = useContext(CompareContext);
  if (!context)
    throw new Error("useCompare must be used inside a CompareProvider");
  return context;
}

/** Button labels stay identical through a flow. */
export function CompareToggle({
  item,
  size = "md",
  fullWidth,
  iconOnly = false,
  shortLabel = false,
}: {
  item: TrayItem;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  iconOnly?: boolean;
  shortLabel?: boolean;
}) {
  const t = useTranslations("common");
  const { has, toggle, isFull, hydrated } = useCompare();
  const selected = has(item.slug);

  if (iconOnly) {
    return (
      <IconButton
        icon={selected ? "Check" : "GitCompare"}
        label={selected ? t("inComparison") : t("addToComparison")}
        variant={selected ? "primary" : "secondary"}
        size={size}
        active={selected}
        disabled={!hydrated || (isFull && !selected)}
        onClick={() => toggle(item)}
      />
    );
  }

  return (
    <Button
      variant={selected ? "primary" : "secondary"}
      size={size}
      fullWidth={fullWidth}
      iconLeft={selected ? "Check" : "GitCompare"}
      aria-label={selected ? t("inComparison") : t("addToComparison")}
      disabled={!hydrated || (isFull && !selected)}
      onClick={() => toggle(item)}
    >
      {selected ? t("inComparison") : shortLabel ? t("compare") : t("addToComparison")}
    </Button>
  );
}

/**
 * The tray is empty until the provider has read localStorage, so during a
 * prerender it renders nothing at all — which is why the `usePathname()` call
 * lives in `TrayBody` rather than here.
 *
 * That read is URL data, and under Cache Components reading it outside a
 * `<Suspense>` boundary blocks the prerender for every route the tray sits on,
 * which is all of them. Moving it behind the empty check means the prerender
 * never reaches it, so no boundary is needed and nothing has to settle
 * afterwards: by the time a tray exists, the browser is already running.
 */
export function CompareTray() {
  const { items } = useCompare();
  if (items.length === 0) return null;
  return <TrayBody />;
}

function TrayBody() {
  const t = useTranslations("compare");
  const tc = useTranslations("common");
  const { items, remove, clear, isFull } = useCompare();
  const pathname = usePathname();
  // The detail page carries its own compare button, so the mobile tray would
  // be a second one covering it.
  const isRacketDetail = /^\/rackets\/[^/]+\/[^/]+$/.test(pathname);
  const canCompare = items.length >= 2;

  return (
    <>
      {!isRacketDetail && <div className="h-[65px] lg:hidden" aria-hidden />}
      <div
        className={cx(
          isRacketDetail && "hidden lg:block",
          "fixed inset-x-0 bottom-[var(--mobile-tabbar-h)] z-[110] border-t border-line-strong bg-card px-3 py-2.5",
          "shadow-[var(--shadow-sticky-up)] lg:sticky lg:bottom-0 lg:z-[100] lg:px-10",
        )}
        role="region"
        aria-label={t("tray")}
      >
        <div className="mx-auto flex max-w-[var(--page-max)] items-center gap-3">
          <span className="eyebrow hidden shrink-0 sm:block">{t("tray")}</span>

          <ul className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
          {items.map((item) => (
            <li key={item.slug}>
              <span
                className="flex h-11 items-center gap-2 rounded-pill border border-line bg-page pl-3 pr-1
                  text-[12.5px] font-medium whitespace-nowrap text-primary lg:h-9"
              >
                {item.name}
                <button
                  onClick={() => remove(item.slug)}
                  aria-label={`${tc("removeFromComparison")}: ${item.name}`}
                  className="grid size-11 place-items-center rounded-full text-tertiary
                    transition-colors duration-[90ms] hover:bg-sunken hover:text-primary lg:size-7"
                >
                  <Icon name="X" size="sm" className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
          {!isFull && items.length < 2 && (
            <li className="hidden shrink-0 sm:block">
              <span className="text-caption text-tertiary">{t("needTwo")}</span>
            </li>
          )}
          </ul>

          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              icon="Trash2"
              label={tc("clearAll")}
              variant="ghost"
              size="md"
              onClick={clear}
            />
            {canCompare ? (
              <Link
                href={{
                  pathname: "/compare",
                  query: { ids: items.map((i) => i.slug).join(",") },
                }}
                className={ButtonLinkStyle({ variant: "primary", size: "md" })}
              >
                {t("trayCompare", { count: items.length })}
                <Icon name="ArrowRight" size="sm" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className={cx(
                  ButtonLinkStyle({ variant: "primary", size: "md" }),
                  "cursor-not-allowed bg-[var(--action-disabled-bg)] text-[var(--text-disabled)]",
                )}
              >
                {t("trayCompare", { count: items.length })}
                <Icon name="ArrowRight" size="sm" />
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
