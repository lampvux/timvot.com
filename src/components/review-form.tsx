"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Button, Icon, cx } from "@/components/ds/primitives";
import { Field, Input, Select, Textarea } from "@/components/ds/forms";
import { submitReview, type ReviewFormState } from "@/lib/review-actions";
import { RATING_AXES, REVIEW_LIMITS } from "@/lib/review-standards";
import type { SkillLevel } from "@/lib/types";

/**
 * The write half of the reviews section, for a signed-in reader.
 *
 * Reviewer context is required, as the table demands: "4U G5 at 26 lbs,
 * intermediate doubles" is what makes the ratings that follow usable. The
 * standards the author is held to sit above the fields, not in an error after
 * they have written 400 words.
 */
export function ReviewForm({
  racketId,
  locale,
  initialSkill,
  maxTension,
}: {
  racketId: string;
  locale: Locale;
  initialSkill?: SkillLevel | null;
  maxTension: number;
}) {
  const t = useTranslations("reviewForm");
  const te = useTranslations("enums");
  const tr = useTranslations("racket");
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(
    submitReview,
    {},
  );
  const [bodyLength, setBodyLength] = useState(0);

  if (state.submitted) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-md border border-line bg-card px-4 py-3 text-body-sm text-primary"
      >
        <Icon name="CircleCheck" size="sm" className="mt-0.5 text-brand" />
        {t("submitted")}
      </p>
    );
  }

  const tensionDefault = Math.min(
    REVIEW_LIMITS.tensionMax,
    Math.max(REVIEW_LIMITS.tensionMin, Math.min(24, maxTension)),
  );

  return (
    <form action={action} className="grid gap-5 sm:grid-cols-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="racketId" value={racketId} />
      {/* Honeypot: off-screen, out of the tab order, hidden from assistive tech. */}
      <div aria-hidden="true" className="absolute left-[-10000px] size-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <Field label={t("skill")} htmlFor="review-skill">
        <Select
          id="review-skill"
          name="skillLevel"
          size="lg"
          required
          defaultValue={initialSkill ?? "intermediate"}
          options={[
            { value: "beginner", label: te("skillBeginner") },
            { value: "intermediate", label: te("skillIntermediate") },
            { value: "advanced", label: te("skillAdvanced") },
          ]}
        />
      </Field>
      <Field label={t("format")} htmlFor="review-format">
        <Select
          id="review-format"
          name="format"
          size="lg"
          required
          defaultValue="doubles"
          options={[
            { value: "singles", label: te("formatSingles") },
            { value: "doubles", label: te("formatDoubles") },
          ]}
        />
      </Field>
      <Field label={t("position")} htmlFor="review-position">
        <Select
          id="review-position"
          name="position"
          size="lg"
          required
          defaultValue="mid"
          options={[
            { value: "net", label: te("positionNet") },
            { value: "mid", label: te("positionMid") },
            { value: "rear", label: te("positionRear") },
          ]}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label={t("stringModel")} htmlFor="review-string" hint={t("stringModelHint")}>
          <Input
            id="review-string"
            name="stringModel"
            size="lg"
            required
            minLength={REVIEW_LIMITS.stringMin}
            maxLength={REVIEW_LIMITS.stringMax}
            autoComplete="off"
          />
        </Field>
      </div>
      <Field label={t("tension")} htmlFor="review-tension">
        <Input
          id="review-tension"
          name="tensionLbs"
          type="number"
          size="lg"
          required
          min={REVIEW_LIMITS.tensionMin}
          max={REVIEW_LIMITS.tensionMax}
          step={1}
          defaultValue={tensionDefault}
        />
      </Field>

      <fieldset className="grid gap-3 sm:col-span-3 sm:grid-cols-2">
        <legend className="mb-2 text-[13.5px] font-semibold leading-none text-primary">
          {t("ratings")}
        </legend>
        {RATING_AXES.map((axis) => (
          <RatingInput key={axis} name={axis} label={tr(axis)} scale={t("scale")} />
        ))}
      </fieldset>

      <div className="sm:col-span-3">
        <Field
          label={t("body")}
          htmlFor="review-body"
          hint={t("bodyHint", {
            count: bodyLength,
            min: REVIEW_LIMITS.bodyMin,
            max: REVIEW_LIMITS.bodyMax,
          })}
        >
          <Textarea
            id="review-body"
            name="body"
            required
            minLength={REVIEW_LIMITS.bodyMin}
            maxLength={REVIEW_LIMITS.bodyMax}
            rows={5}
            placeholder={t("bodyPlaceholder")}
            onChange={(event) => setBodyLength(event.currentTarget.value.trim().length)}
          />
        </Field>
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-[color-mix(in_srgb,var(--signal-risk)_30%,transparent)] bg-risk-bg px-3 py-2.5 text-body-sm text-risk sm:col-span-3"
        >
          <p className="flex items-start gap-2">
            <Icon name="CircleAlert" size="sm" className="mt-0.5" />
            {t(`error.${state.error}`, {
              perDay: REVIEW_LIMITS.perDay,
              seconds: REVIEW_LIMITS.cooldownSeconds,
            })}
          </p>
          {state.violations && state.violations.length > 0 && (
            <ul className="mt-1.5 list-disc pl-9">
              {state.violations.map((violation) => (
                <li key={violation}>
                  {t(`violation.${violation}`, {
                    min: REVIEW_LIMITS.bodyMin,
                    max: REVIEW_LIMITS.bodyMax,
                    stringMin: REVIEW_LIMITS.stringMin,
                    stringMax: REVIEW_LIMITS.stringMax,
                    tensionMin: REVIEW_LIMITS.tensionMin,
                    tensionMax: REVIEW_LIMITS.tensionMax,
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? t("submitting") : t("submit")}
        </Button>
        <span className="text-caption text-tertiary">{t("tierNote")}</span>
      </div>
    </form>
  );
}

/** Five radios as one row of numbered cells: the value is the label. */
function RatingInput({
  name,
  label,
  scale,
}: {
  name: string;
  label: string;
  scale: string;
}) {
  return (
    <div role="radiogroup" aria-label={`${label}, ${scale}`} className="flex items-center gap-3">
      <span className="eyebrow w-24 shrink-0 text-tertiary">{label}</span>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((value) => (
          <label
            key={value}
            className={cx(
              "flex size-11 cursor-pointer items-center justify-center rounded-md border border-line bg-card font-mono text-[14px] tabular-nums text-primary lg:size-9",
              "transition-colors duration-[90ms] hover:border-line-strong",
              "has-[:checked]:border-line-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand",
              "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              required
              className="sr-only"
              aria-label={`${label} ${value}`}
            />
            {value}
          </label>
        ))}
      </div>
    </div>
  );
}
