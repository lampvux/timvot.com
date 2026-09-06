import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Card, cx } from "@/components/ds/primitives";
import { BalanceMini } from "@/components/ds/data";
import { CompareToggle } from "@/components/compare-tray";
import {
  BALANCE_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  PLAY_STYLE_MESSAGE_KEY,
  formatDong,
} from "@/lib/format";
import type { CatalogRacket, PlayStyle } from "@/lib/types";

/**
 * The catalogue card.
 *
 * Reads top to bottom the way the decision does: what it is (image, year, and a
 * sale flag if the market has moved below list), who makes it, what it is for
 * (play style), how it is built (weight, balance, flex), where it sits on the
 * balance rule, what it costs and from how many sellers, and then the one
 * action a browsing visitor takes.
 *
 * `RacketWithMarket` satisfies `CatalogRacket`, so the detail page's "similar
 * rackets" and the comparison tray pass their richer objects here unchanged
 * while the paginated catalogue passes the narrower rows it actually fetched.
 *
 * This is a server component. It used to be `"use client"` for a single
 * `useState` tracking a failed image, which meant an unfiltered catalogue
 * shipped 3.010 client component instances — the whole grid arrived twice,
 * once as HTML and once as props in the RSC payload, and then hydrated. The
 * fallback below needs no JavaScript, so only `CompareToggle` crosses the
 * boundary now.
 */
export async function RacketCard({
  racket,
  compact,
  density = "default",
  mobileLayout = "stacked",
  priority = false,
}: {
  racket: CatalogRacket;
  compact?: boolean;
  density?: "default" | "catalog";
  mobileLayout?: "stacked" | "horizontal";
  priority?: boolean;
}) {
  const t = await getTranslations("common");
  const te = await getTranslations("enums");
  const tr = await getTranslations("racket");

  const price = racket.lowestPrice ?? racket.msrp;

  /**
   * "Sale" is a fact about the market, not a marketing decision: a live offer
   * exists below the manufacturer's list price. When none does, there is no
   * badge and no struck-through number — the catalogue never invents a
   * discount, the same rule that governs stock counts.
   */
  const isBelowList = racket.lowestPrice !== null && racket.lowestPrice < racket.msrp;

  const mobileHorizontal = mobileLayout === "horizontal";
  const catalogDense = density === "catalog";

  // The lightest variant is the one quoted, matching the headline price: it is
  // the configuration most rackets are stocked in.
  const weightClass = [...racket.variants]
    .sort((a, b) => a.weightGrams - b.weightGrams)[0]?.weightClass;

  // Two tags at most. A third pushes the specs onto another line and stops the
  // grid's cards from sharing a baseline.
  const styles = racket.playStyleTags.slice(0, 2);

  // Prefer the copy the image crawler already sized for this box. Falling back
  // to the full-size original keeps rackets crawled before thumbnails existed
  // rendering, at the cost of one transformation each.
  const hasThumb = Boolean(racket.heroThumbUrl);
  const src = racket.heroThumbUrl ?? racket.heroImageUrl;

  const specs = [
    weightClass,
    te(BALANCE_MESSAGE_KEY[racket.balanceType]),
    te(FLEX_MESSAGE_KEY[racket.shaftFlex]),
  ].filter(Boolean) as string[];

  return (
    <Card
      padding="none"
      interactive
      className="flex h-full flex-col overflow-hidden"
    >
      <Link
        href={`/rackets/${racket.brandSlug}/${racket.slug}`}
        className={cx(
          "group no-underline",
          mobileHorizontal && "flex gap-3 min-[480px]:block",
        )}
      >
        {/* Image well. Sunken ground, so the frame reads as a photographed
            object rather than as part of the card's own surface. */}
        <div
          className={cx(
            "relative grid place-items-center overflow-hidden bg-sunken",
            mobileHorizontal
              ? "aspect-square w-24 shrink-0 self-start min-[480px]:w-auto min-[480px]:aspect-[1.1/1]"
              : "aspect-[1.1/1]",
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
                  ? "(max-width: 479px) 96px, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1080px) 25vw, 17vw"
                  : "(max-width: 640px) 96px, (max-width: 1024px) 50vw, 33vw"
              }
              className="object-contain p-3 transition-transform duration-300 group-hover:scale-105"
            />
          )}

          {/* Cyan, not red. The token set reserves cyan for price movement —
              `--signal-drop` is the same colour `PriceDelta` uses — and a live
              offer under list price is exactly that. Red is `--signal-risk`
              and means something a buyer should worry about. */}
          {isBelowList && (
            <span className="absolute left-2 top-2 rounded-pill bg-[var(--signal-drop)] px-2 py-0.5 text-[11px] font-bold uppercase leading-4 tracking-[0.04em] text-[var(--text-inverse)]">
              {t("belowList")}
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
                <PlayStyleTag key={style} style={style} label={te(PLAY_STYLE_MESSAGE_KEY[style])} />
              ))}
            </div>
          )}

          {/* Weight · balance · flex, mono because they are values. Middle dots
              rather than a table: three short facts read faster in a row. */}
          <div className="mt-2 font-mono text-[11px] tabular-nums text-secondary">
            {specs.join("  ·  ")}
          </div>

          {/* The Balance Ruler at card scale. Every card plots on the same fixed
              280–305 mm rule, so two cards side by side are directly
              comparable — that is the motif's whole job. */}
          <div className="mt-2.5">
            <div className="mb-1 flex justify-between font-mono text-[10px] uppercase leading-3 tracking-[0.04em] text-tertiary">
              <span>{tr("headLight")}</span>
              <span>{tr("headHeavy")}</span>
            </div>
            <BalanceMini
              mm={racket.balancePointMm}
              label={`${racket.balancePointMm} mm · ${te(
                BALANCE_MESSAGE_KEY[racket.balanceType],
              )}`}
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
                {t("sellers", { count: racket.sellerCount })}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Pushed to the bottom so the button sits on one line across the row
          however tall the names above it run — Vietnamese model names wrap
          where English ones do not. */}
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

/**
 * Play style as a pill.
 *
 * The reference design tints these blue, violet and red per style. Those
 * colours are not in the token set, and adding them would break the rule the
 * rest of the product is built on: colour carries meaning, and green, cyan and
 * amber already mean action, live price movement and low stock. A tint that
 * only said "this racket is for control" would spend the vocabulary on
 * decoration, and the next amber pill would be ambiguous.
 *
 * So every style gets the neutral treatment the reference already uses for
 * "All-Round", and the word does the work — which is what a screenshot pasted
 * into a Facebook buying group survives anyway. A dedicated play-style ramp can
 * be added to `globals.css` if the tint is worth a token.
 */
function PlayStyleTag({ label }: { style: PlayStyle; label: string }) {
  return (
    <span className="inline-flex items-center rounded-pill border border-line bg-sunken px-2 py-0.5 text-[11px] font-semibold leading-4 text-secondary">
      {label}
    </span>
  );
}
