"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button, Card, Eyebrow } from "@/components/ds/primitives";
import { Field, Input } from "@/components/ds/forms";
import { requestPasswordReset, type AuthState } from "@/lib/auth-actions";
import type { Locale } from "@/i18n/routing";

export function ForgotPasswordForm({
  locale,
  configured,
}: {
  locale: Locale;
  configured: boolean;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    {},
  );

  return (
    <Card padding="lg" className="mx-auto w-full max-w-[420px]">
      <Eyebrow as="h1">{t("forgotPasswordTitle")}</Eyebrow>
      <p className="mt-2 text-body-sm text-secondary">
        {t("forgotPasswordPrompt")}
      </p>

      <form action={action} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="locale" value={locale} />

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

        {!configured && (
          <p className="rounded-md border border-[color-mix(in_srgb,var(--signal-caution)_30%,transparent)] bg-caution-bg px-3 py-2.5 text-body-sm text-caution">
            {t("errorConfig")}
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

        {state.notice && (
          <p className="rounded-md border border-green-200 bg-brand-soft px-3 py-2.5 text-body-sm text-brand">
            {t("checkResetEmail")}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={pending || !configured}
        >
          {t("sendResetLink")}
        </Button>
      </form>

      <p className="mt-5 text-center text-body-sm">
        <Link href="/sign-in">{t("backToSignIn")}</Link>
      </p>
    </Card>
  );
}
