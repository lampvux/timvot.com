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
  facetCounts,
  getBrands,
  getRackets,
} from "@/lib/data/repository";
import { parseFilters, type SearchParams } from "@/lib/filters";
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

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("catalog");
  const te = await getTranslations("enums");

  const filters = parseFilters(await searchParams);
  const [allRackets, brands] = await Promise.all([getRackets(), getBrands()]);

  const results = applyFilters(allRackets, filters);
  const counts = facetCounts(allRackets, filters);

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
        count: applyFilters(allRackets, {
          ...filters,
          flexes: filters.flexes.filter((f) => f !== flex),
        }).length,
      })),
      ...filters.balanceTypes.map((balanceType) => ({
        label: te(BALANCE_MESSAGE_KEY[balanceType]),
        count: applyFilters(allRackets, {
          ...filters,
          balanceTypes: filters.balanceTypes.filter((b) => b !== balanceType),
        }).length,
      })),
      ...(filters.priceMin !== null || filters.priceMax !== null
        ? [
            {
              label: t("sortPriceAsc"),
              count: applyFilters(allRackets, {
                ...filters,
                priceMin: null,
                priceMax: null,
              }).length,
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
          <h1 className="font-display text-h2 font-bold text-primary">
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {results.map((racket) => (
              <RacketCard
                key={racket.id}
                racket={racket}
                mobileLayout="horizontal"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
