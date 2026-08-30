"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button, Eyebrow, Icon, cx } from "@/components/ds/primitives";
import { Checkbox, Input, Select } from "@/components/ds/forms";
import { BALANCE_MESSAGE_KEY, FLEX_MESSAGE_KEY, formatDong } from "@/lib/format";
import { filtersToQuery, countActive } from "@/lib/filters";
import type {
  BalanceType,
  Brand,
  CatalogFilters,
  ShaftFlex,
  SortKey,
  WeightClass,
} from "@/lib/types";
import { balancePercent } from "@/lib/format";
import { EVEN_BAND_MAX_MM, EVEN_BAND_MIN_MM } from "@/lib/types";
import { beginNavigation } from "@/components/navigation-progress";

export interface FacetCounts {
  brands: Record<string, number>;
  weightClasses: Record<string, number>;
  balanceTypes: Record<string, number>;
  flexes: Record<string, number>;
}

const WEIGHT_CLASSES: WeightClass[] = ["2U", "3U", "4U", "5U"];
const BALANCE_TYPES: BalanceType[] = ["head-light", "even", "head-heavy"];
const FLEXES: ShaftFlex[] = ["extra-stiff", "stiff", "medium", "flexible"];

/**
 * Left rail on desktop, bottom sheet on mobile. The result count updates
 * live, and every change is a URL change so the view stays shareable.
 */
export interface FilterProps {
  filters: CatalogFilters;
  facets: FacetCounts;
  brands: Brand[];
  resultCount: number;
}

function useFilterBody({ filters, facets, brands }: FilterProps) {
  const t = useTranslations("common");
  const ts = useTranslations("specs");
  const te = useTranslations("enums");
  const tc = useTranslations("catalog");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const push = (next: CatalogFilters) => {
    beginNavigation();
    startTransition(() => {
      router.replace({ pathname: "/rackets", query: filtersToQuery(next) }, { scroll: false });
    });
  };

  const toggle = <T extends string>(
    key: keyof CatalogFilters,
    current: T[],
    value: T,
  ) => {
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    push({ ...filters, [key]: next });
  };

  return (
    <div className={cx("flex flex-col", pending && "opacity-70")}>
      <div className="mb-4 flex items-baseline gap-2">
        <Eyebrow as="h2">{t("filters")}</Eyebrow>
        {countActive(filters) > 0 && (
          <button
            onClick={() =>
              push({ ...filters, brands: [], weightClasses: [], balanceTypes: [], flexes: [], priceMin: null, priceMax: null })
            }
            className="ml-auto cursor-pointer text-[12px] font-semibold text-brand"
          >
            {t("clearAll")}
          </button>
        )}
      </div>

      {/* Brand */}
      <fieldset className="border-b border-line pb-4">
        <legend className="mb-2.5 text-body-sm font-semibold text-primary">
          {ts("brand")}
        </legend>
        <div className="flex flex-col gap-2">
          {brands.map((brand) => (
            <Checkbox
              key={brand.slug}
              label={brand.name}
              count={facets.brands[brand.slug] ?? 0}
              checked={filters.brands.includes(brand.slug)}
              onChange={() => toggle("brands", filters.brands, brand.slug)}
            />
          ))}
        </div>
      </fieldset>

      {/* Weight — spec codes as the manufacturer writes them, in mono */}
      <fieldset className="border-b border-line py-4">
        <legend className="mb-2.5 text-body-sm font-semibold text-primary">
          {ts("weight")}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {WEIGHT_CLASSES.map((weightClass) => {
            const active = filters.weightClasses.includes(weightClass);
            const count = facets.weightClasses[weightClass] ?? 0;
            return (
              <button
                key={weightClass}
                disabled={count === 0 && !active}
                onClick={() =>
                  toggle("weightClasses", filters.weightClasses, weightClass)
                }
                aria-pressed={active}
                className={cx(
                  "h-11 min-w-[52px] cursor-pointer rounded-pill border px-2.5 font-mono text-[12px] tabular-nums lg:h-[26px]",
                  "transition-colors duration-[90ms] ease-out disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "border-line-brand bg-brand-soft text-brand"
                    : "border-line bg-card text-secondary hover:border-line-strong",
                )}
              >
                {weightClass}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Balance — the rail carries the same 280–305 rule as everywhere else */}
      <fieldset className="border-b border-line py-4">
        <legend className="mb-2.5 text-body-sm font-semibold text-primary">
          {ts("balance")}
        </legend>
        <div className="relative mb-2.5 h-1.5 rounded-[2px] bg-ink-100">
          <div
            className="absolute inset-y-0"
            style={{
              left: `${balancePercent(EVEN_BAND_MIN_MM)}%`,
              width: `${balancePercent(EVEN_BAND_MAX_MM) - balancePercent(EVEN_BAND_MIN_MM)}%`,
              background: "var(--chart-band)",
            }}
          />
        </div>
        <div className="mb-2.5 flex justify-between font-mono text-[11px] tabular-nums text-tertiary">
          <span>280</span>
          <span>305 mm</span>
        </div>
        <div className="flex flex-col gap-2">
          {BALANCE_TYPES.map((balanceType) => (
            <Checkbox
              key={balanceType}
              label={te(BALANCE_MESSAGE_KEY[balanceType])}
              count={facets.balanceTypes[balanceType] ?? 0}
              checked={filters.balanceTypes.includes(balanceType)}
              onChange={() =>
                toggle("balanceTypes", filters.balanceTypes, balanceType)
              }
            />
          ))}
        </div>
      </fieldset>

      {/* Price */}
      <fieldset className="border-b border-line py-4">
        <legend className="mb-2.5 text-body-sm font-semibold text-primary">
          {ts("price")}
        </legend>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            push({
              ...filters,
              priceMin: Number(String(data.get("min")).replace(/\D/g, "")) || null,
              priceMax: Number(String(data.get("max")).replace(/\D/g, "")) || null,
            });
          }}
        >
          <Input
            name="min"
            size="sm"
            mono
            prefix="₫"
            inputMode="numeric"
            aria-label={`${ts("price")} min`}
            defaultValue={
              filters.priceMin ? formatDong(filters.priceMin).slice(1) : ""
            }
          />
          <span className="text-[var(--text-disabled)]">–</span>
          <Input
            name="max"
            size="sm"
            mono
            prefix="₫"
            inputMode="numeric"
            aria-label={`${ts("price")} max`}
            defaultValue={
              filters.priceMax ? formatDong(filters.priceMax).slice(1) : ""
            }
          />
          <button
            type="submit"
            aria-label={t("apply")}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md border border-line-strong bg-card text-secondary hover:bg-sunken lg:size-7"
          >
            <Icon name="ArrowRight" size="sm" />
          </button>
        </form>
      </fieldset>

      {/* Shaft flex */}
      <fieldset className="py-4">
        <legend className="mb-2.5 text-body-sm font-semibold text-primary">
          {ts("shaftFlex")}
        </legend>
        <div className="flex flex-col gap-2">
          {FLEXES.map((flex) => (
            <Checkbox
              key={flex}
              label={te(FLEX_MESSAGE_KEY[flex])}
              count={facets.flexes[flex] ?? 0}
              checked={filters.flexes.includes(flex)}
              onChange={() => toggle("flexes", filters.flexes, flex)}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** Left rail, desktop only. */
export function FilterRail(props: FilterProps) {
  const body = useFilterBody(props);
  return (
    <aside className="hidden w-[var(--filter-rail-w)] shrink-0 self-stretch border-r border-line bg-card px-5 pb-10 pt-5 lg:block">
      {body}
    </aside>
  );
}

/** Bottom sheet, mobile only — not a page takeover. */
export function FilterSheet(props: FilterProps) {
  const t = useTranslations("common");
  const tc = useTranslations("catalog");
  const [open, setOpen] = useState(false);
  const body = useFilterBody(props);
  const active = countActive(props.filters);

  return (
    <div className="lg:hidden">
      <Button
        iconLeft="SlidersHorizontal"
        onClick={() => setOpen(true)}
        aria-expanded={open}
      >
        {t("filters")}
        {active > 0 && ` (${active})`}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[500] flex flex-col justify-end">
          <button
            aria-label={t("back")}
            className="absolute inset-0 bg-[var(--surface-overlay)]"
            onClick={() => setOpen(false)}
          />
          <div className="relative max-h-[82dvh] overflow-y-auto rounded-t-xl bg-card px-4 pb-4 pt-5 shadow-3">
            {body}
            <div className="sticky bottom-0 -mx-4 mt-2 border-t border-line bg-card px-4 pt-3">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => setOpen(false)}
              >
                {tc("resultCount", { count: props.resultCount })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Active filters as removable pills above the results. */
export function ActiveFilterPills({
  filters,
  brands,
}: {
  filters: CatalogFilters;
  brands: Brand[];
}) {
  const t = useTranslations("common");
  const te = useTranslations("enums");
  const router = useRouter();
  const [, startTransition] = useTransition();

  const push = (next: CatalogFilters) =>
    startTransition(() => {
      beginNavigation();
      router.replace({ pathname: "/rackets", query: filtersToQuery(next) }, { scroll: false });
    });

  const pills: { key: string; label: string; onRemove: () => void; mono?: boolean }[] =
    [
      ...filters.brands.map((slug) => ({
        key: `brand-${slug}`,
        label: brands.find((b) => b.slug === slug)?.name ?? slug,
        onRemove: () =>
          push({ ...filters, brands: filters.brands.filter((b) => b !== slug) }),
      })),
      ...filters.weightClasses.map((weightClass) => ({
        key: `weight-${weightClass}`,
        label: weightClass,
        mono: true,
        onRemove: () =>
          push({
            ...filters,
            weightClasses: filters.weightClasses.filter((w) => w !== weightClass),
          }),
      })),
      ...filters.balanceTypes.map((balanceType) => ({
        key: `balance-${balanceType}`,
        label: te(BALANCE_MESSAGE_KEY[balanceType]),
        onRemove: () =>
          push({
            ...filters,
            balanceTypes: filters.balanceTypes.filter((b) => b !== balanceType),
          }),
      })),
      ...filters.flexes.map((flex) => ({
        key: `flex-${flex}`,
        label: te(FLEX_MESSAGE_KEY[flex]),
        onRemove: () =>
          push({ ...filters, flexes: filters.flexes.filter((f) => f !== flex) }),
      })),
    ];

  if (filters.priceMin !== null || filters.priceMax !== null) {
    pills.push({
      key: "price",
      mono: true,
      label: `${filters.priceMin ? formatDong(filters.priceMin) : "₫0"} – ${
        filters.priceMax ? formatDong(filters.priceMax) : "∞"
      }`,
      onRemove: () => push({ ...filters, priceMin: null, priceMax: null }),
    });
  }

  if (filters.query) {
    pills.push({
      key: "query",
      label: `"${filters.query}"`,
      onRemove: () => push({ ...filters, query: "" }),
    });
  }

  if (pills.length === 0) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-5">
      {pills.map((pill) => (
        <button
          key={pill.key}
          onClick={pill.onRemove}
          className={cx(
            "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-pill border border-line-brand lg:h-[26px]",
            "bg-brand-soft pl-2.5 pr-1.5 text-[12px] text-brand transition-colors duration-[90ms] hover:bg-green-100",
            pill.mono && "font-mono tabular-nums",
          )}
        >
          {pill.label}
          <Icon name="X" size="sm" className="size-3.5" />
        </button>
      ))}
      <button
        onClick={() =>
          push({
            ...filters,
            brands: [],
            weightClasses: [],
            balanceTypes: [],
            flexes: [],
            priceMin: null,
            priceMax: null,
            query: "",
          })
        }
        className="ml-1 cursor-pointer text-[12.5px] font-semibold text-brand"
      >
        {t("clearAll")}
      </button>
    </div>
  );
}

export function SortSelect({ filters }: { filters: CatalogFilters }) {
  const t = useTranslations("common");
  const tc = useTranslations("catalog");
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2.5">
      <span className="hidden text-body-sm text-secondary sm:inline">
        {t("sort")}
      </span>
      <div className="w-[190px]">
        <Select
          size="sm"
          value={filters.sort}
          onChange={(event) =>
            startTransition(() => {
              beginNavigation();
              router.replace(
                {
                  pathname: "/rackets",
                  query: filtersToQuery({
                    ...filters,
                    sort: event.target.value as SortKey,
                  }),
                },
                { scroll: false },
              );
            })
          }
          options={[
            { value: "score", label: tc("sortScore") },
            { value: "price-asc", label: tc("sortPriceAsc") },
            { value: "price-desc", label: tc("sortPriceDesc") },
            { value: "new", label: tc("sortNewest") },
          ]}
        />
      </div>
    </label>
  );
}
