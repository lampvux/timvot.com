import type {
  BalanceType,
  CatalogFilters,
  ShaftFlex,
  SortKey,
  WeightClass,
} from "./types";
import { EMPTY_FILTERS } from "./types";

/**
 * Filters live in the URL, not in component state.
 *
 * The catalogue is the page people paste into a group chat — a filtered view
 * has to survive being shared, and the result count has to be renderable on
 * the server for search engines.
 */

export const SEARCH_KEYS = {
  brand: "brand",
  weight: "weight",
  balance: "balance",
  flex: "flex",
  min: "min",
  max: "max",
  query: "q",
  sort: "sort",
  page: "page",
} as const;

/**
 * 24 divides evenly by the grid's 1, 2 and 3 columns, so no page ends on a
 * ragged row.
 *
 * The catalogue used to render every match — 3.010 cards on an unfiltered
 * view, each one a client component, so the whole catalogue arrived twice
 * (once as HTML, once as props in the RSC payload) and then hydrated. On
 * Vercel Hobby that is also the fastest way to spend the 100 GB monthly
 * transfer allowance.
 */
export const PAGE_SIZE = 24;

/**
 * Deliberately *not* part of `CatalogFilters`.
 *
 * `applyFilters` and `facetCounts` have to see the whole result set — a facet
 * count computed against one page is wrong. Keeping the page number out of the
 * filter object also means `filtersToQuery` drops it for free, so changing any
 * facet resets to page 1 without a line of code to say so.
 */
export function parsePage(params: SearchParams): number {
  const raw = Number(first(params[SEARCH_KEYS.page]));
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/** Total pages for a result count, never less than one. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** The query for a given page, with page 1 left implicit so the first page has
 *  the clean URL people actually share. */
export function pageQuery(
  filters: CatalogFilters,
  page: number,
): Record<string, string> {
  const query = filtersToQuery(filters);
  if (page > 1) query[SEARCH_KEYS.page] = String(page);
  return query;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const list = (value: string | string[] | undefined): string[] => {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw.split(",").map((v) => v.trim()).filter(Boolean);
};

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

const number = (value: string | string[] | undefined): number | null => {
  const raw = first(value).replace(/[^\d]/g, "");
  return raw ? Number(raw) : null;
};

const WEIGHT_CLASSES: WeightClass[] = ["2U", "3U", "4U", "5U"];
const BALANCE_TYPES: BalanceType[] = ["head-light", "even", "head-heavy"];
const FLEXES: ShaftFlex[] = ["extra-stiff", "stiff", "medium", "flexible"];
const SORTS: SortKey[] = ["score", "price-asc", "price-desc", "new"];

export function parseFilters(params: SearchParams): CatalogFilters {
  const sort = first(params[SEARCH_KEYS.sort]) as SortKey;

  return {
    ...EMPTY_FILTERS,
    brands: list(params[SEARCH_KEYS.brand]),
    weightClasses: list(params[SEARCH_KEYS.weight]).filter((v): v is WeightClass =>
      WEIGHT_CLASSES.includes(v as WeightClass),
    ),
    balanceTypes: list(params[SEARCH_KEYS.balance]).filter(
      (v): v is BalanceType => BALANCE_TYPES.includes(v as BalanceType),
    ),
    flexes: list(params[SEARCH_KEYS.flex]).filter((v): v is ShaftFlex =>
      FLEXES.includes(v as ShaftFlex),
    ),
    priceMin: number(params[SEARCH_KEYS.min]),
    priceMax: number(params[SEARCH_KEYS.max]),
    query: first(params[SEARCH_KEYS.query]),
    sort: SORTS.includes(sort) ? sort : "score",
  };
}

export function filtersToQuery(filters: CatalogFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.brands.length) query[SEARCH_KEYS.brand] = filters.brands.join(",");
  if (filters.weightClasses.length)
    query[SEARCH_KEYS.weight] = filters.weightClasses.join(",");
  if (filters.balanceTypes.length)
    query[SEARCH_KEYS.balance] = filters.balanceTypes.join(",");
  if (filters.flexes.length) query[SEARCH_KEYS.flex] = filters.flexes.join(",");
  if (filters.priceMin !== null) query[SEARCH_KEYS.min] = String(filters.priceMin);
  if (filters.priceMax !== null) query[SEARCH_KEYS.max] = String(filters.priceMax);
  if (filters.query) query[SEARCH_KEYS.query] = filters.query;
  if (filters.sort !== "score") query[SEARCH_KEYS.sort] = filters.sort;
  return query;
}

export function countActive(filters: CatalogFilters): number {
  return (
    filters.brands.length +
    filters.weightClasses.length +
    filters.balanceTypes.length +
    filters.flexes.length +
    (filters.priceMin !== null || filters.priceMax !== null ? 1 : 0) +
    (filters.query ? 1 : 0)
  );
}
