export const instant = false;

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { ProfileForm } from "@/components/profile-form";
import {
  ButtonLinkStyle,
  EmptyState,
  Eyebrow,
} from "@/components/ds/primitives";
import { createClient, getUser } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile" });
  return { title: t("title") };
}
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("profile");
  const ta = await getTranslations("auth");
  const tc = await getTranslations("common");
  const user = await getUser();

  if (!user) {
    return (
      <div className="page-shell py-12 lg:py-20">
        <div className="mx-auto max-w-[420px]">
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
  const { data: profile } = supabase
    ? await supabase
        .from("profiles")
        .select("display_name, skill_level")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="page-shell py-8 lg:py-12">
      <Eyebrow>{t("eyebrow")}</Eyebrow>
      <h1 className="display mt-1.5 text-[27px] text-primary lg:text-h1">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-[620px] text-body text-secondary">
        {t("intro")}
      </p>

      <ProfileForm
        email={user.email ?? ""}
        displayName={
          profile?.display_name ||
          String(user.user_metadata?.display_name ?? "").trim()
        }
        skillLevel={profile?.skill_level ?? ""}
      />
    </div>
  );
}
