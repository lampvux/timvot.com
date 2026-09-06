export const instant = false;

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { SellerListingForm } from "@/components/seller-listing-form";
import {
  ButtonLinkStyle,
  EmptyState,
  Eyebrow,
} from "@/components/ds/primitives";
import { loadSnapshot } from "@/lib/data/repository";
import { createClient, getUser } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sellerListing" });
  return { title: t("title") };
}
export default async function NewSellerListingPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("sellerListing");
  const tc = await getTranslations("common");
  const user = await getUser();
  const supabase = user ? await createClient() : null;
  const [{ data: profile }, { data: seller }] = supabase
    ? await Promise.all([
        supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle(),
        supabase.from("sellers").select("id").eq("owner_id", user!.id).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  if (!user || profile?.role !== "seller" || !seller?.id) {
    return (
      <div className="page-shell py-12 lg:py-20">
        <div className="mx-auto max-w-[520px]">
          <EmptyState
            title={t("notApprovedTitle")}
            body={t("notApprovedBody")}
            action={
              <Link
                href={user ? "/seller" : "/sign-in"}
                className={ButtonLinkStyle({ variant: "primary", size: "md" })}
              >
                {user ? t("viewApplication") : tc("signIn")}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const snapshot = await loadSnapshot();
  const variants = snapshot.rackets.flatMap((racket) =>
    racket.variants.map((variant) => ({
      value: variant.id,
      label: `${racket.brandName} · ${racket.name} — ${variant.weightClass} ${variant.gripSize}${variant.sku ? ` · ${variant.sku}` : ""}`,
    })),
  );

  return (
    <div className="page-shell py-8 lg:py-12">
      <Eyebrow>{t("eyebrow")}</Eyebrow>
      <h1 className="display mt-1.5 text-[27px] text-primary lg:text-h1">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-[680px] text-body text-secondary">{t("intro")}</p>
      <SellerListingForm locale={locale} variants={variants} />
    </div>
  );
}
