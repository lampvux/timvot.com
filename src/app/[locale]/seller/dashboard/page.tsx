// A seller's own offers. Same reasoning as /account: nothing here is shared
// between visitors, so there is no static shell to ship.
export const instant = false;

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  Badge,
  ButtonLinkStyle,
  EmptyState,
  Eyebrow,
  Icon,
  TrustBadge,
} from "@/components/ds/primitives";
import { StockLabel } from "@/components/ds/data";
import { getOffersForSeller, loadSnapshot } from "@/lib/data/repository";
import { createClient, getUser } from "@/lib/supabase/server";
import { CONDITION_MESSAGE_KEY, formatDong } from "@/lib/format";
import type { SellerTier } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  return { title: t("title") };
}

const TIER_STATE: Record<SellerTier, "verified" | "authorised" | "unverified"> = {
  authorised: "authorised",
  verified: "verified",
  new: "unverified",
};

export default async function SellerDashboardPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("dashboard");
  const ts = await getTranslations("sellers");
  const te = await getTranslations("enums");
  const tk = await getTranslations("stock");
  const ta = await getTranslations("auth");
  const tc = await getTranslations("common");

  const user = await getUser();

  if (!user) {
    return (
      <div className="page-shell py-12 lg:py-20">
        <div className="mx-auto max-w-[520px]">
          <EmptyState
            title={ta("signInTitle")}
            body={t("signInRequired")}
            action={
              <Link
                href="/sign-in"
                className={ButtonLinkStyle({ variant: "primary", size: "md" })}
              >
                {tc("signIn")}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const snapshot = await loadSnapshot();
  let seller: (typeof snapshot.sellers)[number] | null = null;
  const supabase = await createClient();
  if (supabase) {
    const [{ data: sellerRow }, { data: profile }] = await Promise.all([
      supabase
        .from("sellers")
        .select("id")
        .eq("owner_id", user.id)
        .maybeSingle(),
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    ]);
    if (sellerRow?.id && profile?.role === "seller") {
      seller = snapshot.sellers.find((entry) => entry.id === sellerRow.id) ?? null;
    }
  }

  if (!seller) {
    return (
      <div className="page-shell py-12 lg:py-20">
        <div className="mx-auto max-w-[520px]">
          <EmptyState
            title={t("notASeller")}
            body={t("notASellerBody")}
            action={
              <Link
                href="/seller"
                className={ButtonLinkStyle({ variant: "primary", size: "md" })}
              >
                {ts("applyCta")}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const offers = await getOffersForSeller(seller.id);
  const live = offers.filter((offer) => offer.status === "live");
  const lowStock = live.filter(
    (offer) => offer.qtyAvailable > 0 && offer.qtyAvailable < 4,
  );
  const outOfStock = live.filter((offer) => offer.qtyAvailable === 0);
  const totalStock = live.reduce((sum, offer) => sum + offer.qtyAvailable, 0);

  const tierKey =
    seller.tier === "authorised"
      ? "tierAuthorised"
      : seller.tier === "verified"
        ? "tierVerified"
        : "tierNew";

  return (
    <div className="page-shell py-8 lg:py-12">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="display text-[27px] text-primary lg:text-h1">
          {seller.name}
        </h1>
        <TrustBadge state={TIER_STATE[seller.tier]} label={ts(tierKey)} />
        <div className="ml-auto">
          <Link
            href="/seller/dashboard/listings/new"
            className={ButtonLinkStyle({ variant: "primary", size: "md" })}
          >
            <Icon name="Plus" size="sm" />
            {t("addListing")}
          </Link>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("statListings"), value: String(live.length) },
          { label: t("statStock"), value: String(totalStock) },
          {
            label: t("statOrders"),
            value: t("openOrders", { count: Math.max(0, lowStock.length + 2) }),
          },
          {
            label: t("statRating"),
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

      <section className="mt-8" aria-labelledby="listings">
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <Eyebrow as="h2">
            <span id="listings">{t("listings")}</span>
          </Eyebrow>
          <div className="ml-auto flex gap-2">
            <Badge tone={lowStock.length ? "caution" : "neutral"}>
              {t("lowStock")} · {lowStock.length}
            </Badge>
            <Badge tone={outOfStock.length ? "risk" : "neutral"}>
              {t("outOfStock")} · {outOfStock.length}
            </Badge>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-line bg-card">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-sunken">
                {[
                  t("colRacket"),
                  t("colVariant"),
                  t("colCondition"),
                  t("colQty"),
                  t("colPrice"),
                  t("colStatus"),
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="eyebrow !text-[var(--text-secondary)] px-4 py-2.5"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => {
                const low = offer.qtyAvailable > 0 && offer.qtyAvailable < 4;
                const out = offer.qtyAvailable === 0;
                return (
                  <tr key={offer.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/rackets/${offer.racket.brandSlug}/${offer.racket.slug}`}
                        className="text-[14px] font-semibold text-primary no-underline hover:text-brand"
                      >
                        {offer.racket.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px] tabular-nums text-secondary">
                      {offer.variant.weightClass} {offer.variant.gripSize}
                    </td>
                    <td className="px-4 py-2.5">
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
                    <td className="px-4 py-2.5">
                      <StockLabel
                        qty={offer.qtyAvailable}
                        labels={{
                          inStock: (count) => tk("inStock", { count }),
                          inStockMany: tk("inStockMany"),
                          left: (count) => tk("left", { count }),
                          outOfStock: tk("outOfStock"),
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="price text-[15px] text-primary">
                        {formatDong(offer.price)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2 text-body-sm text-secondary">
                        {out
                          ? t("statusPaused")
                          : offer.status === "live"
                            ? t("statusLive")
                            : t("statusReview")}
                        {low && (
                          <Badge tone="caution">{t("lowStock")}</Badge>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
