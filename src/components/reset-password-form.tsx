"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button, Card, Eyebrow } from "@/components/ds/primitives";
import { Field, Input } from "@/components/ds/forms";
import { updatePassword, type AuthState } from "@/lib/auth-actions";
import type { Locale } from "@/i18n/routing";

export function ResetPasswordForm({
  locale,
  configured,
}: {
  locale: Locale;
  configured: boolean;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    updatePassword,
    {},
  );

  return (
    <Card padding="lg" className="mx-auto w-full max-w-[420px]">
      <Eyebrow as="h1">{t("resetPasswordTitle")}</Eyebrow>
      <p className="mt-2 text-body-sm text-secondary">
        {t("resetPasswordPrompt")}
      </p>

      <form action={action} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="locale" value={locale} />

        <Field label={t("newPassword")} htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            size="lg"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        <Field label={t("confirmPassword")} htmlFor="confirmPassword">
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            size="lg"
            required
            minLength={8}
            autoComplete="new-password"
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
            {state.error === "passwordMismatch"
              ? t("passwordMismatch")
              : state.error === "config"
                ? t("errorConfig")
                : t("errorGeneric")}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          disabled={pending || !configured}
        >
          {t("updatePasswordCta")}
        </Button>
      </form>

      <p className="mt-5 text-center text-body-sm">
        <Link href="/sign-in">{t("backToSignIn")}</Link>
      </p>
    </Card>
  );
}
