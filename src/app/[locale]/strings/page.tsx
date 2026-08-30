import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { PriceHistory } from "@/components/ds/data";
import { Badge, Eyebrow } from "@/components/ds/primitives";
import { formatDong } from "@/lib/format";
import { getStrings } from "@/lib/data/string-repository";

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "strings" });
  return { title: t("title"), description: t("intro") };
}

export default async function StringsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, items] = await Promise.all([getTranslations("strings"), getStrings()]);

  return (
    <div className="page-shell py-7 lg:py-10">
      <div className="max-w-3xl">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h1 className="display mt-2 text-[36px] leading-none text-primary lg:text-display-2">{t("title")}</h1>
        <p className="mt-4 text-body text-secondary">{t("intro")}</p>
      </div>

      <div className="mt-8 overflow-hidden rounded-lg border border-line bg-card shadow-1">
        <div className="hidden grid-cols-[minmax(220px,1.5fr)_100px_repeat(3,72px)_130px_130px] gap-4 border-b border-line bg-sunken px-5 py-3 lg:grid">
          {["model", "gauge", "repulsion", "control", "durability", "trend", "price"].map((key) => <span key={key} className="eyebrow">{t(key)}</span>)}
        </div>
        {items.map((string) => (
          <Link key={string.id} href={`/strings/${string.brandSlug}/${string.slug}`} className="group grid gap-4 border-b border-line px-5 py-5 no-underline last:border-0 hover:bg-brand-soft lg:grid-cols-[minmax(220px,1.5fr)_100px_repeat(3,72px)_130px_130px] lg:items-center">
            <div>
              <span className="text-caption text-tertiary">{string.brandName}</span>
              <h2 className="mt-0.5 font-display text-[19px] font-bold text-primary group-hover:text-brand">{string.name}</h2>
              <div className="mt-2 flex flex-wrap gap-1.5 lg:hidden"><Badge tone="neutral">{string.gaugeMm.toFixed(2)} mm</Badge><Badge tone="neutral">{t(`feel.${string.feel}`)}</Badge></div>
            </div>
            <span className="hidden font-mono text-[13px] text-primary lg:block">{string.crossGaugeMm ? `${string.gaugeMm.toFixed(2)} / ${string.crossGaugeMm.toFixed(2)}` : string.gaugeMm.toFixed(2)} mm</span>
            {[string.repulsion, string.control, string.durability].map((value, index) => <div key={index} className="hidden lg:block" aria-label={`${value} / 5`}><div className="h-1.5 overflow-hidden rounded-full bg-ink-200"><div className="h-full bg-green-700" style={{ width: `${value * 20}%` }} /></div><span className="mt-1 block font-mono text-[10px] text-tertiary">{value}/5</span></div>)}
            <div className="hidden lg:block"><PriceHistory data={string.history.map((point) => point.price)} height={34} /></div>
            <div className="flex items-baseline justify-between gap-3 lg:block"><span className="text-caption text-tertiary lg:hidden">{t("price")}</span><span className="price text-[17px] text-primary">{string.lowestPrice ? formatDong(string.lowestPrice) : "—"}</span><span className="ml-2 font-mono text-[10px] text-tertiary lg:block">{t("sellerCount", { count: string.sellerCount })}</span></div>
          </Link>
        ))}
      </div>
    </div>
  );
}
