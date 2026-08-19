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
} as const;

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
