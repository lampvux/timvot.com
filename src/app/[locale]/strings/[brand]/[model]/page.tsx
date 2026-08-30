import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { PriceHistory } from "@/components/ds/data";
import { Badge, Eyebrow, TrustBadge } from "@/components/ds/primitives";
import { formatDong } from "@/lib/format";
import { getString, getStringOffers, getStrings } from "@/lib/data/string-repository";

export async function generateStaticParams() {
  return (await getStrings()).map((string) => ({
    brand: string.brandSlug,
    model: string.slug,
  }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale; brand: string; model: string }> }): Promise<Metadata> {
  const { locale, brand, model } = await params;
  const string = await getString(brand, model);
  return string ? { title: `${string.name} — ${string.brandName}`, description: string.summary[locale] } : {};
}

export default async function StringPage({ params }: { params: Promise<{ locale: Locale; brand: string; model: string }> }) {
  const { locale, brand, model } = await params;
  setRequestLocale(locale);
  const string = await getString(brand, model);
  if (!string) notFound();
  const [t, tc, offers] = await Promise.all([getTranslations("strings"), getTranslations("common"), getStringOffers(string.id)]);
  const inStock = offers.filter((offer) => offer.qtyAvailable > 0);
  const values = string.history.map((point) => point.price);

  return (
    <div className="page-shell py-6 lg:py-10">
      <nav aria-label="Breadcrumb" className="mb-7 flex gap-2 text-[12.5px] text-tertiary"><Link href="/strings" className="no-underline hover:underline">{t("title")}</Link><span>/</span><span>{string.name}</span></nav>
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <Eyebrow>{string.brandName} · {t("catalogued")}</Eyebrow>
          <h1 className="display mt-2 text-[38px] leading-none text-primary lg:text-[52px]">{string.name}</h1>
          <p className="mt-5 max-w-[52ch] text-body text-secondary">{string.summary[locale]}</p>
          <div className="mt-6 flex flex-wrap gap-2"><Badge tone="brand">{string.gaugeMm.toFixed(2)}{string.crossGaugeMm ? ` / ${string.crossGaugeMm.toFixed(2)}` : ""} mm</Badge><Badge tone="neutral">{t(`feel.${string.feel}`)}</Badge>{string.playStyleTags.map((style) => <Badge key={style} tone="neutral">{t(`style.${style}`)}</Badge>)}</div>

          <div className="mt-8 rounded-lg border border-line bg-card p-6 shadow-1">
            <Eyebrow as="h2">{t("performanceProfile")}</Eyebrow>
            <div className="mt-5 space-y-4">{[["repulsion", string.repulsion], ["control", string.control], ["durability", string.durability]].map(([key, value]) => <div key={String(key)}><div className="mb-1.5 flex justify-between text-[13px]"><span className="font-semibold text-primary">{t(String(key))}</span><span className="font-mono text-tertiary">{value}/5</span></div><div className="h-2 overflow-hidden rounded-full bg-ink-200"><div className="h-full rounded-full bg-green-700" style={{ width: `${Number(value) * 20}%` }} /></div></div>)}</div>
          </div>
        </div>

        <div>
          <section className="rounded-lg border border-line bg-card p-5 shadow-1 sm:p-7" aria-labelledby="price-history-title">
            <div className="flex items-end justify-between gap-4"><div><Eyebrow as="h2"><span id="price-history-title">{t("priceHistory")}</span></Eyebrow><p className="mt-1 text-caption text-tertiary">{t("historyNote")}</p></div>{string.lowestPrice && <span className="price text-[24px] text-primary">{formatDong(string.lowestPrice)}</span>}</div>
            <div className="mt-5"><PriceHistory variant="full" height={180} data={values} label={t("chartLabel", { name: string.name })} /></div>
          </section>

          <section className="mt-6" aria-labelledby="offers-title"><div className="mb-3 flex items-baseline justify-between"><Eyebrow as="h2"><span id="offers-title">{t("comparePrices")}</span></Eyebrow><span className="font-mono text-[11px] text-tertiary">{t("sellerCount", { count: inStock.length })}</span></div><div className="space-y-2.5">{inStock.map((offer, index) => <div key={offer.id} className={`grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center ${index === 0 ? "border-green-300 bg-brand-soft" : "border-line bg-card"}`}><div className="flex flex-wrap items-center gap-2"><Link href={`/sellers/${offer.seller.slug}`} className="font-semibold text-primary no-underline hover:text-brand">{offer.seller.name}</Link><TrustBadge state={offer.seller.tier === "authorised" ? "authorised" : offer.seller.tier === "verified" ? "verified" : "unverified"} label={offer.seller.tier} /></div><div><span className="price text-[18px] text-primary">{formatDong(offer.price)}</span><span className="ml-2 font-mono text-[10px] text-tertiary">{t("inStock", { count: offer.qtyAvailable })}</span></div><Link href={`/sellers/${offer.seller.slug}`} className="inline-flex h-11 items-center justify-center rounded-md border border-line-strong bg-card px-4 text-[13px] font-semibold text-primary no-underline hover:bg-sunken">{tc("view")}</Link></div>)}</div></section>
        </div>
      </div>
    </div>
  );
}
