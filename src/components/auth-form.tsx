"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button, Card, Eyebrow } from "@/components/ds/primitives";
import { Field, Input } from "@/components/ds/forms";
import { signIn, signUp, type AuthState } from "@/lib/auth-actions";
import { OAuthButtons } from "@/components/oauth-buttons";
import type { OAuthProvider } from "@/lib/supabase/config";
import type { Locale } from "@/i18n/routing";

export function AuthForm({
  mode,
  locale,
  configured,
  providers = [],
  callbackError,
  initialNotice,
}: {
  mode: "sign-in" | "sign-up";
  locale: Locale;
  configured: boolean;
  providers?: OAuthProvider[];
  /** Reason forwarded by /auth/callback when a round trip failed. */
  callbackError?: string;
  /** Notice from searchParams (e.g. passwordUpdated). */
  initialNotice?: string;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "sign-in" ? signIn : signUp,
    {},
  );

  const activeNotice = state.notice || initialNotice;

  return (
    <Card padding="lg" className="mx-auto w-full max-w-[420px]">
      <Eyebrow as="h1">
        {mode === "sign-in" ? t("signInTitle") : t("signUpTitle")}
      </Eyebrow>
      <p className="mt-2 text-body-sm text-secondary">{t("why")}</p>

      <form action={action} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="locale" value={locale} />

        {mode === "sign-up" && (
          <Field label={t("displayName")} htmlFor="displayName">
            <Input id="displayName" name="displayName" size="lg" autoComplete="name" />
          </Field>
        )}

        <Field label={t("email")} htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            size="lg"
            required
            autoComplete="email"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="text-[13.5px] font-semibold leading-none text-primary"
            >
              {t("password")}
            </label>
            {mode === "sign-in" && (
              <Link
                href="/forgot-password"
                className="text-[12px] font-medium text-brand no-underline hover:underline"
              >
                {t("forgotPassword")}
              </Link>
            )}
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            size="lg"
            required
            minLength={8}
            autoComplete={
              mode === "sign-in" ? "current-password" : "new-password"
            }
          />
        </div>

        {!configured && (
          <p className="rounded-md border border-[color-mix(in_srgb,var(--signal-caution)_30%,transparent)] bg-caution-bg px-3 py-2.5 text-body-sm text-caution">
            {t("errorConfig")}
          </p>
        )}

        {callbackError && (
          <p
            role="alert"
            className="rounded-md border border-[color-mix(in_srgb,var(--signal-risk)_30%,transparent)] bg-risk-bg px-3 py-2.5 text-body-sm text-risk"
          >
            {t("errorProvider")} <span className="text-secondary">{callbackError}</span>
          </p>
        )}

        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-[color-mix(in_srgb,var(--signal-risk)_30%,transparent)] bg-risk-bg px-3 py-2.5 text-body-sm text-risk"
          >
            {state.error === "config" ? t("errorConfig") : t("errorGeneric")}
          </p>
        )}

        {activeNotice && (
          <p className="rounded-md border border-green-200 bg-brand-soft px-3 py-2.5 text-body-sm text-brand">
            {activeNotice === "passwordUpdated"
              ? t("passwordUpdated")
              : activeNotice === "checkResetEmail"
                ? t("checkResetEmail")
                : t("checkEmail")}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={pending || !configured}
        >
          {mode === "sign-in" ? t("signInCta") : t("signUpCta")}
        </Button>
      </form>

      <OAuthButtons providers={providers} locale={locale} disabled={!configured} />

      <p className="mt-5 text-center text-body-sm">
        <Link href={mode === "sign-in" ? "/sign-up" : "/sign-in"}>
          {mode === "sign-in" ? t("toSignUp") : t("toSignIn")}
        </Link>
      </p>
    </Card>
  );
}
