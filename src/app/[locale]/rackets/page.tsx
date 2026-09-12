import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { ButtonLinkStyle, EmptyState } from "@/components/ds/primitives";
import { RacketCard } from "@/components/racket-card";
import {
  ActiveFilterPills,
  FilterRail,
  FilterSheet,
  SortSelect,
  type FacetCounts,
} from "@/components/filter-rail";
import {
  countCatalogMatches,
  getBrands,
  getCatalogPage,
} from "@/lib/data/repository";
import { Pagination } from "@/components/pagination";
import { CatalogSkeleton } from "@/components/skeletons";
import {
  PAGE_SIZE,
  pageCount,
  parseFilters,
  parsePage,
  type SearchParams,
} from "@/lib/filters";
import { BALANCE_MESSAGE_KEY, FLEX_MESSAGE_KEY } from "@/lib/format";
import { orderBrandsByPopularity } from "@/lib/catalog-ranking";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "catalog" });
  return { title: t("title") };
}

/**
 * The catalogue's shell prerenders; the filtered result streams into it.
 *
 * Everything on this page is a function of `searchParams` — the rail's checked
 * boxes, the heading's count, the grid — so none of it can be in the static
 * shell. What can is the page's geometry, and that is what `CatalogSkeleton`
 * holds: the same rail width, the same three-column grid, the same card boxes.
 * A visitor gets that from the CDN immediately instead of a blank document,
 * and the results replace it without moving anything.
 *
 * The `searchParams` promise is passed down rather than awaited here. Awaiting
 * it in the page body is what made this route `ƒ` — Cache Components treats it
 * as runtime data, and reading it outside a `<Suspense>` boundary blocks the
 * prerender for the whole route.
 */
export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={<CatalogSkeleton />}>
      <CatalogResults locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}

async function CatalogResults({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<SearchParams>;
}) {
  setRequestLocale(locale);

  const t = await getTranslations("catalog");
  const te = await getTranslations("enums");

  const search = await searchParams;
  const filters = parseFilters(search);

  // One request for one page. The count, the facets and the 24 cards all come
  // back from `racket_market` with the offset applied in Postgres — the page
  // never holds the catalogue in memory to slice it. See
  // `src/lib/data/catalog-page.ts` for the fallback when the view is absent.
  const [result, allBrands] = await Promise.all([
    getCatalogPage(filters, parsePage(search), PAGE_SIZE),
    getBrands(),
  ]);
  const brands = orderBrandsByPopularity(allBrands);

  const total = result.total;
  const pages = pageCount(total);
  const page = Math.min(result.page, pages);
  const pageResults = result.rackets;
  const facets: FacetCounts = result.facets;

  /**
   * Empty states say what to do next, with the number that makes the advice
   * actionable: "Removing 'extra stiff' gives 12 results."
   */
  let emptyBody = t("emptyBodyNoSuggestion");
  if (total === 0) {
    // Each candidate is one `head: true` count — no rows, just the number. They
    // run in parallel, and only on a page that already has nothing to show.
    const probes: { label: string; filters: typeof filters }[] = [
      ...filters.flexes.map((flex) => ({
        label: te(FLEX_MESSAGE_KEY[flex]),
        filters: {
          ...filters,
          flexes: filters.flexes.filter((f) => f !== flex),
        },
      })),
      ...filters.balanceTypes.map((balanceType) => ({
        label: te(BALANCE_MESSAGE_KEY[balanceType]),
        filters: {
          ...filters,
          balanceTypes: filters.balanceTypes.filter((b) => b !== balanceType),
        },
      })),
      ...(filters.priceMin !== null || filters.priceMax !== null
        ? [
            {
              label: t("sortPriceAsc"),
              filters: { ...filters, priceMin: null, priceMax: null },
            },
          ]
        : []),
    ];

    const candidates = (
      await Promise.all(
        probes.map(async (probe) => ({
          label: probe.label,
          count: await countCatalogMatches(probe.filters),
        })),
      )
    ).filter((candidate) => candidate.count > 0);

    const best = candidates.sort((a, b) => b.count - a.count)[0];
    if (best)
      emptyBody = t("emptyBody", { filter: `"${best.label}"`, count: best.count });
  }

  return (
    <div className="flex items-stretch">
      <FilterRail
        filters={filters}
        facets={facets}
        brands={brands}
        resultCount={total}
      />

      <div className="min-w-0 flex-1 px-4 pb-10 pt-6 lg:px-10">
        <div className="mb-3.5 flex flex-wrap items-center gap-3">
          <h1
            className="font-display text-h2 font-bold text-primary"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="font-mono text-[24px] font-bold tabular-nums">
              {total}
            </span>{" "}
            {t("title").toLowerCase()}
          </h1>
          <div className="ml-auto flex items-center gap-2.5">
            <FilterSheet
              filters={filters}
              facets={facets}
              brands={brands}
              resultCount={total}
            />
            <SortSelect filters={filters} />
          </div>
        </div>

        <ActiveFilterPills filters={filters} brands={brands} />

        {total === 0 ? (
          <EmptyState
            title={t("emptyTitle")}
            body={emptyBody}
            action={
              <Link href="/rackets" className={ButtonLinkStyle({ size: "md" })}>
                {t("activeFilters")}
              </Link>
            }
          />
        ) : (
          <>
            <div
              id="racket-grid-top"
              className="scroll-mt-20 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 min-[1081px]:!grid-cols-6"
            >
              {/* `eager` on the first card only. The grid is the first thing
                  on this route, so its leading image is the LCP candidate —
                  and six competing preloads is why none of them arrived
                  first. Everything after it stays lazy. */}
              {pageResults.map((racket, index) => (
                <RacketCard
                  key={racket.id}
                  racket={racket}
                  eager={index === 0}
                  density="catalog"
                  mobileLayout="horizontal"
                />
              ))}
            </div>
            <Pagination
              filters={filters}
              page={page}
              pages={pages}
              total={total}
            />
          </>
        )}
      </div>
    </div>
  );
}
