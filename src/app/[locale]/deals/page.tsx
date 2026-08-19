import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { EmptyState, Eyebrow } from "@/components/ds/primitives";
import { PriceDelta, PriceHistory } from "@/components/ds/data";
import { getDeals } from "@/lib/data/repository";
import { formatDelta, formatDong } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "deals" });
  return { title: t("title") };
}

export default async function DealsPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("deals");
  const ts = await getTranslations("specs");

  const deals = await getDeals();

  return (
    <div className="page-shell py-8 lg:py-12">
      <Eyebrow>{t("title")}</Eyebrow>
      <h1 className="display mt-1.5 max-w-[24ch] text-[27px] text-primary lg:text-h1">
        {t("subtitle", { count: deals.length })}
      </h1>

      <div className="mt-6">
        {deals.length === 0 ? (
          <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-card">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-sunken">
                  {[
                    ts("brand"),
                    ts("variant"),
                    ts("price"),
                    t("vsMedian"),
                    "30d",
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
                {deals.map((deal) => {
                  const variant = deal.racket.variants.find(
                    (v) => v.id === deal.variantId,
                  );
                  return (
                    <tr
                      key={deal.variantId}
                      className="border-b border-line last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/rackets/${deal.racket.brandSlug}/${deal.racket.slug}`}
                          className="text-[14px] font-semibold text-primary no-underline hover:text-brand"
                        >
                          {deal.racket.name}
                        </Link>
                        <div className="text-caption text-tertiary">
                          {deal.racket.brandName}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-secondary">
                        {variant
                          ? `${variant.weightClass} ${variant.gripSize}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="price text-[17px] text-primary">
                          {formatDong(deal.price.latest)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-drop">
                        {formatDelta(deal.price.latest - deal.price.median30)}
                      </td>
                      <td className="px-4 py-3">
                        <PriceDelta amount={deal.price.delta30} period="30d" />
                      </td>
                      <td className="w-[110px] px-4 py-3">
                        <PriceHistory
                          data={deal.price.points.slice(-10).map((p) => p.price)}
                          variant="spark"
                          label={`${deal.racket.name} price trend`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
