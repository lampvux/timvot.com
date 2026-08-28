import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Icon, cx } from "@/components/ds/primitives";
import { pageQuery } from "@/lib/filters";
import type { CatalogFilters } from "@/lib/types";

/**
 * Catalogue paging.
 *
 * Real `<Link>`s carrying the current filters, so a page deep in a filtered
 * result still survives being pasted into a chat — the same reason the filters
 * themselves live in the URL. No infinite scroll and no client-side "load
 * more": both fork the result state out of the URL, which is the one thing the
 * catalogue is not allowed to do.
 *
 * Rendered on the server, so paging ships no JavaScript at all.
 */

const STEP =
  "inline-flex h-11 items-center gap-1.5 rounded-md border px-3.5 text-[13.5px] " +
  "font-semibold no-underline transition-colors duration-[90ms]";

export async function Pagination({
  filters,
  page,
  pages,
  total,
}: {
  filters: CatalogFilters;
  page: number;
  pages: number;
  total: number;
}) {
  if (pages <= 1) return null;

  const t = await getTranslations("catalog");
  const prev = page > 1 ? page - 1 : null;
  const next = page < pages ? page + 1 : null;

  return (
    <nav
      aria-label={t("pagination")}
      className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5"
    >
      {prev ? (
        <Link
          href={{ pathname: "/rackets", query: pageQuery(filters, prev) }}
          rel="prev"
          className={cx(STEP, "border-line-strong bg-card text-primary hover:bg-sunken")}
        >
          <Icon name="ArrowLeft" size="sm" />
          {t("previous")}
        </Link>
      ) : (
        <span
          aria-hidden
          className={cx(STEP, "border-line text-[var(--text-disabled)]")}
        >
          <Icon name="ArrowLeft" size="sm" />
          {t("previous")}
        </span>
      )}

      {/* The count is the point of the control: it says how far the list goes,
          not just that there is more of it. */}
      <span className="order-last w-full text-center font-mono text-[12px] tabular-nums text-tertiary sm:order-none sm:w-auto">
        {t("pageOf", { page, pages, total })}
      </span>

      {next ? (
        <Link
          href={{ pathname: "/rackets", query: pageQuery(filters, next) }}
          rel="next"
          className={cx(STEP, "border-line-strong bg-card text-primary hover:bg-sunken")}
        >
          {t("next")}
          <Icon name="ArrowRight" size="sm" />
        </Link>
      ) : (
        <span
          aria-hidden
          className={cx(STEP, "border-line text-[var(--text-disabled)]")}
        >
          {t("next")}
          <Icon name="ArrowRight" size="sm" />
        </span>
      )}
    </nav>
  );
}
