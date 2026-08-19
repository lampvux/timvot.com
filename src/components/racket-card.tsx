"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, cx } from "@/components/ds/primitives";
import { BalanceMini } from "@/components/ds/data";
import { CompareToggle } from "@/components/compare-tray";
import { BALANCE_MESSAGE_KEY, formatDong } from "@/lib/format";
import type { RacketWithMarket } from "@/lib/types";

/** The catalogue card. Every card carries the mini balance rule — the motif
 *  repeats and stays informative rather than decorative. */
export function RacketCard({
  racket,
  compact,
  mobileLayout = "stacked",
}: {
  racket: RacketWithMarket;
  compact?: boolean;
  mobileLayout?: "stacked" | "horizontal";
}) {
  const t = useTranslations("common");
  const te = useTranslations("enums");
  const tr = useTranslations("racket");

  const [imageError, setImageError] = useState(false);
  const showImage = Boolean(racket.heroImageUrl && !imageError);

  const weightClasses = [
    ...new Set(racket.variants.map((v) => v.weightClass)),
  ].join(" ");
  const gripSizes = [...new Set(racket.variants.map((v) => v.gripSize))].join(" ");
  const price = racket.lowestPrice ?? racket.msrp;
  const mobileHorizontal = mobileLayout === "horizontal";

  return (
    <Card padding="sm" interactive className="flex h-full flex-col">
      <Link
        href={`/rackets/${racket.brandSlug}/${racket.slug}`}
        className={cx(
          "group no-underline",
          mobileHorizontal && "flex gap-3.5 sm:block",
        )}
      >
        <div
          className={cx(
            "relative grid place-items-center overflow-hidden rounded-md bg-sunken",
            mobileHorizontal
              ? "aspect-square w-24 shrink-0 self-start sm:w-auto sm:aspect-[1.15/1]"
              : "aspect-[1.15/1]",
          )}
        >
          {showImage ? (
            <Image
              src={racket.heroImageUrl!}
              alt={racket.name}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-contain p-2 transition-transform duration-300 group-hover:scale-105"
              onError={() => setImageError(true)}
            />
          ) : (
            <span className="font-mono text-[11px] text-[var(--text-disabled)]">
              {racket.brandName.toUpperCase()}
            </span>
          )}
        </div>

        <div className={cx(mobileHorizontal && "min-w-0 flex-1")}>
        <div className={cx("mt-3 flex items-baseline gap-2", mobileHorizontal && "mt-0 sm:mt-3")}>
          <span className="text-caption text-tertiary">{racket.brandName}</span>
          <span
            className={cx(
              "ml-auto font-mono text-[11px] tabular-nums text-tertiary",
              mobileHorizontal && "hidden sm:inline",
            )}
          >
            {racket.releaseYear}
          </span>
        </div>

        <h3
          className={cx(
            "mt-0.5 font-display font-bold text-primary group-hover:text-brand",
            mobileHorizontal ? "text-[17px] leading-[1.2] sm:text-h4" : "text-h4",
          )}
        >
          {racket.name}
        </h3>

        <div
          className={cx(
            "mt-2.5 flex items-baseline gap-2.5",
            mobileHorizontal && "mt-1.5 sm:mt-2.5",
          )}
        >
          <span
            className={cx(
              "price text-[17px] text-primary",
              mobileHorizontal && "text-[16px] sm:text-[17px]",
            )}
          >
            {formatDong(price)}
          </span>
          {!compact && (
            <span
              className={cx(
                "font-mono text-[11px] tabular-nums text-tertiary",
                mobileHorizontal && "hidden sm:inline",
              )}
            >
              {t("sellers", { count: racket.sellerCount })}
            </span>
          )}
          {racket.courtScore === null ? (
            <span
              className="ml-auto font-mono text-[11px] text-tertiary"
              title={tr("specHalfOnly")}
            >
              {tr("specHalfOnly")}
            </span>
          ) : (
            <span className="ml-auto font-display text-[15px] font-extrabold tabular-nums text-primary">
              {racket.courtScore}
            </span>
          )}
        </div>

        <div className={cx("mt-3", mobileHorizontal && "mt-2.5 sm:mt-3")}>
          <BalanceMini
            mm={racket.balancePointMm}
            label={`${racket.balancePointMm} mm`}
          />
        </div>

        <div
          className={cx(
            "mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-tertiary",
            mobileHorizontal && "hidden sm:flex",
          )}
        >
          <span>
            {racket.balancePointMm} mm ·{" "}
            {te(BALANCE_MESSAGE_KEY[racket.balanceType]).toLowerCase()}
          </span>
          <span>
            {weightClasses} {gripSizes}
          </span>
        </div>
        {mobileHorizontal && (
          <div className="mt-1.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] tabular-nums text-tertiary sm:hidden">
            {racket.balancePointMm} mm Â· {weightClasses} {gripSizes} Â·{" "}
            {t("sellers", { count: racket.sellerCount })}
          </div>
        )}
        </div>
      </Link>

      <div className={cx("mt-3.5 pt-0.5", mobileHorizontal && "mt-3 sm:mt-3.5")}>
        <CompareToggle
          fullWidth
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
