import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Card, Eyebrow, TrustBadge } from "@/components/ds/primitives";
import { getSellers } from "@/lib/data/repository";
import type { SellerTier } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sellers" });
  return { title: t("title") };
}

const TIER_STATE: Record<SellerTier, "verified" | "authorised" | "unverified"> = {
  authorised: "authorised",
  verified: "verified",
  new: "unverified",
};

const TIER_LABEL: Record<SellerTier, string> = {
  authorised: "tierAuthorised",
  verified: "tierVerified",
  new: "tierNew",
};

const TIER_NOTE: Record<SellerTier, string> = {
  authorised: "tierAuthorisedNote",
  verified: "tierVerifiedNote",
  new: "tierNewNote",
};

export default async function SellersPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("sellers");
  const sellers = await getSellers();

  return (
    <div className="page-shell py-8 lg:py-12">
      <Eyebrow>{t("title")}</Eyebrow>
      <h1 className="display mt-1.5 max-w-[26ch] text-[27px] text-primary lg:text-h1">
        {t("subtitle")}
      </h1>

      {/* Tier is explained on the page, not buried in an FAQ. */}
      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        {(["authorised", "verified", "new"] as SellerTier[]).map((tier) => (
          <div key={tier} className="rounded-md border border-line bg-card p-4">
            <dt>
              <TrustBadge state={TIER_STATE[tier]} label={t(TIER_LABEL[tier])} />
            </dt>
            <dd className="mt-2 text-body-sm text-secondary">
              {t(TIER_NOTE[tier])}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {sellers.map((seller) => (
          <Card key={seller.id} padding="md" interactive>
            <Link
              href={`/sellers/${seller.slug}`}
              className="block no-underline"
            >
              <div className="flex items-start gap-2.5">
                <h2 className="font-display text-h4 font-semibold text-primary">
                  {seller.name}
                </h2>
              </div>
              <div className="mt-2">
                <TrustBadge
                  state={TIER_STATE[seller.tier]}
                  label={t(TIER_LABEL[seller.tier])}
                  title={t(TIER_NOTE[seller.tier])}
                />
              </div>
              <p className="mt-3 text-body-sm text-secondary">
                {seller.about[locale]}
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
                <div>
                  <dt className="eyebrow">{t("rating")}</dt>
                  <dd className="font-mono text-[13px] tabular-nums text-primary">
                    {seller.rating > 0 ? seller.rating.toFixed(1) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">{t("orders")}</dt>
                  <dd className="font-mono text-[13px] tabular-nums text-primary">
                    {seller.ordersCount}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">{t("city")}</dt>
                  <dd className="truncate font-mono text-[13px] text-primary">
                    {seller.city}
                  </dd>
                </div>
              </dl>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
