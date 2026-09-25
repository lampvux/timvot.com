import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  Badge,
  EmptyState,
  Eyebrow,
  TrustBadge,
} from "@/components/ds/primitives";
import { getOffersForSeller, getSeller, getSellers } from "@/lib/data/repository";
import { CONDITION_MESSAGE_KEY, formatDong } from "@/lib/format";
import type { SellerTier } from "@/lib/types";

/**
 * One shared App Shell for this route instead of one prefetch per link. The
 * directory and the catalogue both render many links here, and the shell is
 * reused across all of them — see the note on the racket detail route, which
 * is where the 2,53 MB of speculative gallery downloads was measured.
 */
export const prefetch = "partial";

export async function generateStaticParams() {
  const sellers = await getSellers();
  return sellers.map((seller) => ({ slug: seller.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const seller = await getSeller(slug);
  if (!seller) return {};
  return { title: seller.name, description: seller.about[locale] };
}

const TIER_STATE: Record<SellerTier, "verified" | "authorised" | "unverified"> = {
  authorised: "authorised",
  verified: "verified",
  new: "unverified",
};

export default async function SellerPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const seller = await getSeller(slug);
  if (!seller) notFound();

  const t = await getTranslations("sellers");
  const ts = await getTranslations("specs");
  const te = await getTranslations("enums");
  const tc = await getTranslations("common");

  const offers = await getOffersForSeller(seller.id);
  const live = offers.filter((offer) => offer.status === "live");
  // The directory ranks on this number, so the page states the same one.
  const racketsInStock = new Set(
    live.filter((offer) => offer.qtyAvailable > 0).map((offer) => offer.racketId),
  ).size;

  const tierKey =
    seller.tier === "authorised"
      ? "tierAuthorised"
      : seller.tier === "verified"
        ? "tierVerified"
        : "tierNew";
  const noteKey =
    seller.tier === "authorised"
      ? "tierAuthorisedNote"
      : seller.tier === "verified"
        ? "tierVerifiedNote"
        : "tierNewNote";

  return (
    <div className="page-shell py-8 lg:py-12">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display text-[27px] text-primary lg:text-h1">
              {seller.name}
            </h1>
            <TrustBadge
              state={TIER_STATE[seller.tier]}
              label={t(tierKey)}
              title={t(noteKey)}
            />
          </div>
          <p className="mt-1.5 font-mono text-[12px] text-tertiary">
            {t("location", { city: seller.city })} ·{" "}
            {t("sinceYear", { year: seller.since })}
          </p>
          <p className="mt-3 max-w-[68ch] text-body text-secondary">
            {seller.about[locale]}
          </p>
          <p className="mt-2 max-w-[68ch] text-body-sm text-tertiary">
            {t(noteKey)}
          </p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: t("inventory"), value: String(live.length) },
          { label: t("statRackets"), value: String(racketsInStock) },
          {
            label: t("rating"),
            value: seller.rating > 0 ? seller.rating.toFixed(1) : "—",
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-md border border-line bg-card p-4">
            <dt className="eyebrow">{stat.label}</dt>
            <dd className="mt-1 font-display text-h2 font-extrabold tabular-nums text-primary">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-8" aria-labelledby="inventory">
        <Eyebrow as="h2" className="mb-3">
          <span id="inventory">{t("inventory")}</span>
        </Eyebrow>

        {live.length === 0 ? (
          <EmptyState title={t("emptyInventory")} body={t("subtitle")} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-card">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-sunken">
                  {[
                    ts("brand"),
                    ts("variant"),
                    ts("condition"),
                    ts("price"),
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
                {live.map((offer) => (
                  <tr key={offer.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/rackets/${offer.racket.brandSlug}/${offer.racket.slug}`}
                        className="text-[14px] font-semibold text-primary no-underline hover:text-brand"
                      >
                        {offer.racket.name}
                      </Link>
                      <div className="text-caption text-tertiary">
                        {offer.racket.brandName}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-secondary">
                      {offer.variant.weightClass} {offer.variant.gripSize}
                    </td>
                    <td className="px-4 py-3">
                      {offer.condition === "new" ? (
                        <span className="text-body-sm text-ink-700">
                          {te("conditionNew")}
                        </span>
                      ) : (
                        <Badge tone="used">
                          {te(CONDITION_MESSAGE_KEY[offer.condition])}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="price text-[17px] text-primary">
                        {formatDong(offer.price)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/rackets/${offer.racket.brandSlug}/${offer.racket.slug}`}
                        className="text-body-sm font-semibold no-underline"
                      >
                        {tc("view")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
