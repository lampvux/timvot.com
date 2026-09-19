import type { ReactNode } from "react";
import { balancePercent, formatDelta, formatDong } from "@/lib/format";
import {
  BALANCE_MAX_MM,
  BALANCE_MIN_MM,
  EVEN_BAND_MAX_MM,
  EVEN_BAND_MIN_MM,
} from "@/lib/types";
import { Icon, cx } from "./primitives";

/* --------------------------------------------------------- Balance Ruler */

/**
 * The signature element.
 *
 * Every racket page and every comparison plots balance point on the same
 * fixed 280–305 mm rule. Balance is the single number that most determines
 * how a racket feels and the one most buyers do not understand — so it gets
 * the drawing, and the radar chart gets nothing.
 */

const EVEN_START = balancePercent(EVEN_BAND_MIN_MM);
const EVEN_WIDTH = balancePercent(EVEN_BAND_MAX_MM) - EVEN_START;

export interface BalanceMarker {
  mm: number;
  label?: string;
  emphasis?: boolean;
}

export function BalanceRuler({
  markers,
  showScale = true,
  showZones = true,
  className,
}: {
  markers: BalanceMarker[];
  showScale?: boolean;
  showZones?: boolean;
  className?: string;
}) {
  // Stagger labels so markers close together do not collide.
  const ordered = [...markers].sort((a, b) => a.mm - b.mm);
  const rows = ordered.map((marker, index) => ({
    ...marker,
    row: ordered.length > 1 ? index % 2 : 0,
    left: balancePercent(marker.mm),
  }));
  const rowCount = Math.max(...rows.map((r) => r.row)) + 1;

  return (
    <div className={className}>
      <div
        className="relative"
        style={{ height: `${20 + rowCount * 22}px` }}
        role="img"
        aria-label={markers
          .map((m) => `${m.label ? `${m.label}: ` : ""}${m.mm} mm`)
          .join(", ")}
      >
        {rows.map((marker) => (
          <div
            key={`${marker.mm}-${marker.label ?? ""}`}
            className="absolute flex -translate-x-1/2 flex-col items-center gap-1"
            style={{
              left: `${marker.left}%`,
              top: `${marker.row * 22}px`,
            }}
          >
            <span
              className={cx(
                "whitespace-nowrap font-mono text-[11px] tabular-nums",
                marker.emphasis
                  ? "font-bold text-brand"
                  : "text-secondary",
              )}
            >
              {marker.label ? `${marker.label} ` : ""}
              {marker.mm} mm
            </span>
            <span
              className="block size-0 border-x-[5px] border-t-[7px] border-x-transparent"
              style={{
                borderTopColor: marker.emphasis
                  ? "var(--green-700)"
                  : "var(--ink-700)",
              }}
            />
          </div>
        ))}

        {/* The rule itself */}
        <div className="absolute inset-x-0 bottom-[14px] h-0.5 bg-ink-200" />
        {showZones && (
          <div
            className="absolute bottom-[8px] h-3.5"
            style={{
              left: `${EVEN_START}%`,
              width: `${EVEN_WIDTH}%`,
              background: "var(--chart-band)",
            }}
          />
        )}
        {[0, EVEN_START, EVEN_START + EVEN_WIDTH, 100].map((left) => (
          <div
            key={left}
            className="absolute bottom-[8px] h-3.5 w-px bg-ink-300"
            style={{ left: `${left}%`, transform: "translateX(-0.5px)" }}
          />
        ))}

        {showScale && (
          <div className="absolute inset-x-0 bottom-0 flex justify-between font-mono text-[11px] text-tertiary tabular-nums">
            <span>{BALANCE_MIN_MM}</span>
            <span>{BALANCE_MAX_MM}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** The same rule at card scale — the motif repeats and stays informative. */
export function BalanceMini({ mm, label }: { mm: number; label?: string }) {
  return (
    <div
      className="relative h-1.5 rounded-[2px] bg-ink-100"
      role="img"
      aria-label={label ?? `Balance ${mm} mm`}
    >
      <div
        className="absolute inset-y-0"
        style={{
          left: `${EVEN_START}%`,
          width: `${EVEN_WIDTH}%`,
          background: "var(--chart-band)",
        }}
      />
      <div
        className="absolute -top-[3px] h-3 w-0.5 bg-[var(--green-700)]"
        style={{ left: `${balancePercent(mm)}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ Score bars */

/**
 * Four horizontal bars sharing a baseline, value printed at the end of each.
 * Bars, not a radar chart: bars on a shared baseline are read correctly at a
 * glance, radar charts are not.
 */
export function ScoreBars({
  axes,
  compact,
}: {
  axes: { label: string; value: number }[];
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col", compact ? "gap-2" : "gap-3")}>
      {axes.map((axis) => (
        <div
          key={axis.label}
          className="grid items-center gap-3"
          style={{ gridTemplateColumns: "78px 1fr 42px" }}
        >
          <span className="eyebrow !text-[var(--text-secondary)]">
            {axis.label}
          </span>
          <div className="h-2 rounded-[2px] bg-ink-100">
            <div
              className="h-2 rounded-[2px] bg-ink-800"
              style={{ width: `${Math.min(100, axis.value * 10)}%` }}
            />
          </div>
          <span className="font-mono text-[13px] font-medium tabular-nums text-primary">
            {axis.value.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- Price delta */

/**
 * Deltas always carry a sign, an amount and a window. Cyan means the price
 * fell — good news for a buyer. Red means it rose.
 */
export function PriceDelta({
  amount,
  period,
  size = "sm",
}: {
  amount: number;
  period: string;
  size?: "sm" | "md";
}) {
  const fell = amount < 0;
  const flat = amount === 0;

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 font-mono tabular-nums",
        size === "sm" ? "text-[12px]" : "text-[14px] font-medium",
        flat ? "text-tertiary" : fell ? "text-drop" : "text-rise",
      )}
    >
      {!flat && (
        <Icon
          name={fell ? "TrendingDown" : "TrendingUp"}
          size="sm"
          className="size-3.5"
        />
      )}
      {flat ? "±₫0" : formatDelta(amount)}
      <span className="text-tertiary">· {period}</span>
    </span>
  );
}

/* ---------------------------------------------------------- Price history */

interface PriceHistoryProps {
  data: number[];
  variant?: "spark" | "full";
  median?: number;
  height?: number;
  animate?: boolean;
  label?: string;
}

export function PriceHistory({
  data,
  variant = "spark",
  median,
  height = variant === "spark" ? 28 : 220,
  animate = variant === "full",
  label,
}: PriceHistoryProps) {
  if (data.length < 2) return null;

  const width = 600;
  const padTop = variant === "full" ? 16 : 3;
  const padBottom = variant === "full" ? 16 : 3;
  const plotHeight = height - padTop - padBottom;

  const values = median ? [...data, median] : data;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => padTop + plotHeight - ((v - min) / span) * plotHeight;

  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const area = `${line} L${width},${height - padBottom} L0,${height - padBottom} Z`;

  const last = data[data.length - 1];
  const fell = last <= data[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={
        label ??
        `Price history: ${formatDong(data[0])} to ${formatDong(last)} over the period.`
      }
    >
      {variant === "full" && (
        <>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={0}
              x2={width}
              y1={padTop + plotHeight * t}
              y2={padTop + plotHeight * t}
              stroke="var(--chart-grid)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {median !== undefined && (
            <line
              x1={0}
              x2={width}
              y1={y(median)}
              y2={y(median)}
              stroke="var(--chart-baseline)"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </>
      )}

      <path d={area} fill="var(--chart-fill)" />
      <path
        d={line}
        fill="none"
        stroke={fell ? "var(--chart-line)" : "var(--signal-rise)"}
        strokeWidth={variant === "full" ? 2 : 1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={
          animate
            ? {
                // The one indulgent animation: it shows direction of travel
                // as it draws. Collapsed to 1ms by prefers-reduced-motion.
                strokeDasharray: 2000,
                animation: "sc-draw var(--dur-chart) var(--ease-out) both",
                ["--sc-dash" as string]: "2000",
              }
            : undefined
        }
      />
      <circle
        cx={x(data.length - 1)}
        cy={y(last)}
        r={variant === "full" ? 4 : 2.5}
        fill={fell ? "var(--chart-line)" : "var(--signal-rise)"}
      />
    </svg>
  );
}

/* ------------------------------------------------------------ Spec value */

/**
 * The label/value pairing, applied consistently. Labels are eyebrow style in
 * tertiary ink; values are mono in primary ink. This one rule does more for
 * "designed rather than assembled" than anything else in the system.
 */
export function SpecRow({
  label,
  value,
  border = true,
}: {
  label: string;
  value: ReactNode;
  border?: boolean;
}) {
  return (
    // `dt`/`dd`, not two spans. Every caller wraps these in a `<dl>`, and a
    // `<dl>` whose rows are `div > span` is invalid markup — axe reports it as
    // a serious violation, and a screen reader loses the pairing between each
    // label and its value, which on /methodology is the whole content.
    <div
      className={cx(
        "flex items-baseline justify-between gap-3 py-2",
        border && "border-b border-line",
      )}
    >
      <dt className="eyebrow">{label}</dt>
      <dd className="m-0 font-mono text-[13px] tabular-nums text-primary text-right">
        {value}
      </dd>
    </div>
  );
}

/* ----------------------------------------------------------- Stock label */

/** Exact count up to 10, then "10+". Below 4, amber. Never invent scarcity. */
export function StockLabel({
  qty,
  labels,
}: {
  qty: number;
  labels: {
    inStock: (count: number) => string;
    inStockMany: string;
    left: (count: number) => string;
    outOfStock: string;
  };
}) {
  if (qty <= 0)
    return (
      <span className="font-mono text-[13px] text-tertiary">
        {labels.outOfStock}
      </span>
    );

  if (qty < 4)
    return (
      <span className="font-mono text-[13px] font-medium text-caution">
        {labels.left(qty)}
      </span>
    );

  return (
    <span className="font-mono text-[13px] text-secondary">
      {qty > 10 ? labels.inStockMany : labels.inStock(qty)}
    </span>
  );
}
