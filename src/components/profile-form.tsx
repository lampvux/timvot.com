"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card } from "@/components/ds/primitives";
import { Field, Input, Select } from "@/components/ds/forms";
import { updateProfile, type ProfileState } from "@/lib/profile-actions";

export function ProfileForm({
  email,
  displayName,
  skillLevel,
}: {
  email: string;
  displayName: string;
  skillLevel: string;
}) {
  const t = useTranslations("profile");
  const [state, action, pending] = useActionState<ProfileState, FormData>(
    updateProfile,
    {},
  );

  return (
    <Card padding="lg" className="mt-6 max-w-[640px]">
      <form action={action} className="grid gap-5">
        <Field label={t("email")} htmlFor="profileEmail" hint={t("emailHint")}>
          <Input
            id="profileEmail"
            type="email"
            size="lg"
            value={email}
            readOnly
            disabled
          />
        </Field>

        <Field label={t("displayName")} htmlFor="displayName">
          <Input
            id="displayName"
            name="displayName"
            size="lg"
            minLength={2}
            maxLength={80}
            defaultValue={displayName}
            autoComplete="name"
            required
          />
        </Field>

        <Field label={t("skillLevel")} htmlFor="skillLevel">
          <Select
            id="skillLevel"
            name="skillLevel"
            size="lg"
            defaultValue={skillLevel}
            options={[
              { value: "", label: t("skillNotSet") },
              { value: "beginner", label: t("skillBeginner") },
              { value: "intermediate", label: t("skillIntermediate") },
              { value: "advanced", label: t("skillAdvanced") },
            ]}
          />
        </Field>

        {state.error && (
          <p role="alert" className="rounded-md border border-[color-mix(in_srgb,var(--signal-risk)_30%,transparent)] bg-risk-bg px-3 py-2.5 text-body-sm text-risk">
            {state.error === "auth"
              ? t("errorAuth")
              : state.error === "config"
                ? t("errorConfig")
                : state.error === "invalid"
                  ? t("errorInvalid")
                  : t("errorGeneric")}
          </p>
        )}

        {state.notice === "saved" && (
          <p role="status" className="rounded-md border border-green-200 bg-brand-soft px-3 py-2.5 text-body-sm text-brand">
            {t("saved")}
          </p>
        )}

        <div>
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
