import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Card, EmptyState, Eyebrow, TrustBadge, cx } from "@/components/ds/primitives";
import { SellerDirectorySkeleton } from "@/components/skeletons";
import { getSellerDirectory } from "@/lib/data/repository";
import {
  SELLER_SORTS,
  SELLER_TIERS,
  parseSellerQuery,
  rankSellers,
  sellerCities,
  sellerQueryString,
  type SellerDirectoryQuery,
  type SellerSort,
} from "@/lib/seller-ranking";
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

type SearchParams = Record<string, string | string[] | undefined>;

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

const SORT_LABEL: Record<SellerSort, string> = {
  rackets: "sortRackets",
  rating: "sortRating",
  brands: "sortBrands",
  tenure: "sortTenure",
};

/**
 * The directory, ranked.
 *
 * The heading and the tier explainer are the same for every URL, so they stay
 * in the prerendered shell; only the ranked list reads `searchParams`, behind
 * its own boundary — the catalogue's arrangement, for the catalogue's reason.
 */
export default async function SellersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("sellers");

  return (
    <div className="page-shell py-8 lg:py-12">
      <Eyebrow>{t("title")}</Eyebrow>
      <h1 className="display mt-1.5 max-w-[26ch] text-[27px] text-primary lg:text-h1">
        {t("subtitle")}
      </h1>

      {/* Tier is explained on the page, not buried in an FAQ. */}
      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        {SELLER_TIERS.map((tier) => (
          <div key={tier} className="rounded-md border border-line bg-card p-4">
            <dt>
              <TrustBadge state={TIER_STATE[tier]} label={t(TIER_LABEL[tier])} />
            </dt>
            <dd className="mt-2 text-body-sm text-secondary">{t(TIER_NOTE[tier])}</dd>
          </div>
        ))}
      </dl>

      <Suspense fallback={<SellerDirectorySkeleton />}>
        <SellerDirectory locale={locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SellerDirectory({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<SearchParams>;
}) {
  const [search, entries, t] = await Promise.all([
    searchParams,
    getSellerDirectory(),
    getTranslations("sellers"),
  ]);
  const cities = sellerCities(entries);
  const query = parseSellerQuery(search, cities);
  const ranked = rankSellers(entries, query);

  const href = (patch: Partial<SellerDirectoryQuery>) => ({
    pathname: "/sellers" as const,
    query: sellerQueryString({ ...query, ...patch }),
  });

  return (
    <section className="mt-8" aria-labelledby="seller-ranking">
      <h2 id="seller-ranking" className="sr-only">
        {t("rankingTitle")}
      </h2>

      <div className="space-y-3 rounded-md border border-line bg-card p-4">
        <ChipRow label={t("rankBy")}>
          {SELLER_SORTS.map((sort) => (
            <Chip key={sort} href={href({ sort })} active={query.sort === sort}>
              {t(SORT_LABEL[sort])}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label={t("city")}>
          <Chip href={href({ city: null })} active={query.city === null}>
            {t("allCities")}
          </Chip>
          {cities.map((city) => (
            <Chip key={city} href={href({ city })} active={query.city === city}>
              {city}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label={t("tier")}>
          <Chip href={href({ tier: null })} active={query.tier === null}>
            {t("allTiers")}
          </Chip>
          {SELLER_TIERS.map((tier) => (
            <Chip key={tier} href={href({ tier })} active={query.tier === tier}>
              {t(TIER_LABEL[tier])}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <p className="mt-5 font-mono text-[12px] tabular-nums text-tertiary">
        {t("rankingMeta", {
          shown: ranked.length,
          total: entries.length,
          sort: t(SORT_LABEL[query.sort]).toLowerCase(),
        })}
      </p>

      {ranked.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title={t("noMatchTitle")}
            body={t("noMatchBody", { count: entries.length })}
            action={
              <Link
                href={href({ city: null, tier: null })}
                className="text-body-sm font-semibold"
              >
                {t("clearFilters")}
              </Link>
            }
          />
        </div>
      ) : (
        <ol className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ranked.map((seller, index) => (
            <li key={seller.id}>
              <Card padding="md" interactive className="h-full">
                <Link href={`/sellers/${seller.slug}`} className="block h-full no-underline">
                  <div className="flex items-start gap-2.5">
                    <span
                      className="font-mono text-[13px] tabular-nums text-tertiary"
                      aria-label={t("rankPosition", { rank: index + 1 })}
                    >
                      #{index + 1}
                    </span>
                    <h3 className="font-display text-h4 font-semibold text-primary">
                      {seller.name}
                    </h3>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <TrustBadge
                      state={TIER_STATE[seller.tier]}
                      label={t(TIER_LABEL[seller.tier])}
                      title={t(TIER_NOTE[seller.tier])}
                    />
                    <span data-seller-city={seller.city} className="font-mono text-[11px] text-tertiary">
                      {seller.city} · {t("sinceYear", { year: seller.since })}
                    </span>
                  </div>
                  <p className="mt-3 text-body-sm text-secondary">{seller.about[locale]}</p>
                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
                    <Stat
                      label={t("statRackets")}
                      value={String(seller.racketCount)}
                      active={query.sort === "rackets"}
                    />
                    <Stat
                      label={t("statBrands")}
                      value={String(seller.brandCount)}
                      active={query.sort === "brands"}
                    />
                    <Stat
                      label={t("rating")}
                      value={seller.rating > 0 ? seller.rating.toFixed(1) : "—"}
                      active={query.sort === "rating"}
                    />
                  </dl>
                </Link>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-4 text-caption text-tertiary">{t("rankingNote")}</p>
    </section>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow w-full text-tertiary sm:w-20">{label}</span>
      {children}
    </div>
  );
}

/** A filter is a link: crawlable, shareable, and it works with no JavaScript. */
function Chip({
  href,
  active,
  children,
}: {
  href: { pathname: "/sellers"; query: Record<string, string> };
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cx(
        "inline-flex h-11 items-center rounded-md border px-3 text-[13px] font-semibold no-underline",
        "transition-colors duration-[90ms] lg:h-8",
        active
          ? "border-line-brand bg-brand-soft text-brand"
          : "border-line bg-card text-primary hover:border-line-strong",
      )}
    >
      {children}
    </Link>
  );
}

function Stat({
  label,
  value,
  active = false,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cx(
          "font-mono text-[13px] tabular-nums text-primary",
          active && "font-semibold",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
