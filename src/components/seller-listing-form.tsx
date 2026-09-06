"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Button, Card, Eyebrow } from "@/components/ds/primitives";
import { Checkbox, Field, Input, Select } from "@/components/ds/forms";
import {
  createSellerListing,
  type SellerListingState,
} from "@/lib/seller-listing-actions";

export function SellerListingForm({
  locale,
  variants,
}: {
  locale: Locale;
  variants: { value: string; label: string }[];
}) {
  const t = useTranslations("sellerListing");
  const [state, action, pending] = useActionState<SellerListingState, FormData>(
    createSellerListing,
    {},
  );

  return (
    <Card padding="lg" className="mt-6 max-w-[820px]">
      <div className="mb-5 border-b border-line pb-4">
        <Eyebrow as="h2">{t("details")}</Eyebrow>
        <p className="mt-1.5 text-body-sm text-secondary">{t("reviewNote")}</p>
      </div>

      <form action={action} className="grid gap-5 sm:grid-cols-2">
        <input type="hidden" name="locale" value={locale} />

        <div className="sm:col-span-2">
          <Field label={t("variant")} htmlFor="variantId">
            <Select
              id="variantId"
              name="variantId"
              size="lg"
              required
              options={[
                { value: "", label: t("selectVariant") },
                ...variants,
              ]}
            />
          </Field>
        </div>

        <Field label={t("price")} htmlFor="price" hint={t("priceHint")}>
          <Input
            id="price"
            name="price"
            type="number"
            size="lg"
            prefix="₫"
            min={1000}
            max={1_000_000_000}
            step={1000}
            required
          />
        </Field>

        <Field label={t("quantity")} htmlFor="quantity">
          <Input
            id="quantity"
            name="quantity"
            type="number"
            size="lg"
            min={0}
            max={10_000}
            step={1}
            defaultValue={1}
            required
          />
        </Field>

        <Field label={t("condition")} htmlFor="condition">
          <Select
            id="condition"
            name="condition"
            size="lg"
            required
            defaultValue="new"
            options={[
              { value: "new", label: t("conditionNew") },
              { value: "open-box", label: t("conditionOpenBox") },
              { value: "used-excellent", label: t("conditionUsedExcellent") },
              { value: "used-good", label: t("conditionUsedGood") },
              { value: "used-fair", label: t("conditionUsedFair") },
            ]}
          />
        </Field>

        <Field label={t("warranty")} htmlFor="warrantyMonths">
          <Input
            id="warrantyMonths"
            name="warrantyMonths"
            type="number"
            size="lg"
            min={0}
            max={120}
            step={1}
            defaultValue={0}
            required
          />
        </Field>

        <Field label={t("shipsFrom")} htmlFor="shipsFrom">
          <Input
            id="shipsFrom"
            name="shipsFrom"
            size="lg"
            minLength={2}
            maxLength={80}
            autoComplete="address-level2"
            required
          />
        </Field>

        <Field label={t("leadTime")} htmlFor="leadTimeDays">
          <Input
            id="leadTimeDays"
            name="leadTimeDays"
            type="number"
            size="lg"
            min={0}
            max={60}
            step={1}
            defaultValue={1}
            required
          />
        </Field>

        <div className="sm:col-span-2">
          <Checkbox
            name="includesStringing"
            value="1"
            label={t("includesStringing")}
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
                  : state.error === "notApproved"
                    ? t("errorNotApproved")
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
