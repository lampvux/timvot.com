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
 * SECURITY. What this renders is display only. `submit_review` re-establishes
 * the user and enforces every rule itself.
 */

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
      .select("id, status, created_at")
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

  // Nothing to write, so nothing to open: the status is shown as it is.
  if (own) {
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
async function Shell({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("reviewForm");
  return (
    <details className="group/write mt-4">
      <summary
        className={cx(
          ButtonLinkStyle({ variant: "secondary", size: "md" }),
          "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        )}
      >
        <Icon name="Plus" size="sm" className="group-open/write:hidden" />
        <Icon name="X" size="sm" className="hidden group-open/write:block" />
        <span className="group-open/write:hidden">{t("openCta")}</span>
        <span className="hidden group-open/write:inline">{t("closeCta")}</span>
      </summary>
      <Card padding="lg" className="mt-3">
        <div className="mb-4 border-b border-line pb-4">
          <Eyebrow as="h3">{t("title")}</Eyebrow>
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
