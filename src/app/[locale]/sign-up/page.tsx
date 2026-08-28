import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { AuthForm } from "@/components/auth-form";
import { AuthFormSkeleton } from "@/components/skeletons";
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

/** The form is the same for everyone; only the callback error or notice in
 *  `searchParams` is per-request, so only that streams. */
export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <SignUpBody locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}

async function SignUpBody({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  setRequestLocale(locale);
  const { error, notice } = await searchParams;

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
