export const instant = false;

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  Badge,
  ButtonLinkStyle,
  Card,
  EmptyState,
  Eyebrow,
  Icon,
} from "@/components/ds/primitives";
import {
  SellerApplicationForm,
  type SellerApplicationValues,
} from "@/components/seller-application-form";
import { createClient, getUser } from "@/lib/supabase/server";

interface SellerApplication extends SellerApplicationValues {
  id: string;
  status: "pending" | "approved" | "rejected";
  review_notes: string | null;
  created_at: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sellerApplication" });
  return { title: t("title") };
}

export default async function SellerApplicationPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("sellerApplication");
  const ta = await getTranslations("auth");
  const tc = await getTranslations("common");
  const user = await getUser();

  if (!user) {
    return (
      <div className="page-shell py-12 lg:py-20">
        <div className="mx-auto max-w-[480px]">
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

  const supabase = await createClient();
  const [{ data: application }, { data: seller }] = supabase
    ? await Promise.all([
        supabase
          .from("seller_applications")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("sellers").select("id, name").eq("owner_id", user.id).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];
  const current = application as SellerApplication | null;

  return (
    <div className="page-shell py-8 lg:py-12">
      <div className="max-w-[760px]">
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h1 className="display mt-1.5 text-[27px] text-primary lg:text-h1">
          {t("title")}
        </h1>
        <p className="mt-2 text-body text-secondary">{t("intro")}</p>
      </div>

      {(seller || current?.status === "approved") && (
        <Card padding="lg" tone="brand" className="mt-6 max-w-[760px]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-brand"><Icon name="BadgeCheck" /></span>
            <div>
              <Badge tone="brand">{t("approvedBadge")}</Badge>
              <h2 className="display mt-2 text-h3 text-primary">{t("approvedTitle")}</h2>
              <p className="mt-1.5 text-body-sm text-secondary">
                {t("approvedBody", { name: seller?.name ?? current?.business_name ?? "" })}
              </p>
              <Link
                href="/seller/dashboard"
                className={`${ButtonLinkStyle({ variant: "primary", size: "md" })} mt-4`}
              >
                {t("openDashboard")}
              </Link>
            </div>
          </div>
        </Card>
      )}

      {!seller && current?.status === "pending" && (
        <Card padding="lg" className="mt-6 max-w-[760px]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-caution"><Icon name="Info" /></span>
            <div>
              <Badge tone="caution">{t("pendingBadge")}</Badge>
              <h2 className="display mt-2 text-h3 text-primary">{t("pendingTitle")}</h2>
              <p className="mt-1.5 text-body-sm text-secondary">{t("pendingBody")}</p>
            </div>
          </div>
        </Card>
      )}

      {!seller && current?.status === "rejected" && (
        <>
          <Card padding="lg" className="mt-6 max-w-[760px] border-[color-mix(in_srgb,var(--signal-risk)_30%,transparent)] bg-risk-bg">
            <Badge tone="risk">{t("rejectedBadge")}</Badge>
            <h2 className="display mt-2 text-h3 text-primary">{t("rejectedTitle")}</h2>
            <p className="mt-1.5 text-body-sm text-secondary">
              {current.review_notes || t("rejectedBody")}
            </p>
          </Card>
          <div className="max-w-[860px]">
            <SellerApplicationForm initialValues={current} />
          </div>
        </>
      )}

      {!seller && !current && (
        <div className="max-w-[860px]">
          <SellerApplicationForm />
        </div>
      )}
    </div>
  );
}
