// Reads searchParams to surface a callback error or notice. Small enough to
// Suspense-split in phase 5; opted out for now (docs/performance-plan.md).
export const instant = false;

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("resetPasswordTitle") };
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="page-shell py-12 lg:py-20">
      <ResetPasswordForm
        locale={locale}
        configured={isSupabaseConfigured}
      />
    </div>
  );
}
