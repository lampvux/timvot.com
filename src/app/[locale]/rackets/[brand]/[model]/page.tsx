import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  Badge,
  ButtonLinkStyle,
  Card,
  EmptyState,
  Eyebrow,
  Icon,
  Tag,
  TrustBadge,
} from "@/components/ds/primitives";
import {
  BalanceRuler,
  PriceDelta,
  PriceHistory,
  ScoreBars,
  StockLabel,
} from "@/components/ds/data";
import { SpecSheet } from "@/components/spec-sheet";
import { CompareToggle } from "@/components/compare-tray";
import { WatchPriceSlot } from "@/components/watch-price-slot";
import { RacketGallery } from "@/components/racket-gallery";
import {
  getHeadlineVariantPrice,
  getOffersForRacket,
  getRacket,
  getRackets,
  getReviewsForRacket,
} from "@/lib/data/repository";
import { MIN_REVIEWS_FOR_PLAYER_SCORE } from "@/lib/court-score";
import { ReviewDate } from "@/components/review-date";
import {
  BALANCE_MESSAGE_KEY,
  CONDITION_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  formatDong,
  formatTension,
} from "@/lib/format";
import { EVEN_BAND_MAX_MM, EVEN_BAND_MIN_MM } from "@/lib/types";
import type { Review, SellerTier } from "@/lib/types";

/**
 * Prerender the rackets people actually open, and let ISR fill in the rest.
 *
 * 3.010 rackets across two locales is 6.020 pages, which is both a long build
 * and a lot of output for pages nobody may request. The ISR guidance is to
 * prerender a popular subset and generate the others on first visit — with
 * Cache Components a path not listed here still serves an App Shell instantly
 * and upgrades in the background, so the tail is not a slow page, just a
 * slightly later one.
 *
 * Court Score order rather than source order: a racket with a real player
 * score is one people have reviewed, which is a better proxy for "someone will
 * open this" than wherever the scraper happened to put it. Returning an empty
 * array is not an option under Cache Components — it raises
 * `empty-generate-static-params`.
 */
/**
 * Held down by the builder, not by taste.
 *
 * Static generation accumulates memory per page and does not give it back, and
 * Vercel's Hobby builder runs it in **one worker** — the build log says
 * `Generating static pages using 1 worker`. At 200 rackets (475 pages) it dies
 * around page 53 with `JavaScript heap out of memory`. Reproduced locally with
 * `experimental.cpus: 1`: same crash, ~146 pages in.
 *
 * The ceiling is roughly 145 pages on one worker. This route contributes
 * `2 × PRERENDERED_RACKETS` (one per locale) and the rest of the app about 75,
 * so 30 gives 135 with a little headroom. Locally, with fifteen workers each
 * taking a thirtieth of the pages, 475 builds fine — which is exactly why this
 * passed here and failed there.
 *
 * Raising `NODE_OPTIONS=--max-old-space-size` does **not** help: it does not
 * reach the static-generation worker. A 6 GB parent heap crashed at the same
 * page count as the default.
 *
 * Nothing is lost from the catalogue by this. Under Cache Components a path not
 * listed here still serves an App Shell instantly and upgrades in the
 * background — the tail is a slightly later page, not a missing one.
 *
 * Raise this only alongside more build workers (a Pro build machine, or
 * building in CI) or a fix for the per-page accumulation. See
 * `docs/performance-plan.md`.
 */
const PRERENDERED_RACKETS = 30;

export async function generateStaticParams() {
  const rackets = await getRackets();
  return [...rackets]
    .sort(
      (a, b) =>
        (b.courtScore ?? -1) - (a.courtScore ?? -1) || b.specScore - a.specScore,
    )
    .slice(0, PRERENDERED_RACKETS)
    .map((racket) => ({
      brand: racket.brandSlug,
      model: racket.slug,
    }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; brand: string; model: string }>;
}): Promise<Metadata> {
  const { locale, brand, model } = await params;
  const racket = await getRacket(brand, model);
  if (!racket) return {};
  return {
    title: `${racket.name} — ${racket.brandName}`,
    description: racket.summary[locale],
  };
}

const TIER_STATE: Record<SellerTier, "verified" | "authorised" | "unverified"> = {
  authorised: "authorised",
  verified: "verified",
  new: "unverified",
};

export default async function RacketPage({
  params,
}: {
  params: Promise<{ locale: Locale; brand: string; model: string }>;
}) {
  const { locale, brand, model } = await params;
  setRequestLocale(locale);

  const racket = await getRacket(brand, model);
  if (!racket) notFound();

  const t = await getTranslations("racket");
  const tc = await getTranslations("common");
  const ts = await getTranslations("specs");
  const te = await getTranslations("enums");
  const tk = await getTranslations("stock");
  const tsel = await getTranslations("sellers");
  const tn = await getTranslations("nav");

  // `getUser()` used to be in here, which made a spec sheet wait on a Supabase
  // Auth round-trip. It lives in <WatchPriceSlot /> now, behind Suspense.
  const [offers, reviews, price, allRackets] = await Promise.all([
    getOffersForRacket(racket.id),
    getReviewsForRacket(racket.id),
    getHeadlineVariantPrice(racket),
    getRackets(),
  ]);

  const inStock = offers.filter((offer) => offer.qtyAvailable > 0);
  const lowestOffer = inStock[0];
  const headlineVariant = price
    ? racket.variants.find((v) => v.id === price.variantId)
    : racket.variants[0];
  const variantCode = headlineVariant
    ? `${headlineVariant.weightClass} ${headlineVariant.gripSize}`
    : "";

  const weightClasses = [...new Set(racket.variants.map((v) => v.weightClass))];
  const gripSizes = [...new Set(racket.variants.map((v) => v.gripSize))];
  const referenceGrams =
    [...racket.variants].sort((a, b) => a.weightGrams - b.weightGrams)[0]
      ?.weightGrams ?? 0;

  const axes = [
    { label: t("power"), value: racket.spec.power },
    { label: t("speed"), value: racket.spec.speed },
    { label: t("control"), value: racket.spec.control },
    { label: t("comfort"), value: racket.spec.comfort },
  ];
  const shownAxes = racket.player
    ? [
        { label: t("power"), value: (racket.spec.power + racket.player.power) / 2 },
        { label: t("speed"), value: (racket.spec.speed + racket.player.speed) / 2 },
        {
          label: t("control"),
          value: (racket.spec.control + racket.player.control) / 2,
        },
        {
          label: t("comfort"),
          value: (racket.spec.comfort + racket.player.comfort) / 2,
        },
      ]
    : axes;

  const keySpecs = [
    {
      label: ts("weight"),
      value: `${weightClasses.join(" · ")} · ${referenceGrams} g`,
    },
    { label: ts("balance"), value: `${racket.balancePointMm} mm` },
    { label: ts("shaftFlex"), value: te(FLEX_MESSAGE_KEY[racket.shaftFlex]) },
    {
      label: ts("shaftDiameter"),
      value: `${racket.shaftDiameterMm.toFixed(1)} mm`,
    },
    { label: ts("maxTension"), value: formatTension(racket.maxTensionLbs) },
    { label: ts("grip"), value: gripSizes.join(" · ") },
    {
      label: ts("frameShape"),
      value: te(
        racket.frameShape === "isometric"
          ? "frameIsometric"
          : racket.frameShape === "conventional"
            ? "frameConventional"
            : "frameAeroBox",
      ),
    },
    { label: ts("released"), value: String(racket.releaseYear) },
  ];

  const extraSpecs = [
    { label: ts("balanceType"), value: te(BALANCE_MESSAGE_KEY[racket.balanceType]) },
    { label: ts("length"), value: `${racket.lengthMm} mm` },
    { label: ts("stringPattern"), value: racket.stringPattern },
    { label: ts("frameMaterial"), value: racket.frameMaterial.join(" · ") },
    { label: ts("msrp"), value: formatDong(racket.msrp) },
    {
      label: ts("skillLevel"),
      value: te(
        racket.skillLevel === "beginner"
          ? "skillBeginner"
          : racket.skillLevel === "intermediate"
            ? "skillIntermediate"
            : "skillAdvanced",
      ),
    },
    {
      label: ts("playStyle"),
      value: racket.playStyleTags
        .map((tag) =>
          te(
            tag === "attack"
              ? "styleAttack"
              : tag === "all-round"
                ? "styleAllRound"
                : tag === "speed"
                  ? "styleSpeed"
                  : tag === "defence"
                    ? "styleDefence"
                    : "styleControl",
          ),
        )
        .join(" · "),
    },
    {
      label: ts("courtScore"),
      value:
        racket.courtScore === null
          ? `${racket.specScore} / 100 · ${t("specHalfOnly").toLowerCase()}`
          : `${racket.courtScore} / 100`,
    },
    { label: ts("variant"), value: `${racket.variants.length}` },
  ];

  /** Reads the balance number back in a sentence, because most buyers do not
   *  know what 298 mm means. */
  const balanceReading =
    racket.balanceType === "head-heavy"
      ? t("balanceReadingHeadHeavy", {
          mm: racket.balancePointMm,
          delta: racket.balancePointMm - EVEN_BAND_MAX_MM,
        })
      : racket.balanceType === "head-light"
        ? t("balanceReadingHeadLight", {
            mm: racket.balancePointMm,
            delta: EVEN_BAND_MIN_MM - racket.balancePointMm,
          })
        : t("balanceReadingEven", { mm: racket.balancePointMm });

  const similar = allRackets
    .filter((other) => other.id !== racket.id)
    .map((other) => ({
      racket: other,
      distance:
        Math.abs(other.balancePointMm - racket.balancePointMm) +
        Math.abs((other.lowestPrice ?? other.msrp) - (racket.lowestPrice ?? racket.msrp)) /
          200_000,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((entry) => entry.racket);

  const marketNote = price
    ? price.latest < price.median30
      ? t("belowMarket", {
          amount: formatDong(price.median30 - price.latest),
          variant: variantCode,
        })
      : price.latest > price.median30
        ? t("aboveMarket", {
            amount: formatDong(price.latest - price.median30),
            variant: variantCode,
          })
        : t("atMarket", { amount: "₫0", variant: variantCode })
    : null;

  return (
    <div className="page-shell pb-[152px] pt-4 lg:pb-12 lg:pt-5">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="mb-5 flex flex-wrap items-center gap-2 text-[12.5px] text-tertiary lg:mb-6"
      >
        <Link href="/rackets" className="no-underline hover:underline">
          {tn("rackets")}
        </Link>
        <span>/</span>
        <Link
          href={{ pathname: "/rackets", query: { brand: racket.brandSlug } }}
          className="no-underline hover:underline"
        >
          {racket.brandName}
        </Link>
        <span>/</span>
        <span className="text-secondary">{racket.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_460px] lg:gap-14">
        {/* ------------------------------------------------ identity + score */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>
              {racket.brandName} · {racket.releaseYear}
            </Eyebrow>
            <Badge tone="brand" icon="BadgeCheck">
              {t("cataloguedVariant")}
            </Badge>
          </div>

          <h1 className="display mt-2.5 text-[34px] leading-[1.0] text-primary lg:text-display-2">
            {racket.name}
          </h1>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Tag mono>{weightClasses.join(" · ")}</Tag>
            <Tag mono>{gripSizes.join(" · ")}</Tag>
            <Tag>{te(BALANCE_MESSAGE_KEY[racket.balanceType])}</Tag>
            <Tag>{te(FLEX_MESSAGE_KEY[racket.shaftFlex])}</Tag>
          </div>

          <p className="mt-4 max-w-[62ch] text-body text-secondary">
            {racket.summary[locale]}
          </p>

          {/* Racket Image Gallery */}
          <div className="mt-6">
            <RacketGallery
              racketName={racket.name}
              brandName={racket.brandName}
              heroImageUrl={racket.heroImageUrl}
              images={racket.images}
            />
          </div>

          {/* Court Score */}
          <Card padding="lg" className="mt-7">
            <div className="grid gap-6 sm:grid-cols-[152px_1fr] sm:gap-7">
              <div className="sm:border-r sm:border-line sm:pr-7">
                <Eyebrow as="h2">{t("courtScore")}</Eyebrow>
                <div className="mt-2 flex items-baseline gap-1">
                  <span
                    className={
                      "font-display text-[52px] font-extrabold leading-none tabular-nums " +
                      (racket.courtScore === null
                        ? "text-[var(--text-disabled)]"
                        : "text-primary")
                    }
                    style={{
                      fontVariationSettings: '"wdth" 104',
                      letterSpacing: "-0.028em",
                    }}
                  >
                    {racket.courtScore ?? "—"}
                  </span>
                  <span className="font-mono text-[13px] text-tertiary">/100</span>
                </div>
                <div className="mt-2.5 font-mono text-[11px] leading-relaxed text-tertiary">
                  {racket.player ? t("scoreSplit") : t("specHalfOnly")}
                </div>
                <Link
                  href="/methodology"
                  className="mt-2 inline-block text-[12.5px] font-semibold no-underline"
                >
                  {tn("methodology")}
                </Link>
              </div>

              <div>
                <ScoreBars axes={shownAxes} />
                <p className="mt-3 text-caption text-tertiary">
                  {racket.player
                    ? t("playerHalfNote", { count: racket.reviewCount })
                    : t("specOnlyNote", { count: racket.reviewCount })}
                </p>
              </div>
            </div>
          </Card>

          {/* The signature element */}
          <Card padding="lg" className="mt-6">
            <div className="flex items-baseline gap-3">
              <Eyebrow as="h2">{t("balance")}</Eyebrow>
              <span className="font-mono text-[11px] text-[var(--text-disabled)]">
                {t("balanceScale")}
              </span>
            </div>

            <BalanceRuler
              className="mt-5"
              markers={[
                {
                  mm: racket.balancePointMm,
                  emphasis: true,
                },
              ]}
            />

            <div className="mt-1.5 flex justify-between">
              <span className="eyebrow">{t("headLight")}</span>
              <span className="eyebrow">{t("even")}</span>
              <span className="eyebrow">{t("headHeavy")}</span>
            </div>

            <p className="mt-3.5 max-w-[62ch] text-body-sm text-secondary">
              {balanceReading}
            </p>
          </Card>

          <div className="mt-6 flex flex-wrap gap-3">
            <CompareToggle
              size="lg"
              item={{
                slug: racket.slug,
                name: racket.name,
                brand: racket.brandName,
              }}
            />
            {headlineVariant && (
              <WatchPriceSlot variantId={headlineVariant.id} />
            )}
          </div>
        </div>

        {/* ------------------------------------------------ key specs */}
        <div className="min-w-0">
          <SpecSheet keySpecs={keySpecs} extraSpecs={extraSpecs} />
        </div>
      </div>

      {/* ------------------------------------------------------- where to buy */}
      <section id="offers" className="mt-12 scroll-mt-20" aria-labelledby="offers-heading">
        <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
          <Eyebrow as="h2">
            <span id="offers-heading">{t("whereToBuy")}</span>
          </Eyebrow>
          {lowestOffer && (
            <span className="font-mono text-[12px] tabular-nums text-tertiary">
              {t("offersMeta", {
                sellers: new Set(inStock.map((o) => o.sellerId)).size,
                price: formatDong(lowestOffer.price),
              })}
            </span>
          )}
          <span className="ml-auto hidden text-[12.5px] text-tertiary lg:inline">
            {t("offersNote")}
          </span>
        </div>

        {inStock.length === 0 ? (
          <EmptyState title={t("noOffersTitle")} body={t("noOffersBody")} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-card">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-sunken">
                  {[
                    ts("seller"),
                    ts("condition"),
                    ts("variant"),
                    ts("stock"),
                    ts("price"),
                    "",
                  ].map((label, index) => (
                    <th
                      key={index}
                      scope="col"
                      className="eyebrow !text-[var(--text-secondary)] px-4 py-2.5"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inStock.map((offer, index) => {
                  const best = index === 0;
                  return (
                    <tr
                      key={offer.id}
                      className={
                        "border-b border-line last:border-0 " +
                        (best
                          ? "bg-brand-soft shadow-[inset_2px_0_0_var(--green-700)]"
                          : "")
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <Link
                            href={`/sellers/${offer.seller.slug}`}
                            className="text-[14px] font-semibold text-primary no-underline hover:text-brand"
                          >
                            {offer.seller.name}
                          </Link>
                          <TrustBadge
                            state={TIER_STATE[offer.seller.tier]}
                            label={tsel(
                              offer.seller.tier === "authorised"
                                ? "tierAuthorised"
                                : offer.seller.tier === "verified"
                                  ? "tierVerified"
                                  : "tierNew",
                            )}
                            title={tsel(
                              offer.seller.tier === "authorised"
                                ? "tierAuthorisedNote"
                                : offer.seller.tier === "verified"
                                  ? "tierVerifiedNote"
                                  : "tierNewNote",
                            )}
                          />
                          {offer.promoted && (
                            <Badge tone="neutral">{te("promoted")}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {offer.condition === "new" ? (
                          <span className="text-body-sm text-ink-700">
                            {te("conditionNew")}
                          </span>
                        ) : (
                          <Badge tone="used">
                            {te(CONDITION_MESSAGE_KEY[offer.condition])}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-primary">
                        {offer.variant.weightClass} {offer.variant.gripSize}
                      </td>
                      <td className="px-4 py-3">
                        <StockLabel
                          qty={offer.qtyAvailable}
                          labels={{
                            inStock: (count) => tk("inStock", { count }),
                            inStockMany: tk("inStockMany"),
                            left: (count) => tk("left", { count }),
                            outOfStock: tk("outOfStock"),
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="price text-[17px] text-primary">
                          {formatDong(offer.price)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/sellers/${offer.seller.slug}`}
                          className={
                            "inline-flex h-11 items-center justify-center rounded-md border px-3.5 lg:h-[38px] " +
                            "text-[13.5px] font-semibold no-underline transition-colors duration-[90ms] " +
                            (best
                              ? "border-transparent bg-[var(--action-primary-bg)] text-[var(--text-on-brand)] hover:bg-[var(--action-primary-bg-hover)]"
                              : "border-line-strong bg-card text-primary hover:bg-sunken")
                          }
                        >
                          {tc("view")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------- price history + reviews */}
      <div className="mt-12 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-10">
        {price && (
          <section aria-labelledby="history">
            <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
              <Eyebrow as="h2">
                <span id="history">{t("priceHistory")}</span>
              </Eyebrow>
              <span className="font-mono text-[12px] tabular-nums text-tertiary">
                {t("priceHistoryMeta", {
                  days: 90,
                  count: offers.length,
                  variant: variantCode,
                })}
              </span>
            </div>

            <Card padding="md">
              <div className="mb-3 flex flex-wrap items-baseline gap-4">
                <span className="price text-price-hero font-bold text-primary">
                  {formatDong(price.latest)}
                </span>
                <PriceDelta amount={price.delta90} period="90d" size="md" />
                <span className="ml-auto font-mono text-[11px] tabular-nums text-tertiary">
                  {t("median", { price: formatDong(price.median30) })}
                </span>
              </div>

              <PriceHistory
                data={price.points.map((point) => point.price)}
                variant="full"
                median={price.median30}
                animate
              />

              {marketNote && (
                <div className="mt-3 flex items-start gap-2.5 border-t border-line pt-3 text-[13px] text-secondary">
                  <Icon name="Info" size="sm" className="mt-0.5" />
                  {marketNote}
                </div>
              )}
            </Card>
          </section>
        )}

        <section aria-labelledby="reviews">
          <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
            <Eyebrow as="h2">
              <span id="reviews">{t("reviews")}</span>
            </Eyebrow>
            <span className="font-mono text-[12px] tabular-nums text-tertiary">
              {t("reviewsVerified", { count: racket.reviewCount })}
            </span>
          </div>

          {reviews.length === 0 ? (
            <EmptyState title={t("noReviewsTitle")} body={t("noReviewsBody")} />
          ) : (
            <div className="flex flex-col gap-3">
              {reviews.slice(0, 3).map((review) => (
                <ReviewCard key={review.id} review={review} locale={locale} />
              ))}
              {reviews.length > 3 && (
                <span className="text-body-sm font-semibold text-brand">
                  {t("readAllReviews", { count: reviews.length })}
                </span>
              )}
              {reviews.length < MIN_REVIEWS_FOR_PLAYER_SCORE && (
                <p className="text-caption text-tertiary">
                  {t("specOnlyNote", { count: reviews.length })}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ---------------------------------------------------------- similar */}
      <section className="mt-12" aria-labelledby="similar">
        <Eyebrow as="h2">
          <span id="similar">{t("similar")}</span>
        </Eyebrow>
        <div className="mt-3.5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {similar.map((other) => (
            <Link
              key={other.id}
              href={`/rackets/${other.brandSlug}/${other.slug}`}
              className="flex items-center gap-3.5 rounded-md border border-line bg-card px-4 py-3 no-underline
                transition-colors duration-[90ms] hover:border-line-strong"
            >
              <span className="aspect-square w-14 shrink-0 rounded-md bg-sunken" />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-primary">
                  {other.name}
                </span>
                <span className="block font-mono text-[11px] tabular-nums text-tertiary">
                  {other.balancePointMm} mm ·{" "}
                  {other.courtScore === null ? "—" : `${other.courtScore}/100`} ·{" "}
                  {formatDong(other.lowestPrice ?? other.msrp)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {lowestOffer && (
        <div
          className="fixed inset-x-0 bottom-[var(--mobile-tabbar-h)] z-[110] flex items-center gap-3 border-t border-line-strong
            bg-card px-4 py-2.5 shadow-[var(--shadow-sticky-up)] lg:hidden"
        >
          <div className="min-w-0">
            <div className="font-mono text-[11px] text-tertiary">{tc("from")}</div>
            <div className="price whitespace-nowrap text-[17px] text-primary">
              {formatDong(lowestOffer.price)}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <CompareToggle
              iconOnly
              size="lg"
              item={{
                slug: racket.slug,
                name: racket.name,
                brand: racket.brandName,
              }}
            />
            <a
              href="#offers"
              className={ButtonLinkStyle({ variant: "primary", size: "lg" })}
            >
              {t("whereToBuy")}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/** Reviewer context chips sit above the prose, not below: "4U G5 at 26 lbs,
 *  intermediate doubles" is what makes the sentence that follows usable. */
async function ReviewCard({
  review,
  locale,
}: {
  review: Review;
  locale: Locale;
}) {
  const te = await getTranslations("enums");

  return (
    <article className="rounded-md border border-line bg-card p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <TrustBadge
          state={review.tier === "community" ? "unverified" : "verified"}
          label={te(
            review.tier === "purchase"
              ? "tierPurchase"
              : review.tier === "owner"
                ? "tierOwner"
                : "tierCommunity",
          )}
        />
        <ReviewDate iso={review.createdAt} locale={locale} />
      </div>

      <div className="mb-2.5 flex flex-wrap gap-1.5">
        <Tag>
          {te(
            review.skillLevel === "beginner"
              ? "skillBeginner"
              : review.skillLevel === "intermediate"
                ? "skillIntermediate"
                : "skillAdvanced",
          )}
        </Tag>
        <Tag>
          {te(review.format === "singles" ? "formatSingles" : "formatDoubles")} ·{" "}
          {te(
            review.position === "net"
              ? "positionNet"
              : review.position === "mid"
                ? "positionMid"
                : "positionRear",
          ).toLowerCase()}
        </Tag>
        <Tag mono>
          {review.stringModel} · {review.tensionLbs} lbs
        </Tag>
      </div>

      <p className="text-[14px] leading-[1.55] text-ink-700">
        {review.body[locale]}
      </p>
    </article>
  );
}
