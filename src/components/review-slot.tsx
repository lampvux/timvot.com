import { Suspense } from "react";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  ButtonLinkStyle,
  Card,
  Eyebrow,
  Icon,
  cx,
} from "@/components/ds/primitives";
import { ReviewForm } from "@/components/review-form";
import { ReviewDate } from "@/components/review-date";
import { createClient } from "@/lib/supabase/server";
import { REVIEW_LIMITS } from "@/lib/review-standards";
import type { SkillLevel } from "@/lib/types";

/**
 * "Write a review", resolved behind Suspense for the same reason as
 * <WatchPriceSlot />: the detail page prerenders, and the Supabase Auth round
 * trip that decides which of three states to show must not sit in front of the
 * spec sheet. The fallback is the signed-out state, the same box a signed-out
 * reader keeps.
 *
 * One review per account per racket. Once written, the author sees it again
 * here as an edit for REVIEW_LIMITS.editWindowDays after posting, then as a
 * fixed status line.
 *
 * SECURITY. What this renders is display only. `submit_review` and
 * `update_review` re-establish the user and enforce every rule themselves —
 * including the edit window, which this file only uses to hide the button.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  racketId: string;
  locale: Locale;
  maxTension: number;
}

async function ResolvedReviewSlot({ racketId, locale, maxTension }: Props) {
  const supabase = await createClient();
  if (!supabase) return <SignedOut />;

  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch (error) {
    unstable_rethrow(error);
    userId = null;
  }
  if (!userId) return <SignedOut />;

  // RLS lets an author read their own row whatever its status, so a review
  // staff removed is still shown to the person who wrote it.
  const [{ data: own }, { data: profile }] = await Promise.all([
    supabase
      .from("reviews")
      .select(
        "id, status, created_at, skill_level, format, position, string_model, tension_lbs, power, speed, control, comfort, body_en, body_vi",
      )
      .eq("racket_id", racketId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("skill_level")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const t = await getTranslations("reviewForm");

  if (own) {
    // Request time, not prerender: this branch only exists once cookies()
    // has resolved to a signed-in user.
    const remainingMs =
      new Date(own.created_at).getTime() +
      REVIEW_LIMITS.editWindowDays * DAY_MS -
      Date.now();
    const editable = own.status !== "rejected" && remainingMs > 0;

    if (editable) {
      const hours = Math.max(1, Math.floor(remainingMs / (60 * 60 * 1000)));
      return (
        <Shell open={t("editCta")} close={t("closeEditCta")} title={t("editTitle")}>
          <p className="mb-4 flex items-start gap-2 text-body-sm text-secondary">
            <Icon name="Info" size="sm" className="mt-0.5" />
            {hours >= 24
              ? t("editWindowDays", { days: Math.floor(hours / 24) })
              : t("editWindowHours", { hours })}
          </p>
          <ReviewForm
            racketId={racketId}
            locale={locale}
            maxTension={maxTension}
            existing={{
              skillLevel: own.skill_level,
              format: own.format,
              position: own.position,
              stringModel: own.string_model,
              tensionLbs: own.tension_lbs,
              power: Number(own.power),
              speed: Number(own.speed),
              control: Number(own.control),
              comfort: Number(own.comfort),
              body: own.body_vi ?? own.body_en ?? "",
            }}
          />
        </Shell>
      );
    }

    // Nothing left to write or change, so nothing to open.
    return (
      <div className="mt-4 rounded-md border border-line bg-card px-4 py-3">
        <p className="flex items-start gap-2 text-body-sm text-primary">
          <Icon
            name={own.status === "rejected" ? "CircleAlert" : "CircleCheck"}
            size="sm"
            className={
              own.status === "rejected"
                ? "mt-0.5 text-risk"
                : "mt-0.5 text-brand"
            }
          />
          <span>
            {own.status === "rejected"
              ? t("alreadyRejected")
              : own.status === "pending"
                ? t("alreadyPending")
                : t("alreadyPublished")}{" "}
            <ReviewDate iso={own.created_at} locale={locale} />
          </span>
        </p>
        {own.status !== "rejected" && (
          <p className="mt-1.5 pl-6 text-caption text-tertiary">
            {t("editClosedNote", { days: REVIEW_LIMITS.editWindowDays })}
          </p>
        )}
      </div>
    );
  }

  return (
    <Shell>
      <ReviewForm
        racketId={racketId}
        locale={locale}
        initialSkill={(profile?.skill_level as SkillLevel | null) ?? null}
        maxTension={maxTension}
      />
    </Shell>
  );
}

/**
 * Closed until the reader asks to write. A native <details>: the summary is a
 * real disclosure button to assistive tech, it needs no JavaScript, and the
 * form inside is still server-rendered so opening it costs no round trip.
 */
async function Shell({
  children,
  open,
  close,
  title,
}: {
  children: React.ReactNode;
  open?: string;
  close?: string;
  title?: string;
}) {
  const t = await getTranslations("reviewForm");
  return (
    <details className="group/write mt-4">
      <summary
        className={cx(
          ButtonLinkStyle({ variant: "secondary", size: "md" }),
          "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        )}
      >
        <Icon
          name={open ? "SlidersHorizontal" : "Plus"}
          size="sm"
          className="group-open/write:hidden"
        />
        <Icon name="X" size="sm" className="hidden group-open/write:block" />
        <span className="group-open/write:hidden">{open ?? t("openCta")}</span>
        <span className="hidden group-open/write:inline">
          {close ?? t("closeCta")}
        </span>
      </summary>
      <Card padding="lg" className="mt-3">
        <div className="mb-4 border-b border-line pb-4">
          <Eyebrow as="h3">{title ?? t("title")}</Eyebrow>
          <details className="mt-2 text-body-sm text-secondary">
            <summary className="cursor-pointer font-semibold text-primary">
              {t("standardsTitle")}
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>{t("standardSetup")}</li>
              <li>{t("standardOwn")}</li>
              <li>{t("standardNoAds")}</li>
              <li>{t("standardRespect")}</li>
              <li>
                {t("standardLimits", {
                  perDay: REVIEW_LIMITS.perDay,
                  seconds: REVIEW_LIMITS.cooldownSeconds,
                })}
              </li>
              <li>{t("standardEdit", { days: REVIEW_LIMITS.editWindowDays })}</li>
              <li>{t("standardRemoval")}</li>
            </ul>
          </details>
        </div>
        {children}
      </Card>
    </details>
  );
}

async function SignedOut() {
  const t = await getTranslations("reviewForm");
  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-body-sm text-secondary">{t("signInPrompt")}</p>
        <Link
          href="/sign-in"
          className={ButtonLinkStyle({ variant: "secondary", size: "md" })}
        >
          {t("signIn")}
        </Link>
      </div>
    </Shell>
  );
}

export function ReviewSlot(props: Props) {
  return (
    <Suspense fallback={<SignedOut />}>
      <ResolvedReviewSlot {...props} />
    </Suspense>
  );
}
