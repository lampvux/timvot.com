"use client";

import { useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Checkbox } from "@/components/ds/forms";
import { Eyebrow, cx } from "@/components/ds/primitives";

export interface CompareColumn {
  id: string;
  brandName: string;
  name: string;
  price: string;
  meta: string;
  href: string;
}

export interface CompareRow {
  key: string;
  label: string;
  kind: "text" | "bar";
  /** null when the row is not a fair contest (grip sizes, materials). */
  higherIsBetter: boolean | null;
  values: { display: string; numeric: number | null }[];
}

/**
 * Difference over completeness.
 *
 * Identical values recede to tertiary ink; differing values keep full
 * contrast. The best value in a numeric row gets a ▲ glyph — never a colour
 * fill, because colour alone does not survive a screenshot, and screenshots
 * of this table are the whole point.
 */
export function CompareTable({
  columns,
  rows,
}: {
  columns: CompareColumn[];
  rows: CompareRow[];
}) {
  const t = useTranslations("compare");
  const [differencesOnly, setDifferencesOnly] = useState(true);

  const gridStyle = {
    "--compare-column-count": columns.length,
  } as CSSProperties;

  const isIdentical = (row: CompareRow) =>
    new Set(row.values.map((v) => v.display)).size === 1;

  const winnerIndex = (row: CompareRow): number | null => {
    if (row.higherIsBetter === null) return null;
    const numeric = row.values.map((v) => v.numeric);
    if (numeric.some((n) => n === null)) return null;
    const values = numeric as number[];
    const best = row.higherIsBetter ? Math.max(...values) : Math.min(...values);
    // A tie has no winner — marking two cells "best" is worse than marking none.
    if (values.filter((v) => v === best).length > 1) return null;
    return values.indexOf(best);
  };

  const visible = differencesOnly ? rows.filter((row) => !isIdentical(row)) : rows;

  return (
    <>
      <div className="mb-4">
        <Checkbox
          label={t("differencesOnly")}
          checked={differencesOnly}
          onChange={(event) => setDifferencesOnly(event.target.checked)}
        />
      </div>

      {/* Horizontal scroll on mobile with the attribute column frozen. */}
      <div className="-mx-4 overflow-x-auto border-y border-line bg-card sm:mx-0 sm:rounded-md sm:border">
        <div style={{ minWidth: `${96 + columns.length * 128}px` }}>
          <div
            className="compare-grid grid border-b border-line-strong"
            style={gridStyle}
          >
            <div className="sticky left-0 z-[2] bg-card px-2.5 py-3 sm:p-4" />
            {columns.map((column) => (
              <div key={column.id} className="border-l border-line px-2.5 py-3 sm:p-4">
                <div className="mb-2 aspect-[1.4/1] rounded-md bg-sunken sm:mb-3 sm:aspect-[1.6/1]" />
                <div className="hidden text-caption text-tertiary sm:block">
                  {column.brandName}
                </div>
                <Link
                  href={column.href}
                  className="block font-display text-[13px] font-bold leading-[1.3] text-primary no-underline hover:text-brand sm:text-[17px] sm:leading-tight lg:text-[19px]"
                >
                  {column.name}
                </Link>
                <div className="price mt-1 text-[12px] text-primary sm:mt-2 sm:text-[17px]">
                  {column.price}
                </div>
                <div className="hidden font-mono text-[11px] tabular-nums text-tertiary sm:block">
                  {column.meta}
                </div>
              </div>
            ))}
          </div>

          {visible.map((row) => {
            const identical = isIdentical(row);
            const winner = winnerIndex(row);

            return (
              <div
                key={row.key}
                className={cx(
                  "compare-grid grid items-center border-b border-line last:border-0",
                  identical ? "bg-sunken" : "bg-card",
                )}
                style={gridStyle}
              >
                <div
                  className={cx(
                    "sticky left-0 z-[2] px-2.5 py-2.5 sm:px-4",
                    identical ? "bg-sunken" : "bg-card",
                  )}
                >
                  <Eyebrow
                    className={identical ? undefined : "!text-[var(--text-secondary)]"}
                  >
                    {row.label}
                  </Eyebrow>
                </div>

                {row.values.map((value, index) => (
                  <div
                    key={index}
                    className="border-l border-line px-2.5 py-2.5 sm:px-4"
                    aria-label={`${row.label}: ${value.display}`}
                  >
                    {row.kind === "bar" && value.numeric !== null ? (
                      <div className="flex items-center gap-1.5 sm:gap-2.5">
                        <div className="h-2 flex-1 rounded-[2px] bg-ink-100">
                          <div
                            className="h-2 rounded-[2px] bg-ink-800"
                            style={{ width: `${Math.min(100, value.numeric * 10)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[12px] tabular-nums text-primary sm:text-[13px]">
                          {value.display}
                          {winner === index && (
                            <span className="ml-1" title={t("bestInRow")}>
                              ▲
                            </span>
                          )}
                        </span>
                      </div>
                    ) : (
                      <span
                        className={cx(
                          "font-mono text-[12px] tabular-nums sm:text-[13px]",
                          identical ? "text-tertiary" : "text-primary",
                        )}
                      >
                        {value.display}
                        {winner === index && (
                          <span className="ml-1.5" title={t("bestInRow")}>
                            ▲
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {visible.length === 0 && (
            <p className="px-4 py-6 text-center text-body-sm text-tertiary">
              {t("identical")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
