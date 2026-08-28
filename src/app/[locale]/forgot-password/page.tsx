// Reads searchParams to surface a callback error or notice. Small enough to
// Suspense-split in phase 5; opted out for now (docs/performance-plan.md).
export const instant = false;

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("forgotPasswordTitle") };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="page-shell py-12 lg:py-20">
      <ForgotPasswordForm
        locale={locale}
        configured={isSupabaseConfigured}
      />
    </div>
  );
}
