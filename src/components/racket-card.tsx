import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card, cx } from "@/components/ds/primitives";
import { BalanceMini } from "@/components/ds/data";
import { CompareToggle } from "@/components/compare-tray";
import { BALANCE_MESSAGE_KEY, formatDong } from "@/lib/format";
import type { RacketWithMarket } from "@/lib/types";

/** The catalogue card. Every card carries the mini balance rule — the motif
 *  repeats and stays informative rather than decorative.
 *
 *  This is a server component. It used to be `"use client"` for a single
 *  `useState` tracking a failed image, which meant an unfiltered catalogue
 *  shipped 3.010 client component instances — the whole grid arrived twice,
 *  once as HTML and once as props in the RSC payload, and then hydrated. The
 *  fallback below needs no JavaScript, so only `CompareToggle` crosses the
 *  boundary now. */
export async function RacketCard({
  racket,
  compact,
  density = "default",
  mobileLayout = "stacked",
  priority = false,
}: {
  racket: RacketWithMarket;
  compact?: boolean;
  density?: "default" | "catalog";
  mobileLayout?: "stacked" | "horizontal";
  priority?: boolean;
}) {
  const t = await getTranslations("common");
  const te = await getTranslations("enums");
  const tr = await getTranslations("racket");

  const weightClasses = [
    ...new Set(racket.variants.map((v) => v.weightClass)),
  ].join(" ");
  const gripSizes = [...new Set(racket.variants.map((v) => v.gripSize))].join(" ");
  const price = racket.lowestPrice ?? racket.msrp;
  const mobileHorizontal = mobileLayout === "horizontal";
  const catalogDense = density === "catalog";

  // Prefer the copy the image crawler already sized for this box. Falling back
  // to the full-size original keeps rackets crawled before thumbnails existed
  // rendering, at the cost of one transformation each.
  const hasThumb = Boolean(racket.heroThumbUrl);
  const src = racket.heroThumbUrl ?? racket.heroImageUrl;

  return (
    <Card
      padding={catalogDense ? "none" : "sm"}
      interactive
      className={cx("flex h-full flex-col", catalogDense && "p-2")}
    >
      <Link
        href={`/rackets/${racket.brandSlug}/${racket.slug}`}
        className={cx(
          "group no-underline",
          mobileHorizontal &&
            (catalogDense
              ? "flex gap-3 min-[480px]:block"
              : "flex gap-3.5 sm:block"),
        )}
      >
        <div
          className={cx(
            "relative grid place-items-center overflow-hidden rounded-md bg-sunken",
            mobileHorizontal
              ? catalogDense
                ? "aspect-square w-20 shrink-0 self-start min-[480px]:w-auto min-[480px]:aspect-[1.05/1]"
                : "aspect-square w-24 shrink-0 self-start sm:w-auto sm:aspect-[1.15/1]"
              : catalogDense
                ? "aspect-[1.05/1]"
                : "aspect-[1.15/1]",
          )}
        >
          {/* The fallback sits underneath rather than behind a state flag. A
              missing or broken file simply reveals it — no `onError`, and so
              no reason for this component to run in the browser. The image
              carries an empty alt because the heading below is the accessible
              name; that also means a failed load collapses silently instead of
              painting a broken-image glyph over the brand mark. */}
          <span className="font-mono text-[11px] text-[var(--text-disabled)]">
            {racket.brandName.toUpperCase()}
          </span>
          {src && (
            <Image
              src={src}
              alt=""
              fill
              priority={priority}
              /* A crawled thumbnail is already ~400px webp, so there is nothing
                 left for the optimizer to do — and every transformation it
                 skips is one back inside Vercel Hobby's 5.000 a month. Rackets
                 crawled before thumbnails existed still go through it. */
              unoptimized={hasThumb}
              sizes={
                catalogDense
                  ? "(max-width: 479px) 80px, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1080px) 25vw, 17vw"
                  : "(max-width: 640px) 96px, (max-width: 1024px) 50vw, 33vw"
              }
              className={cx(
                "object-contain transition-transform duration-300 group-hover:scale-105",
                catalogDense ? "p-1.5" : "p-2",
              )}
            />
          )}
        </div>

        <div className={cx(mobileHorizontal && "min-w-0 flex-1")}>
        <div
          className={cx(
            "flex items-baseline gap-2",
            catalogDense ? "mt-2" : "mt-3",
            mobileHorizontal &&
              (catalogDense ? "mt-0 min-[480px]:mt-2" : "mt-0 sm:mt-3"),
          )}
        >
          <span className="text-caption text-tertiary">{racket.brandName}</span>
          <span
            className={cx(
              "ml-auto font-mono text-[11px] tabular-nums text-tertiary",
              mobileHorizontal &&
                (catalogDense ? "hidden min-[480px]:inline" : "hidden sm:inline"),
            )}
          >
            {racket.releaseYear}
          </span>
        </div>

        <h3
          className={cx(
            "mt-0.5 font-display font-bold text-primary group-hover:text-brand",
            catalogDense
              ? "text-[14px] leading-[1.25] min-[480px]:min-h-[38px] min-[480px]:text-[15px]"
              : mobileHorizontal
                ? "text-[17px] leading-[1.2] sm:text-h4"
                : "text-h4",
          )}
        >
          {racket.name}
        </h3>

        <div
          className={cx(
            "flex items-baseline",
            catalogDense ? "mt-1.5 gap-1.5" : "mt-2.5 gap-2.5",
            mobileHorizontal &&
              (catalogDense ? "mt-1 min-[480px]:mt-1.5" : "mt-1.5 sm:mt-2.5"),
          )}
        >
          <span
            className={cx(
              "price text-primary",
              catalogDense
                ? "text-[14px] min-[480px]:text-[15px]"
                : mobileHorizontal
                  ? "text-[16px] sm:text-[17px]"
                  : "text-[17px]",
            )}
          >
            {formatDong(price)}
          </span>
          {!compact && !catalogDense && (
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
              {catalogDense ? "—" : tr("specHalfOnly")}
            </span>
          ) : (
            <span className="ml-auto font-display text-[15px] font-extrabold tabular-nums text-primary">
              {racket.courtScore}
            </span>
          )}
        </div>

        <div
          className={cx(
            catalogDense ? "mt-2" : "mt-3",
            mobileHorizontal &&
              (catalogDense ? "mt-2 min-[480px]:mt-2" : "mt-2.5 sm:mt-3"),
          )}
        >
          <BalanceMini
            mm={racket.balancePointMm}
            label={`${racket.balancePointMm} mm`}
          />
        </div>

        <div
          className={cx(
            "mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-tertiary",
            (mobileHorizontal || catalogDense) && "hidden sm:flex",
            catalogDense && "!hidden",
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
        {mobileHorizontal && !catalogDense && (
          <div className="mt-1.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] tabular-nums text-tertiary sm:hidden">
            {racket.balancePointMm} mm · {weightClasses} {gripSizes} ·{" "}
            {t("sellers", { count: racket.sellerCount })}
          </div>
        )}
        </div>
      </Link>

      <div
        className={cx(
          "pt-0.5",
          catalogDense ? "mt-2" : "mt-3.5",
          mobileHorizontal && !catalogDense && "mt-3 sm:mt-3.5",
        )}
      >
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
