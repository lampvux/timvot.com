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
  applyFilters,
  countFilteredRackets,
  facetCounts,
  getBrands,
  getRackets,
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "catalog" });
  return { title: t("title") };
}

const toRecord = <T extends string>(map: Map<T, number>): Record<string, number> =>
  Object.fromEntries(map.entries());

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
  const [allRackets, brands] = await Promise.all([getRackets(), getBrands()]);

  // `results` stays the full match set: the heading count, the empty-state
  // suggestions and the facet counts are all answers about the whole result,
  // not about one page of it. Only the grid is sliced.
  const results = applyFilters(allRackets, filters);
  const counts = facetCounts(allRackets, filters);

  const pages = pageCount(results.length);
  const page = Math.min(parsePage(search), pages);
  const pageResults = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const facets: FacetCounts = {
    brands: toRecord(counts.brands),
    weightClasses: toRecord(counts.weightClasses),
    balanceTypes: toRecord(counts.balanceTypes),
    flexes: toRecord(counts.flexes),
  };

  /**
   * Empty states say what to do next, with the number that makes the advice
   * actionable: "Removing 'extra stiff' gives 12 results."
   */
  let emptyBody = t("emptyBodyNoSuggestion");
  if (results.length === 0) {
    const candidates: { label: string; count: number }[] = [
      ...filters.flexes.map((flex) => ({
        label: te(FLEX_MESSAGE_KEY[flex]),
        count: countFilteredRackets(allRackets, {
          ...filters,
          flexes: filters.flexes.filter((f) => f !== flex),
        }),
      })),
      ...filters.balanceTypes.map((balanceType) => ({
        label: te(BALANCE_MESSAGE_KEY[balanceType]),
        count: countFilteredRackets(allRackets, {
          ...filters,
          balanceTypes: filters.balanceTypes.filter((b) => b !== balanceType),
        }),
      })),
      ...(filters.priceMin !== null || filters.priceMax !== null
        ? [
            {
              label: t("sortPriceAsc"),
              count: countFilteredRackets(allRackets, {
                ...filters,
                priceMin: null,
                priceMax: null,
              }),
            },
          ]
        : []),
    ].filter((candidate) => candidate.count > 0);

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
        resultCount={results.length}
      />

      <div className="min-w-0 flex-1 px-4 pb-10 pt-6 lg:px-10">
        <div className="mb-3.5 flex flex-wrap items-center gap-3">
          <h1
            className="font-display text-h2 font-bold text-primary"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="font-mono text-[24px] font-bold tabular-nums">
              {results.length}
            </span>{" "}
            {t("title").toLowerCase()}
          </h1>
          <div className="ml-auto flex items-center gap-2.5">
            <FilterSheet
              filters={filters}
              facets={facets}
              brands={brands}
              resultCount={results.length}
            />
            <SortSelect filters={filters} />
          </div>
        </div>

        <ActiveFilterPills filters={filters} brands={brands} />

        {results.length === 0 ? (
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
            <div id="racket-grid-top" className="scroll-mt-20 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
              {pageResults.map((racket, index) => (
                <RacketCard
                  key={racket.id}
                  racket={racket}
                  priority={index < 4}
                  mobileLayout="horizontal"
                />
              ))}
            </div>
            <Pagination
              filters={filters}
              page={page}
              pages={pages}
              total={results.length}
            />
          </>
        )}
      </div>
    </div>
  );
}
