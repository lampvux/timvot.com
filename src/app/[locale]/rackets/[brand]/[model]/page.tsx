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
import { StringRecommender } from "@/components/string-recommender";
import { LazySimilarRackets } from "@/components/lazy-similar-rackets";
import {
  REVIEW_PAGE_SIZE,
  getRacketCore,
  getRacketDetail,
  getRackets,
} from "@/lib/data/repository";
import {
  MIN_REVIEWS_FOR_PLAYER_SCORE,
  tallyCount,
  type ReviewTally,
} from "@/lib/court-score";
import { ReviewSlot } from "@/components/review-slot";
import { ReviewPager } from "@/components/review-pager";
import { RATING_AXES } from "@/lib/review-standards";
import {
  BALANCE_MESSAGE_KEY,
  CONDITION_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  formatDong,
  formatTension,
} from "@/lib/format";
import { EVEN_BAND_MAX_MM, EVEN_BAND_MIN_MM } from "@/lib/types";
import type { SellerTier } from "@/lib/types";
import {
  finishFunctionProfile,
  profileFunction,
  startFunctionProfile,
} from "@/lib/racket-detail-profile";

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
 * Static child processes strip `--max-old-space-size`, so `next.config.ts`
 * opts into worker threads. That lets the build script's 6 GB heap reach this
 * phase, while low per-worker concurrency and this route's page cap prevent
 * the larger heap from becoming the only line of defence.
 *
 * Nothing is lost from the catalogue by this. Under Cache Components a path not
 * listed here still serves an App Shell instantly and upgrades in the
 * background — the tail is a slightly later page, not a missing one.
 *
 * Raise this only alongside more build workers (a Pro build machine, or
 * building in CI) or a fix for the per-page accumulation. See
 * `docs/performance-plan.md`.
 *
 * `PRERENDERED_RACKETS` in the environment overrides the default, which is what
 * `.github/workflows/deploy-production.yml` uses: a GitHub runner has more
 * cores than the Hobby builder, so static generation gets more workers and the
 * per-worker page ceiling stops binding. **30 stays the default on purpose** —
 * it is what Vercel's own git integration can survive, and that build must keep
 * working whether or not anyone uses the workflow.
 */
/**
 * Every catalogue card links here, and each of those links used to prefetch
 * this route *separately*.
 *
 * A prefetched detail route emits its gallery's image preloads, so three cards
 * in the catalogue's viewport pulled **2,53 MB of full-resolution product
 * photography** before the visitor expressed interest in any of them, plus the
 * detail-only client chunk — which Lighthouse then reported as unused, because
 * on the catalogue it is.
 *
 * `prefetch = 'partial'` moves that to one App Shell per *route*, shared by
 * every link that points here regardless of which racket it names. The shell
 * carries this route's static and cached content and none of its URL data, so
 * the gallery preloads are not in it. The click still lands on prefetched
 * markup: this is a cheaper prefetch, not a disabled one, and `prefetch={false}`
 * on the cards — which is what would disable it — is deliberately not what is
 * done here.
 *
 * Set on the destination, not on the link. Once `/sellers/[slug]` and
 * `/strings/[brand]/[model]` carry it too, `partialPrefetching: true` in
 * next.config.ts replaces all three and these exports come out.
 */
export const prefetch = "partial";

const DEFAULT_PRERENDERED_RACKETS = 30;

const PRERENDERED_RACKETS = (() => {
  const raw = Number(process.env.PRERENDERED_RACKETS);
  // Cache Components rejects an empty `generateStaticParams`, so the floor is 1
  // rather than 0 — see `empty-generate-static-params`.
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_PRERENDERED_RACKETS;
  return Math.floor(raw);
})();

export async function generateStaticParams() {
  const started = startFunctionProfile();
  const rackets = await profileFunction("repository.getRackets.generateStaticParams", () =>
    getRackets(),
  );
  const generated = [...rackets]
    .sort(
      (a, b) =>
        (b.courtScore ?? -1) - (a.courtScore ?? -1) || b.specScore - a.specScore,
    )
    .slice(0, PRERENDERED_RACKETS)
    .map((racket) => ({
      brand: racket.brandSlug,
      model: racket.slug,
    }));
  finishFunctionProfile("page.generateStaticParams", started, {
    racketCount: rackets.length,
    generatedPathCount: generated.length,
  });
  return generated;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; brand: string; model: string }>;
}): Promise<Metadata> {
  const started = startFunctionProfile();
  const { locale, brand, model } = await params;
  const racket = await profileFunction("repository.getRacketCore.metadata", () =>
    getRacketCore(brand, model),
  );
  if (!racket) {
    finishFunctionProfile("page.generateMetadata", started, {
      locale,
      brand,
      model,
      found: false,
    });
    return {};
  }
  const metadata = {
    title: `${racket.name} — ${racket.brandName}`,
    description: racket.summary[locale],
  };
  finishFunctionProfile("page.generateMetadata", started, {
    locale,
    brand,
    model,
    found: true,
  });
  return metadata;
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
  const started = startFunctionProfile();
  const { locale, brand, model } = await params;
  setRequestLocale(locale);

  const detail = await profileFunction("repository.getRacketDetail.page", () =>
    getRacketDetail(brand, model),
  );
  if (!detail) notFound();
  const { racket, offers, reviews, reviewTally, price } = detail;
  const reviewTotal = tallyCount(reviewTally);

  const t = await profileFunction("i18n.getTranslations.racket", () =>
    getTranslations("racket"),
  );
  const tc = await profileFunction("i18n.getTranslations.common", () =>
    getTranslations("common"),
  );
  const ts = await profileFunction("i18n.getTranslations.specs", () =>
    getTranslations("specs"),
  );
  const te = await profileFunction("i18n.getTranslations.enums", () =>
    getTranslations("enums"),
  );
  const tk = await profileFunction("i18n.getTranslations.stock", () =>
    getTranslations("stock"),
  );
  const tsel = await profileFunction("i18n.getTranslations.sellers", () =>
    getTranslations("sellers"),
  );
  const tn = await profileFunction("i18n.getTranslations.nav", () =>
    getTranslations("nav"),
  );

  // `getUser()` used to be in here, which made a spec sheet wait on a Supabase
  // Auth round-trip. It lives in <WatchPriceSlot /> now, behind Suspense.

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

  finishFunctionProfile("page.RacketPage", started, {
    locale,
    brand,
    model,
    offerCount: offers.length,
    reviewCount: reviewTotal,
  });

  return (
    <div className="page-shell max-w-[1160px] pb-[152px] pt-4 lg:pb-12 lg:pt-5">
      <nav
        aria-label="Breadcrumb"
        className="mb-5 flex flex-wrap items-center gap-2 text-[12.5px] text-tertiary"
      >
        <Link href="/rackets" className="no-underline hover:underline">
          {tn("rackets")}
        </Link>
        <span aria-hidden>/</span>
        <Link
          href={{ pathname: "/rackets", query: { brand: racket.brandSlug } }}
          className="no-underline hover:underline"
        >
          {racket.brandName}
        </Link>
        <span aria-hidden>/</span>
        <span className="text-secondary">{racket.name}</span>
      </nav>

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.36fr)_minmax(320px,0.94fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>{racket.brandName}</Eyebrow>
            <span className="font-mono text-[11px] tabular-nums text-tertiary">
              {racket.releaseYear}
            </span>
          </div>

          <h1 className="display mt-2 text-[34px] leading-[1.02] text-primary lg:text-[42px]">
            {racket.name}
          </h1>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Tag mono>{weightClasses.join(" · ")}</Tag>
            <Tag mono>{gripSizes.join(" · ")}</Tag>
            <Tag>{te(BALANCE_MESSAGE_KEY[racket.balanceType])}</Tag>
            <Tag>{te(FLEX_MESSAGE_KEY[racket.shaftFlex])}</Tag>
          </div>

          <div className="mt-5">
            <RacketGallery
              racketName={racket.name}
              brandName={racket.brandName}
              heroImageUrl={racket.heroImageUrl}
              images={racket.images}
            />
          </div>

          <p className="mt-5 max-w-[68ch] text-body text-secondary">
            {racket.summary[locale]}
          </p>

          <Card padding="md" className="mt-6">
            <div className="mb-4 flex flex-wrap items-start gap-3">
              <div>
                <Eyebrow as="h2">{t("courtScore")}</Eyebrow>
                <div className="mt-1.5 flex items-baseline gap-1">
                  <span
                    className={
                      "font-display text-[30px] font-extrabold leading-none tabular-nums " +
                      (racket.courtScore === null
                        ? "text-[var(--text-disabled)]"
                        : "text-primary")
                    }
                  >
                    {racket.courtScore ?? "—"}
                  </span>
                  <span className="font-mono text-[12px] text-tertiary">/100</span>
                </div>
              </div>
              <Link
                href="/methodology"
                className="ml-auto inline-flex min-h-11 items-center text-[12.5px] font-semibold no-underline lg:min-h-7"
              >
                {tn("methodology")}
              </Link>
            </div>
            <ScoreBars axes={shownAxes} compact />
            <p className="mt-3 text-caption text-tertiary">
              {racket.player
                ? t("playerHalfNote", { count: racket.reviewCount })
                : t("specOnlyNote", {
                    count: racket.reviewCount,
                    needed: MIN_REVIEWS_FOR_PLAYER_SCORE,
                  })}
            </p>
          </Card>

          <Card padding="md" className="mt-5">
            <div className="flex flex-wrap items-baseline gap-2">
              <Eyebrow as="h2">{t("balance")}</Eyebrow>
              <span className="font-mono text-[11px] text-[var(--text-disabled)]">
                {t("balanceScale")}
              </span>
            </div>
            <BalanceRuler
              className="mt-4"
              markers={[{ mm: racket.balancePointMm, emphasis: true }]}
            />
            <div className="mt-1 flex justify-between gap-3">
              <span className="text-[11px] text-tertiary">{t("headLight")}</span>
              <span className="text-[11px] text-tertiary">{t("even")}</span>
              <span className="text-right text-[11px] text-tertiary">{t("headHeavy")}</span>
            </div>
            <p className="mt-3 text-body-sm text-secondary">{balanceReading}</p>
          </Card>

          <div className="mt-5 flex flex-wrap gap-3">
            <CompareToggle
              size="lg"
              item={{
                slug: racket.slug,
                name: racket.name,
                brand: racket.brandName,
              }}
            />
            {headlineVariant && <WatchPriceSlot variantId={headlineVariant.id} />}
            <Link
              href={{
                pathname: "/check",
                query: { model: `${racket.brandSlug}/${racket.slug}`, edit: "1" },
              }}
              className={ButtonLinkStyle({ variant: "ghost", size: "lg" })}
            >
              <Icon name="ClipboardCheck" size="md" />
              {t("checkListing")}
            </Link>
          </div>
        </div>

        <aside className="min-w-0 space-y-5" aria-label={t("keySpecs")}>
          <SpecSheet keySpecs={keySpecs} extraSpecs={extraSpecs} />

          <section id="offers" className="scroll-mt-24" aria-labelledby="offers-heading">
            <Card padding="none" className="overflow-hidden">
              <div className="border-b border-line px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 id="offers-heading" className="font-display text-[17px] font-bold text-primary">
                    {t("whereToBuy")}
                  </h2>
                  {lowestOffer && (
                    <span className="font-mono text-[11px] tabular-nums text-tertiary">
                      {t("offersMeta", {
                        sellers: new Set(inStock.map((offer) => offer.sellerId)).size,
                        price: formatDong(lowestOffer.price),
                      })}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-tertiary">
                  {t("offersNote")}
                </p>
              </div>

              {inStock.length === 0 ? (
                <div className="px-4 py-6">
                  <p className="text-[14px] font-semibold text-primary">{t("noOffersTitle")}</p>
                  <p className="mt-1 text-body-sm text-secondary">{t("noOffersBody")}</p>
                </div>
              ) : (
                <div>
                  {inStock.map((offer, index) => {
                    const best = index === 0;
                    return (
                      <div
                        key={offer.id}
                        className={
                          "grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line px-4 py-3.5 last:border-0 " +
                          (best ? "bg-brand-soft" : "")
                        }
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
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
                            {offer.promoted && <Badge tone="neutral">{te("promoted")}</Badge>}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-tertiary">
                            <span>
                              {offer.condition === "new"
                                ? te("conditionNew")
                                : te(CONDITION_MESSAGE_KEY[offer.condition])}
                            </span>
                            <span aria-hidden>·</span>
                            <span className="font-mono tabular-nums text-secondary">
                              {offer.variant.weightClass} {offer.variant.gripSize}
                            </span>
                            <span aria-hidden>·</span>
                            <StockLabel
                              qty={offer.qtyAvailable}
                              labels={{
                                inStock: (count) => tk("inStock", { count }),
                                inStockMany: tk("inStockMany"),
                                left: (count) => tk("left", { count }),
                                outOfStock: tk("outOfStock"),
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex flex-col items-end justify-between gap-2">
                          <span className="price whitespace-nowrap text-[17px] text-primary">
                            {formatDong(offer.price)}
                          </span>
                          <Link
                            href={`/sellers/${offer.seller.slug}`}
                            className={ButtonLinkStyle({
                              variant: best ? "primary" : "secondary",
                              size: "sm",
                            })}
                          >
                            {tc("view")}
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </section>

          {price && (
            <section aria-labelledby="history">
              <Card padding="md">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 id="history" className="font-display text-[17px] font-bold text-primary">
                    {t("priceHistory")}
                  </h2>
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-tertiary">
                    {t("priceHistoryMeta", {
                      days: 90,
                      count: offers.length,
                      variant: variantCode,
                    })}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-baseline gap-3">
                  <span className="price text-[25px] font-bold text-primary">
                    {formatDong(price.latest)}
                  </span>
                  <PriceDelta amount={price.delta90} period="90d" />
                </div>
                <div className="mt-3">
                  <PriceHistory
                    data={price.points.map((point) => point.price)}
                    variant="full"
                    median={price.median30}
                    height={112}
                    animate
                  />
                </div>
                {marketNote && (
                  <div className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-[12px] text-secondary">
                    <Icon name="Info" size="sm" className="mt-0.5" />
                    {marketNote}
                  </div>
                )}
              </Card>
            </section>
          )}
        </aside>
      </div>

      <LazySimilarRackets racketId={racket.id} />

      <StringRecommender
        racketName={racket.name}
        maxTension={racket.maxTensionLbs}
        initialSkill={racket.skillLevel}
        initialStyle={racket.playStyleTags[0] ?? "all-round"}
      />

      <section className="mt-10" aria-labelledby="reviews">
        <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
          <Eyebrow as="h2">
            <span id="reviews">{t("reviews")}</span>
          </Eyebrow>
          <span className="font-mono text-[12px] tabular-nums text-tertiary">
            {t("reviewsCount", {
              count: reviewTotal,
              verified: reviewTotal - reviewTally.community.count,
            })}
          </span>
        </div>

        {reviewTotal === 0 ? (
          <EmptyState title={t("noReviewsTitle")} body={t("noReviewsBody")} />
        ) : (
          <>
            <ReviewAverages tally={reviewTally} />
            <ReviewPager
              racketId={racket.id}
              total={reviewTotal}
              pageSize={REVIEW_PAGE_SIZE}
              initial={reviews}
            />
          </>
        )}
        {reviewTotal < MIN_REVIEWS_FOR_PLAYER_SCORE && (
          <p className="mt-2 text-caption text-tertiary">
            {t("specOnlyNote", {
              count: reviewTotal,
              needed: MIN_REVIEWS_FOR_PLAYER_SCORE,
            })}
          </p>
        )}

        <ReviewSlot
          racketId={racket.id}
          locale={locale}
          maxTension={racket.maxTensionLbs[1]}
        />
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

/** Plain averages on the review form's own 1–5 scale, every tier counted
 *  once. This is what readers said, not the Court Score: the score weights
 *  tiers and lives in the aside with its methodology. */
async function ReviewAverages({ tally }: { tally: ReviewTally }) {
  const tr = await getTranslations("racket");
  const count = tallyCount(tally);
  return (
    <div className="mb-3 rounded-md border border-line bg-card px-4 py-3">
      <p className="mb-2 text-caption text-tertiary">
        {tr("reviewAverages", { count })}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {RATING_AXES.map((axis) => {
          const mean =
            (tally.purchase[axis] + tally.owner[axis] + tally.community[axis]) / count;
          return (
            <div key={axis}>
              <dt className="eyebrow text-tertiary">{tr(axis)}</dt>
              <dd className="font-mono text-[17px] tabular-nums text-primary">
                {mean.toFixed(1)}
                <span className="text-[12px] text-tertiary">/5</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
