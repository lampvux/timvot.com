import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { Card, cx } from "@/components/ds/primitives";
import { BalanceMini } from "@/components/ds/data";
import { CompareToggle } from "@/components/compare-tray";
import { formatDong } from "@/lib/format";
import type { PlayStyle, RacketCardData } from "@/lib/types";

export interface RacketCardLabels {
  belowList: string;
  sellers: string;
  headLight: string;
  headHeavy: string;
  balance: string;
  flex: string;
  playStyles: Partial<Record<PlayStyle, string>>;
}

export interface RacketCardProps {
  racket: RacketCardData;
  compact?: boolean;
  density?: "default" | "catalog";
  mobileLayout?: "stacked" | "horizontal";
  /**
   * This card holds the LCP image, so start it immediately instead of waiting
   * for the lazy-loading threshold.
   *
   * At most one card per page may set it. `priority` used to be set on the
   * first four home cards and the first six catalogue cards, which inserted
   * four and six `<link rel="preload">` into the head — and preloading six
   * images is not an LCP strategy, it is six images competing at the same
   * priority so that none of them wins. On the homepage the measured LCP is
   * text, so nothing there should preload at all.
   *
   * `loading="eager"` + `fetchPriority="high"` rather than `preload`: the
   * Next.js 16 documentation's own guidance, and `priority` is deprecated in
   * favour of `preload` regardless. Eager is what removes the lazy threshold;
   * high is what puts it ahead of the fonts in the queue.
   */
  eager?: boolean;
}

/** Shared by server-rendered catalogue cards and client-fetched recommendations. */
export function RacketCardView({
  racket,
  compact,
  density = "default",
  mobileLayout = "stacked",
  eager = false,
  labels,
}: RacketCardProps & { labels: RacketCardLabels }) {
  const price = racket.lowestPrice ?? racket.msrp;
  const isBelowList = racket.lowestPrice !== null && racket.lowestPrice < racket.msrp;
  const mobileHorizontal = mobileLayout === "horizontal";
  const catalogDense = density === "catalog";
  const weightClass = [...racket.variants]
    .sort((a, b) => a.weightGrams - b.weightGrams)[0]?.weightClass;
  const styles = racket.playStyleTags.slice(0, 2);
  const hasThumb = Boolean(racket.heroThumbUrl);
  const src = racket.heroThumbUrl ?? racket.heroImageUrl;
  const specs = [weightClass, labels.balance, labels.flex].filter(Boolean) as string[];

  return (
    <Card padding="none" interactive className="flex h-full flex-col overflow-hidden">
      <Link
        href={`/rackets/${racket.brandSlug}/${racket.slug}`}
        className={cx(
          "group no-underline",
          mobileHorizontal && "flex gap-3 min-[480px]:block",
        )}
      >
        <div
          className={cx(
            "relative grid place-items-center overflow-hidden bg-sunken",
            mobileHorizontal
              ? "aspect-square w-24 shrink-0 self-start min-[480px]:w-auto min-[480px]:aspect-[1.1/1]"
              : "aspect-[1.1/1]",
          )}
        >
          <span className="font-mono text-[11px] text-[var(--text-disabled)]">
            {racket.brandName.toUpperCase()}
          </span>
          {src && (
            <Image
              src={src}
              alt=""
              fill
              loading={eager ? "eager" : "lazy"}
              fetchPriority={eager ? "high" : undefined}
              unoptimized={hasThumb}
              sizes={
                catalogDense
                  ? "(max-width: 479px) 96px, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1080px) 25vw, 17vw"
                  : "(max-width: 640px) 96px, (max-width: 1024px) 50vw, 33vw"
              }
              className="object-contain p-3 transition-transform duration-300 group-hover:scale-105"
            />
          )}

          {isBelowList && (
            <span className="absolute left-2 top-2 rounded-pill bg-[var(--signal-drop)] px-2 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-[var(--text-inverse)]">
              {labels.belowList}
            </span>
          )}

          <span className="absolute right-2 top-2 font-mono text-[11px] tabular-nums text-tertiary">
            {racket.releaseYear}
          </span>
        </div>

        <div className={cx("p-3", mobileHorizontal && "min-w-0 flex-1")}>
          <span className="block font-mono text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-brand">
            {racket.brandName}
          </span>

          <h3
            className={cx(
              "mt-0.5 font-display font-bold leading-[1.2] text-primary group-hover:text-brand",
              catalogDense ? "text-[15px]" : "text-h4",
            )}
          >
            {racket.name}
          </h3>

          {styles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {styles.map((style) => (
                <PlayStyleTag key={style} label={labels.playStyles[style] ?? style} />
              ))}
            </div>
          )}

          <div className="mt-2 font-mono text-[11px] tabular-nums text-secondary">
            {specs.join("  ·  ")}
          </div>

          <div className="mt-2.5">
            <div className="mb-1 flex justify-between font-mono text-[10px] uppercase leading-3 tracking-[0.04em] text-tertiary">
              <span>{labels.headLight}</span>
              <span>{labels.headHeavy}</span>
            </div>
            <BalanceMini
              mm={racket.balancePointMm}
              label={`${racket.balancePointMm} mm · ${labels.balance}`}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cx(
                "price text-primary",
                catalogDense ? "text-[16px]" : "text-[17px]",
              )}
            >
              {formatDong(price)}
            </span>
            {isBelowList && (
              <span className="font-mono text-[12px] tabular-nums text-tertiary line-through">
                {formatDong(racket.msrp)}
              </span>
            )}
            {!compact && (
              <span className="ml-auto font-mono text-[11px] tabular-nums text-tertiary">
                {labels.sellers}
              </span>
            )}
          </div>
        </div>
      </Link>

      <div className="mt-auto px-3 pb-3">
        <CompareToggle
          fullWidth
          shortLabel={catalogDense}
          size={catalogDense ? "sm" : "md"}
          item={{
            slug: racket.slug,
            name: racket.name,
            brand: racket.brandName,
          }}
        />
      </div>
    </Card>
  );
}

function PlayStyleTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-pill border border-line bg-sunken px-2 py-0.5 text-[11px] font-semibold leading-4 text-secondary">
      {label}
    </span>
  );
}
