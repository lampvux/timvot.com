import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { ButtonLinkStyle, Card, Eyebrow, Icon } from "@/components/ds/primitives";
import { PriceDelta, PriceHistory } from "@/components/ds/data";
import { RacketCard } from "@/components/racket-card";
import { getDeals, getGuides, getRackets, loadSnapshot } from "@/lib/data/repository";
import { formatDong } from "@/lib/format";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("home");
  const tc = await getTranslations("common");
  const tn = await getTranslations("nav");

  const [rackets, deals, guides, snapshot] = await Promise.all([
    getRackets(),
    getDeals(),
    getGuides(),
    loadSnapshot(),
  ]);

  // Trending is Court Score order, and a racket without a player half is not
  // in the running for it.
  const trending = rackets
    .filter((racket) => racket.courtScore !== null)
    .sort((a, b) => (b.courtScore ?? 0) - (a.courtScore ?? 0))
    .slice(0, 4);
  const topDeals = deals.slice(0, 3);

  return (
    <>
      {/* One inverse court-green band per page. */}
      <section data-theme="inverse" className="bg-green-900">
        <div className="page-shell grid gap-10 py-8 lg:grid-cols-[1fr_400px] lg:items-end lg:gap-16 lg:py-14">
          <div>
            <Eyebrow className="!text-cyan-300">{t("eyebrow")}</Eyebrow>
            <h1 className="display mt-3 max-w-[22ch] text-[30px] leading-[1.02] text-white lg:mt-4 lg:text-display-2">
              One spec sheet and one price history for every racket sold here.
            </h1>
            <p className="mt-4 max-w-[52ch] text-body-lg text-secondary lg:mt-5">
              {t("heroBody")}
            </p>
            <div className="mt-6 flex flex-col gap-1 font-mono text-[12px] tabular-nums text-secondary lg:mt-7 lg:flex-row lg:gap-7 lg:text-[13px]">
              <span>{t("statRackets", { count: rackets.length })}</span>
              <span>{t("statListings", { count: snapshot.offers.length })}</span>
              <span>
                {t("statSellers", {
                  count: snapshot.sellers.filter((s) => s.tier !== "new").length,
                })}
              </span>
            </div>
            <div className="mt-6 lg:hidden">
              <Link
                href="/finder"
                className={ButtonLinkStyle({
                  variant: "primary",
                  size: "lg",
                  fullWidth: true,
                })}
              >
                {t("startFinder")}
                <Icon name="ArrowRight" size="md" />
              </Link>
            </div>
          </div>

          <Card padding="lg" className="hidden lg:block">
            <Eyebrow className="!text-cyan-300">{tn("finder")}</Eyebrow>
            <p className="mt-3 mb-5 text-body text-white">{t("finderCardBody")}</p>
            <ol className="mb-5 flex flex-col gap-2">
              {[t("finderQ1"), t("finderQ2"), t("finderQ3")].map((q, i) => (
                <li
                  key={q}
                  className="flex items-center gap-2.5 text-body-sm text-secondary"
                >
                  <span className="font-mono text-[11px] tabular-nums text-cyan-300">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {q}
                </li>
              ))}
            </ol>
            <Link
              href="/finder"
              className={ButtonLinkStyle({
                variant: "primary",
                size: "lg",
                fullWidth: true,
              })}
            >
              {t("startFinder")}
              <Icon name="ArrowRight" size="md" />
            </Link>
          </Card>
        </div>
      </section>

      <div className="page-shell py-8 lg:py-12">
        {/* Trending */}
        <section aria-labelledby="trending">
          <div className="mb-5 flex items-baseline gap-4">
            <Eyebrow as="h2" className="!text-tertiary" >
              <span id="trending">{t("trending")}</span>
            </Eyebrow>
            <span className="hidden font-mono text-[11px] text-[var(--text-disabled)] lg:inline">
              {t("trendingMeta")}
            </span>
            <Link
              href="/rackets"
              className="ml-auto text-body-sm font-semibold no-underline"
            >
              {tc("seeAll")}
            </Link>
          </div>

          {/* 4 up on desktop, 2 up on tablet, a scroll rail on mobile where
              the clipped second card signals scroll without a chevron. */}
          <div className="rail -mx-4 px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-4">
            {trending.map((racket, index) => (
              <div key={racket.id} className="w-[208px] shrink-0 sm:w-auto">
                <RacketCard racket={racket} priority={index < 4} compact />
              </div>
            ))}
          </div>
        </section>

        {/* Price drops + guides */}
        <div className="mt-10 grid gap-8 lg:mt-12 lg:grid-cols-[1.35fr_1fr] lg:gap-10">
          <section aria-labelledby="drops">
            <div className="mb-3 flex items-baseline gap-4">
              <Eyebrow as="h2">
                <span id="drops">{t("priceDrops")}</span>
              </Eyebrow>
              <Link
                href="/deals"
                className="ml-auto text-body-sm font-semibold no-underline"
              >
                {tc("seeAll")}
              </Link>
            </div>

            <div className="overflow-hidden rounded-md border border-line bg-card">
              {topDeals.map((deal, index) => {
                const variant = deal.racket.variants.find(
                  (v) => v.id === deal.variantId,
                );
                return (
                  <div
                    key={deal.variantId}
                    className={
                      "grid items-center gap-4 px-4 py-3 " +
                      (index < topDeals.length - 1 ? "border-b border-line " : "") +
                      "grid-cols-[1fr_auto] lg:grid-cols-[1fr_150px_140px_90px]"
                    }
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/rackets/${deal.racket.brandSlug}/${deal.racket.slug}`}
                        className="block truncate text-[14px] font-semibold text-primary no-underline hover:text-brand"
                      >
                        {deal.racket.name}
                      </Link>
                      <div className="font-mono text-[11px] tabular-nums text-tertiary">
                        {variant
                          ? `${variant.weightClass} ${variant.gripSize} · `
                          : ""}
                        {tc("sellers", { count: deal.racket.sellerCount })}
                      </div>
                    </div>
                    <span className="hidden font-mono text-[15px] tabular-nums text-primary lg:inline">
                      {formatDong(deal.price.latest)}
                    </span>
                    <PriceDelta amount={deal.price.delta30} period="30d" />
                    <div className="hidden lg:block">
                      <PriceHistory
                        data={deal.price.points.slice(-8).map((p) => p.price)}
                        variant="spark"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="guides">
            <div className="mb-3 flex items-baseline gap-4">
              <Eyebrow as="h2">
                <span id="guides">{t("guides")}</span>
              </Eyebrow>
              <Link
                href="/guides"
                className="ml-auto text-body-sm font-semibold no-underline"
              >
                {tc("seeAll")}
              </Link>
            </div>

            <div className="flex flex-col gap-3">
              {guides.slice(0, 3).map((guide) => (
                <Link
                  key={guide.slug}
                  href="/guides"
                  className={
                    "block rounded-md border px-4 py-3.5 no-underline " +
                    (guide.tone === "used"
                      ? "border-cork-100 bg-used"
                      : "border-line bg-card")
                  }
                >
                  <div className="text-body font-semibold text-primary">
                    {guide.title[locale]}
                  </div>
                  <div className="mt-1 text-caption text-tertiary">
                    {guide.excerpt[locale]} · {guide.readMinutes} min
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
