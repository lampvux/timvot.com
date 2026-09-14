import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Eyebrow, Icon } from "@/components/ds/primitives";
import { PriceDelta, PriceHistory } from "@/components/ds/data";
import { RacketCard } from "@/components/racket-card";
import { getHomepageData } from "@/lib/data/repository";
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

  // One read, bounded by what this page renders: four cards, three drops,
  // three guides and three counts. Trending is Court Score order, and a racket
  // without a player half is not in the running for it — `racket_market`
  // applies that rule as `nulls last` rather than by loading the catalogue.
  const { trending, deals: topDeals, guides, counts } = await getHomepageData();

  return (
    <>
      {/* Hero section with green grid pattern background */}
      <section
        data-theme="inverse"
        className="relative overflow-hidden border-b border-emerald-900/60 bg-[#052518]"
        style={{
          backgroundImage: `linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px)`,
          backgroundSize: "32px 32px",
        }}
      >
        <div className="page-shell grid gap-10 py-10 lg:grid-cols-[1fr_420px] lg:items-center lg:gap-14 lg:py-16">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-bold tracking-[0.14em] text-[#38d4a6] uppercase">
              <span>—</span>
              <span>{t("eyebrow")}</span>
            </div>

            <h1 className="mt-4 font-display text-[34px] sm:text-[46px] lg:text-[56px] font-extrabold leading-[1.05] tracking-tight text-white">
              {t("heroTitle1")} <br />
              <span className="text-[#38d4a6]">{t("heroTitle2")}</span> <br />
              {t("heroTitle3")}
            </h1>

            <p className="mt-5 max-w-[54ch] text-[15px] sm:text-[16px] leading-relaxed text-[#93a09a]">
              {t("heroBody")}
            </p>

            <div className="mt-8 flex flex-wrap items-baseline gap-8 sm:gap-12">
              <div>
                <div className="font-mono text-[28px] sm:text-[34px] font-bold tracking-tight text-white leading-none">
                  {counts.rackets.toLocaleString("vi-VN")}
                </div>
                <div className="mt-1.5 text-[12px] text-[#93a09a]">
                  {t("labelRackets")}
                </div>
              </div>
              <div>
                <div className="font-mono text-[28px] sm:text-[34px] font-bold tracking-tight text-white leading-none">
                  {counts.liveOffers.toLocaleString("vi-VN")}
                </div>
                <div className="mt-1.5 text-[12px] text-[#93a09a]">
                  {t("labelListings")}
                </div>
              </div>
              <div>
                <div className="font-mono text-[28px] sm:text-[34px] font-bold tracking-tight text-white leading-none">
                  {counts.verifiedSellers.toLocaleString("vi-VN")}
                </div>
                <div className="mt-1.5 text-[12px] text-[#93a09a]">
                  {t("labelSellers")}
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/rackets"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#38d4a6] px-6 text-[15px] font-bold text-[#062e1c] transition-colors hover:bg-[#2dc497]"
              >
                {t("exploreNow")}
                <Icon name="ArrowRight" size="md" />
              </Link>
              <Link
                href="/deals"
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-emerald-700/50 bg-[#0b3323]/60 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#0b3323]"
              >
                {t("todayDeals")}
              </Link>
            </div>
          </div>

          {/* Right column: Finder Card */}
          <div className="rounded-2xl border border-emerald-800/60 bg-[#07291c]/90 p-6 shadow-2xl backdrop-blur-md">
            <div className="text-[12px] font-bold tracking-wider text-[#38d4a6] uppercase">
              {t("finderCardTitle")}
            </div>
            <p className="mt-2 text-[14px] font-medium leading-snug text-white/90">
              {t("finderCardBody")}
            </p>

            <ol className="mt-5 space-y-3">
              <li className="flex items-center text-[13.5px] text-white/80">
                <span className="font-mono text-[13px] font-bold text-[#38d4a6] mr-3">01</span>
                {t("finderQ1")}
              </li>
              <li className="flex items-center text-[13.5px] text-white/80">
                <span className="font-mono text-[13px] font-bold text-[#38d4a6] mr-3">02</span>
                {t("finderQ2")}
              </li>
              <li className="flex items-center text-[13.5px] text-white/80">
                <span className="font-mono text-[13px] font-bold text-[#38d4a6] mr-3">03</span>
                {t("finderQ3")}
              </li>
            </ol>

            <Link
              href="/finder"
              className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#38d4a6] px-4 text-[15px] font-bold text-[#041c11] transition-colors hover:bg-[#2dc497]"
            >
              {t("startFinder")}
              <Icon name="ArrowRight" size="md" />
            </Link>

            <div className="relative mt-5 overflow-hidden rounded-xl">
              <Image
                src="/images/courses-badminton.png"
                alt="Finding rackets"
                width={400}
                height={180}
                className="h-[140px] w-full object-cover"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3">
                <span className="text-[12px] font-medium text-white/90">
                  {t("finderImageOverlay")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Ticker bar at bottom of hero */}
        {/* <div className="border-t border-emerald-900/80 bg-[#041f15]/90 py-3.5 text-[13px] text-white/90">
          <div className="page-shell flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">🛡️</span>
              <span>
                <strong className="font-bold text-white">{counts.verifiedSellers}</strong>{" "}
                {t("tickerVerifiedSellers")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-cyan-400">📊</span>
              <span>{t("tickerPriceHistory")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-cyan-400">🔍</span>
              <span>
                <strong className="font-bold text-white">{counts.liveOffers.toLocaleString("vi-VN")}+</strong>{" "}
                {t("tickerListingsTracked")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-amber-400">⚡</span>
              <span>{t("tickerDailyUpdates")}</span>
            </div>
          </div>
        </div> */}
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
            {/* No `eager` here on purpose. The measured LCP on this page is
                the headline, not a card — these sit below a full-height hero
                band — and the four preloads this used to emit competed with
                it rather than helping. Lazy is the correct default. */}
            {trending.map((racket) => (
              <div key={racket.id} className="w-[208px] shrink-0 sm:w-auto">
                <RacketCard racket={racket} compact />
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
