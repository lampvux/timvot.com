import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Badge, Card, Eyebrow } from "@/components/ds/primitives";
import { getGuides } from "@/lib/data/repository";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guides" });
  return { title: t("title") };
}

export default async function GuidesPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("guides");
  const guides = await getGuides();

  return (
    <div className="page-shell py-8 lg:py-12">
      <Eyebrow>{t("title")}</Eyebrow>
      <h1 className="display mt-1.5 max-w-[24ch] text-[27px] text-primary lg:text-h1">
        {t("subtitle")}
      </h1>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        {guides.length === 0 && <p className="text-secondary">{t("empty")}</p>}
        {guides.map((guide) => (
          <Card
            key={guide.slug}
            padding="lg"
            tone={guide.tone === "used" ? "used" : "default"}
            interactive
            className="relative"
          >
            {guide.tone === "used" && (
              <div className="mb-2.5">
                <Badge tone="used">{t("usedTag")}</Badge>
              </div>
            )}
            <h2 className="font-display text-h3 font-bold text-primary">
              {guide.hasContent ? <Link href={`/guides/${guide.slug}`} className="after:absolute after:inset-0">{guide.title[locale]}</Link> : guide.title[locale]}
            </h2>
            <p className="mt-2 text-body text-secondary">
              {guide.excerpt[locale]}
            </p>
            <p className="mt-3 font-mono text-[11px] tabular-nums text-tertiary">
              {guide.hasContent ? `${t("readTime", { minutes: guide.readMinutes })} · ${t("readGuide")} →` : t("comingSoon")}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
