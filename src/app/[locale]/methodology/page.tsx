import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Card, Eyebrow } from "@/components/ds/primitives";
import { SpecRow } from "@/components/ds/data";
import {
  AXIS_WEIGHT,
  MIN_REVIEWS_FOR_PLAYER_SCORE,
  REVIEW_WEIGHT,
} from "@/lib/court-score";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "methodology" });
  return { title: t("title") };
}

/**
 * The trust page. People trust a number they can interrogate, so the actual
 * weights are here — not a paraphrase of them.
 */
export default async function MethodologyPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("methodology");
  const te = await getTranslations("enums");
  const tr = await getTranslations("racket");

  return (
    <div className="page-shell py-8 lg:py-12">
      <div className="max-w-[68ch]">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h1 className="display mt-1.5 text-[30px] text-primary lg:text-h1">
          {t("title")}
        </h1>
        <p className="mt-3 text-body-lg text-secondary">{t("intro")}</p>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Card padding="lg">
          <Eyebrow as="h2">{t("specHalf")}</Eyebrow>
          <p className="mt-2.5 text-body text-secondary">{t("specBody")}</p>
          <ul className="mt-4 flex flex-col gap-2 font-mono text-[13px] text-primary">
            <li>{t("axisPower")}</li>
            <li>{t("axisSpeed")}</li>
            <li>{t("axisControl")}</li>
            <li>{t("axisComfort")}</li>
          </ul>

          <div className="mt-5">
            <Eyebrow as="h3">{t("axisWeightsTitle")}</Eyebrow>
            <p className="mt-1.5 text-body-sm text-secondary">
              {t("axisWeightsBody")}
            </p>
            <dl className="mt-2">
              <SpecRow
                label={tr("power")}
                value={`${Math.round(AXIS_WEIGHT.power * 100)}%`}
              />
              <SpecRow
                label={tr("control")}
                value={`${Math.round(AXIS_WEIGHT.control * 100)}%`}
              />
              <SpecRow
                label={tr("speed")}
                value={`${Math.round(AXIS_WEIGHT.speed * 100)}%`}
              />
              <SpecRow
                label={tr("comfort")}
                value={`${Math.round(AXIS_WEIGHT.comfort * 100)}%`}
                border={false}
              />
            </dl>
          </div>
        </Card>

        <Card padding="lg">
          <Eyebrow as="h2">{t("playerHalf")}</Eyebrow>
          <p className="mt-2.5 text-body text-secondary">{t("playerBody")}</p>

          <div className="mt-4">
            <Eyebrow as="h3">{t("weightsTitle")}</Eyebrow>
            <dl className="mt-1.5">
              <SpecRow
                label={te("tierPurchase")}
                value={`${REVIEW_WEIGHT.purchase}×`}
              />
              <SpecRow label={te("tierOwner")} value={`${REVIEW_WEIGHT.owner}×`} />
              <SpecRow
                label={te("tierCommunity")}
                value={`${REVIEW_WEIGHT.community}×`}
                border={false}
              />
            </dl>
          </div>

          <p className="mt-4 text-body-sm text-secondary">
            {t("minReviews", { count: MIN_REVIEWS_FOR_PLAYER_SCORE })}
          </p>
        </Card>
      </div>

      <Card padding="lg" tone="brand" className="mt-5">
        <Eyebrow as="h2" className="!text-brand">
          {t("noSaleTitle")}
        </Eyebrow>
        <p className="mt-2.5 max-w-[84ch] text-body-lg text-ink-800">
          {t("noSaleBody")}
        </p>
      </Card>

      <p className="mt-6 max-w-[68ch] font-mono text-[12px] text-tertiary">
        src/lib/court-score.ts
      </p>
    </div>
  );
}
