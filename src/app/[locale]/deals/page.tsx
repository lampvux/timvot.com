import Image from "next/image";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  ButtonLinkStyle,
  Card,
  EmptyState,
  Eyebrow,
  Icon,
} from "@/components/ds/primitives";
import { CompareToggle } from "@/components/compare-tray";
import { getDeals, type Deal } from "@/lib/data/repository";
import {
  BALANCE_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  formatDong,
} from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "deals" });
  return { title: t("title") };
}

function previousPrice(deal: Deal) {
  return deal.price.latest - deal.price.delta30;
}

function savingAmount(deal: Deal) {
  return Math.max(0, previousPrice(deal) - deal.price.latest);
}

function savingPercent(deal: Deal) {
  const previous = previousPrice(deal);
  return previous > 0 ? Math.round((savingAmount(deal) / previous) * 100) : 0;
}

function DealImage({
  deal,
  priority = false,
  sizes,
  className,
}: {
  deal: Deal;
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const src = deal.racket.heroThumbUrl ?? deal.racket.heroImageUrl;
  const hasThumb = Boolean(deal.racket.heroThumbUrl);

  return (
    <div className={`relative grid place-items-center overflow-hidden ${className ?? ""}`}>
      <span
        aria-hidden
        className="font-mono text-[10px] font-semibold tracking-wide text-tertiary"
      >
        {deal.racket.brandName.toUpperCase()}
      </span>
      {src && (
        <Image
          src={src}
          alt=""
          fill
          priority={priority}
          unoptimized={hasThumb}
          sizes={sizes}
          className="object-contain p-2"
        />
      )}
    </div>
  );
}

export default async function DealsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("deals");
  const tc = await getTranslations("common");
  const te = await getTranslations("enums");
  const deals = await getDeals();

  const featured = deals[0];
  const saleDeals = deals.slice(0, 4);
  const trackedDeals = deals.slice(0, 8);
  const racketListings = new Map<string, number>();
  for (const deal of deals) {
    racketListings.set(
      deal.racket.id,
      Math.max(racketListings.get(deal.racket.id) ?? 0, deal.racket.sellerCount),
    );
  }
  const activeListings = [...racketListings.values()].reduce(
    (total, count) => total + count,
    0,
  );

  return (
    <div className="deals-page">
      <section data-theme="inverse" className="bg-green-900">
        <div className="page-shell grid gap-8 py-9 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-16 lg:py-14">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-risk px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white">
              <Icon name="TrendingDown" size="sm" className="size-3.5" />
              {t("limitedTime")}
            </span>
            <h1 className="display mt-4 max-w-[17ch] text-[38px] leading-[1.05] text-primary lg:text-[48px]">
              {t("heroTitle")}
            </h1>
            <p className="mt-4 max-w-[54ch] text-body text-secondary">
              {t("heroBody")}
            </p>

            <dl className="mt-6 grid max-w-[430px] grid-cols-3 gap-5">
              <div className="flex flex-col">
                <dt className="text-[11px] text-secondary">{t("onSaleNow")}</dt>
                <dd className="order-first font-display text-[24px] font-bold text-cyan-300 tabular-nums">
                  {deals.length}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-[11px] text-secondary">{t("priceDropsMonth")}</dt>
                <dd className="order-first font-display text-[24px] font-bold text-cyan-300 tabular-nums">
                  {deals.length}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-[11px] text-secondary">{t("activeListings")}</dt>
                <dd className="order-first font-display text-[24px] font-bold text-cyan-300 tabular-nums">
                  {activeListings}
                </dd>
              </div>
            </dl>
          </div>

          {featured && (
            <Card
              padding="md"
              className="border-[var(--border-inverse)] bg-green-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-risk px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                  {t("featuredDeal")}
                </span>
                <span className="text-[11px] text-tertiary">{t("bestSavings")}</span>
              </div>
              <div className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4">
                <DealImage
                  deal={featured}
                  priority
                  sizes="88px"
                  className="aspect-square rounded-md bg-green-950"
                />
                <div className="min-w-0">
                  <div className="eyebrow !text-cyan-300">{featured.racket.brandName}</div>
                  <Link
                    href={`/rackets/${featured.racket.brandSlug}/${featured.racket.slug}`}
                    className="mt-1 block font-display text-[21px] font-bold text-primary no-underline hover:text-cyan-200"
                  >
                    {featured.racket.name}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-baseline gap-2">
                    <span className="price text-[28px] text-primary">
                      {formatDong(featured.price.latest)}
                    </span>
                    <span className="price text-[13px] text-tertiary line-through">
                      {formatDong(previousPrice(featured))}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[12px] font-semibold text-cyan-300">
                    {t("saveLine", {
                      amount: formatDong(savingAmount(featured)),
                      percent: savingPercent(featured),
                    })}
                  </p>
                  <p className="mt-1 text-[11px] text-tertiary">
                    {tc("sellers", { count: featured.racket.sellerCount })} ·{" "}
                    {te(BALANCE_MESSAGE_KEY[featured.racket.balanceType])}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </section>

      <section className="bg-page py-10 lg:py-12" aria-labelledby="sale-heading">
        <div className="page-shell">
          <div className="flex items-center gap-2 text-risk">
            <span className="size-2 rounded-full bg-risk" aria-hidden />
            <span className="eyebrow !text-risk">{t("salePricesActive")}</span>
          </div>
          <h2 id="sale-heading" className="mt-1.5 font-display text-h2 font-bold text-primary">
            {t("onSaleNow")}
          </h2>

          {deals.length === 0 ? (
            <div className="mt-5">
              <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
            </div>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {saleDeals.map((deal, index) => (
                <Card key={deal.variantId} padding="none" className="flex min-w-0 flex-col overflow-hidden">
                  <div className="relative bg-risk-bg">
                    <DealImage
                      deal={deal}
                      priority={index < 4}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      className="aspect-[1.35/1]"
                    />
                    <span className="absolute left-3 top-3 rounded-pill bg-risk px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                      −{savingPercent(deal)}%
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-3.5">
                    <Eyebrow>{deal.racket.brandName}</Eyebrow>
                    <Link
                      href={`/rackets/${deal.racket.brandSlug}/${deal.racket.slug}`}
                      className="mt-1 font-display text-[16px] font-bold leading-snug text-primary no-underline hover:text-brand"
                    >
                      {deal.racket.name}
                    </Link>
                    <div className="mt-2.5 flex flex-wrap items-baseline gap-2">
                      <span className="price text-[18px] text-primary">
                        {formatDong(deal.price.latest)}
                      </span>
                      <span className="price text-[11px] text-tertiary line-through">
                        {formatDong(previousPrice(deal))}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-risk">
                      {t("saveAmount", { amount: formatDong(savingAmount(deal)) })} ·{" "}
                      {tc("sellers", { count: deal.racket.sellerCount })}
                    </p>
                    <div className="mt-auto grid grid-cols-[minmax(0,1fr)_auto] gap-2 pt-3">
                      <Link
                        href={`/rackets/${deal.racket.brandSlug}/${deal.racket.slug}`}
                        className={ButtonLinkStyle({ variant: "primary", size: "sm", fullWidth: true })}
                      >
                        {t("viewDeal")}
                      </Link>
                      <CompareToggle
                        item={{
                          slug: deal.racket.slug,
                          name: deal.racket.name,
                          brand: deal.racket.brandName,
                        }}
                        size="sm"
                        shortLabel
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      {trackedDeals.length > 0 && (
        <section className="bg-card py-10 lg:py-12" aria-labelledby="tracker-heading">
          <div className="page-shell">
            <Eyebrow className="!text-risk">{t("pricesJustDropped")}</Eyebrow>
            <h2 id="tracker-heading" className="mt-1.5 font-display text-h2 font-bold text-primary">
              {t("priceDropTracker")}
            </h2>
            <p className="mt-1 text-body-sm text-secondary">{t("trackerBody")}</p>

            <div className="mt-5 flex flex-col gap-2.5">
              {trackedDeals.map((deal) => (
                <Link
                  key={deal.variantId}
                  href={`/rackets/${deal.racket.brandSlug}/${deal.racket.slug}`}
                  className="grid min-h-[74px] grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-line bg-page px-3 py-2.5 no-underline transition-colors duration-[90ms] hover:border-line-strong sm:grid-cols-[48px_minmax(0,1fr)_auto_20px]"
                >
                  <DealImage
                    deal={deal}
                    sizes="48px"
                    className="aspect-square rounded-sm bg-sunken"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="eyebrow !text-brand">{deal.racket.brandName}</span>
                      <span className="rounded-sm bg-risk-bg px-1.5 py-0.5 text-[10px] font-bold text-risk">
                        {t("sale")}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[14px] font-semibold text-primary">
                      {deal.racket.name}
                    </span>
                    <span className="block truncate text-[11px] text-tertiary">
                      {te(BALANCE_MESSAGE_KEY[deal.racket.balanceType])} ·{" "}
                      {te(FLEX_MESSAGE_KEY[deal.racket.shaftFlex])} ·{" "}
                      {tc("sellers", { count: deal.racket.sellerCount })}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block">
                      <span className="price text-[17px] text-primary">
                        {formatDong(deal.price.latest)}
                      </span>{" "}
                      <span className="price hidden text-[11px] text-tertiary line-through sm:inline">
                        {formatDong(previousPrice(deal))}
                      </span>
                    </span>
                    <span className="mt-1 inline-flex rounded-pill bg-risk px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
                      −{savingPercent(deal)}% · −{formatDong(savingAmount(deal))}
                    </span>
                  </span>
                  <Icon name="ChevronRight" size="sm" className="hidden text-tertiary sm:block" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="bg-page py-9 lg:py-11">
        <div className="page-shell">
          <Card
            padding="lg"
            className="flex flex-col gap-5 border-green-800 bg-green-900 sm:flex-row sm:items-center"
            data-theme="inverse"
          >
            <div>
              <h2 className="font-display text-[19px] font-bold text-primary">
                {t("neverMiss")}
              </h2>
              <p className="mt-1 text-body-sm text-secondary">{t("alertBody")}</p>
            </div>
            <Link
              href="/rackets"
              className={`${ButtonLinkStyle({ variant: "primary", size: "md" })} sm:ml-auto`}
            >
              {t("browseAlerts")}
              <Icon name="ArrowRight" size="sm" />
            </Link>
          </Card>
        </div>
      </section>
    </div>
  );
}
