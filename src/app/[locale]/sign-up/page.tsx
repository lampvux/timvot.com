import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { AuthForm } from "@/components/auth-form";
import { enabledOAuthProviders, isSupabaseConfigured } from "@/lib/supabase/config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("signUpTitle") };
}

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { locale } = await params;
  const { error, notice } = await searchParams;
  setRequestLocale(locale);

  return (
    <div className="page-shell py-12 lg:py-20">
      <AuthForm
        mode="sign-up"
        locale={locale}
        configured={isSupabaseConfigured}
        providers={enabledOAuthProviders}
        callbackError={error}
        initialNotice={notice}
      />
    </div>
  );
}
