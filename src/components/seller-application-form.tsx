"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Eyebrow } from "@/components/ds/primitives";
import {
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ds/forms";
import {
  submitSellerApplication,
  type SellerApplicationState,
} from "@/lib/seller-actions";

export interface SellerApplicationValues {
  business_type?: string;
  business_name?: string;
  contact_name?: string;
  phone?: string;
  city?: string;
  address?: string;
  tax_id?: string | null;
  website_url?: string | null;
  years_in_business?: number;
  inventory_summary?: string;
}
export function SellerApplicationForm({
  initialValues,
}: {
  initialValues?: SellerApplicationValues | null;
}) {
  const t = useTranslations("sellerApplication");
  const [state, action, pending] = useActionState<
    SellerApplicationState,
    FormData
  >(submitSellerApplication, {});

  return (
    <Card padding="lg" className="mt-6">
      <div className="mb-5 border-b border-line pb-4">
        <Eyebrow as="h2">{t("formEyebrow")}</Eyebrow>
        <p className="mt-1.5 text-body-sm text-secondary">{t("formIntro")}</p>
      </div>

      <form action={action} className="grid gap-5 sm:grid-cols-2">
        <Field label={t("businessType")} htmlFor="businessType">
          <Select
            id="businessType"
            name="businessType"
            size="lg"
            required
            defaultValue={initialValues?.business_type ?? ""}
            options={[
              { value: "", label: t("selectBusinessType") },
              { value: "individual", label: t("individual") },
              { value: "business", label: t("business") },
            ]}
          />
        </Field>

        <Field label={t("businessName")} htmlFor="businessName">
          <Input
            id="businessName"
            name="businessName"
            size="lg"
            required
            minLength={2}
            maxLength={120}
            defaultValue={initialValues?.business_name}
            autoComplete="organization"
          />
        </Field>

        <Field label={t("contactName")} htmlFor="contactName">
          <Input
            id="contactName"
            name="contactName"
            size="lg"
            required
            minLength={2}
            maxLength={100}
            defaultValue={initialValues?.contact_name}
            autoComplete="name"
          />
        </Field>

        <Field label={t("phone")} htmlFor="phone">
          <Input
            id="phone"
            name="phone"
            type="tel"
            size="lg"
            required
            minLength={7}
            maxLength={24}
            defaultValue={initialValues?.phone}
            autoComplete="tel"
          />
        </Field>

        <Field label={t("city")} htmlFor="city">
          <Input
            id="city"
            name="city"
            size="lg"
            required
            minLength={2}
            maxLength={80}
            defaultValue={initialValues?.city}
            autoComplete="address-level2"
          />
        </Field>

        <Field label={t("address")} htmlFor="address">
          <Input
            id="address"
            name="address"
            size="lg"
            required
            minLength={5}
            maxLength={240}
            defaultValue={initialValues?.address}
            autoComplete="street-address"
          />
        </Field>

        <Field label={t("taxId")} htmlFor="taxId" hint={t("optional")}>
          <Input
            id="taxId"
            name="taxId"
            size="lg"
            maxLength={40}
            defaultValue={initialValues?.tax_id ?? ""}
          />
        </Field>

        <Field label={t("website")} htmlFor="websiteUrl" hint={t("optional")}>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            size="lg"
            maxLength={300}
            placeholder="https://"
            defaultValue={initialValues?.website_url ?? ""}
            autoComplete="url"
          />
        </Field>

        <Field label={t("yearsInBusiness")} htmlFor="yearsInBusiness">
          <Input
            id="yearsInBusiness"
            name="yearsInBusiness"
            type="number"
            size="lg"
            min={0}
            max={100}
            step={1}
            required
            defaultValue={initialValues?.years_in_business ?? 0}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field
            label={t("inventorySummary")}
            htmlFor="inventorySummary"
            hint={t("inventoryHint")}
          >
            <Textarea
              id="inventorySummary"
              name="inventorySummary"
              required
              minLength={20}
              maxLength={1200}
              rows={5}
              defaultValue={initialValues?.inventory_summary}
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Checkbox
            name="sellerAgreement"
            value="1"
            required
            label={t("agreement")}
          />
        </div>

        {state.error && (
          <p role="alert" className="rounded-md border border-[color-mix(in_srgb,var(--signal-risk)_30%,transparent)] bg-risk-bg px-3 py-2.5 text-body-sm text-risk sm:col-span-2">
            {state.error === "auth"
              ? t("errorAuth")
              : state.error === "config"
                ? t("errorConfig")
                : state.error === "invalid"
                  ? t("errorInvalid")
                  : state.error === "approved"
                    ? t("errorApproved")
                    : t("errorGeneric")}
          </p>
        )}

        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
