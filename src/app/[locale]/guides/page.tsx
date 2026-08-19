import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Badge, Card, Eyebrow } from "@/components/ds/primitives";
import { getGuides } from "@/lib/data/repository";

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
        {guides.map((guide) => (
          <Card
            key={guide.slug}
            padding="lg"
            tone={guide.tone === "used" ? "used" : "default"}
            interactive
          >
            {guide.tone === "used" && (
              <div className="mb-2.5">
                <Badge tone="used">{t("usedTag")}</Badge>
              </div>
            )}
            <h2 className="font-display text-h3 font-bold text-primary">
              {guide.title[locale]}
            </h2>
            <p className="mt-2 text-body text-secondary">
              {guide.excerpt[locale]}
            </p>
            <p className="mt-3 font-mono text-[11px] tabular-nums text-tertiary">
              {t("readTime", { minutes: guide.readMinutes })}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
