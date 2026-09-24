import { useLocale, useTranslations } from "next-intl";
import { Tag, TrustBadge } from "@/components/ds/primitives";
import { ReviewDate } from "@/components/review-date";
import { RATING_AXES } from "@/lib/review-standards";
import type { Review } from "@/lib/types";

/**
 * One review. No directive on purpose: page one renders it on the server
 * inside the detail page, and <ReviewPager /> renders later pages with the
 * same component in the browser, so a card never looks different depending on
 * how it arrived. Hence `useTranslations` rather than `getTranslations`.
 *
 * Reviewer context chips sit above the prose, not below: "4U G5 at 26 lbs,
 * intermediate doubles" is what makes the sentence that follows usable.
 */
export function ReviewCard({ review }: { review: Review }) {
  const te = useTranslations("enums");
  const tr = useTranslations("racket");
  const locale = useLocale() as "en" | "vi";
  // A community review is written in one language; show it in that one
  // rather than an empty paragraph.
  const body = review.body[locale] || review.body[locale === "en" ? "vi" : "en"];

  return (
    <article className="rounded-md border border-line bg-card p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <TrustBadge
          state={review.tier === "community" ? "unverified" : "verified"}
          label={te(
            review.tier === "purchase"
              ? "tierPurchase"
              : review.tier === "owner"
                ? "tierOwner"
                : "tierCommunity",
          )}
        />
        <ReviewDate iso={review.createdAt} locale={locale} />
      </div>

      <p className="mb-2 text-body-sm font-semibold text-primary">
        {review.authorName || tr("communityMember")}
      </p>

      <div className="mb-2.5 flex flex-wrap gap-1.5">
        <Tag>
          {te(
            review.skillLevel === "beginner"
              ? "skillBeginner"
              : review.skillLevel === "intermediate"
                ? "skillIntermediate"
                : "skillAdvanced",
          )}
        </Tag>
        <Tag>
          {te(review.format === "singles" ? "formatSingles" : "formatDoubles")} ·{" "}
          {te(
            review.position === "net"
              ? "positionNet"
              : review.position === "mid"
                ? "positionMid"
                : "positionRear",
          ).toLowerCase()}
        </Tag>
        <Tag mono>
          {review.stringModel} · {review.tensionLbs} lbs
        </Tag>
      </div>

      <dl className="mb-2.5 grid grid-cols-4 gap-2">
        {RATING_AXES.map((axis) => (
          <div key={axis}>
            <dt className="eyebrow text-tertiary">{tr(axis)}</dt>
            <dd className="font-mono text-[13px] tabular-nums text-primary">
              {formatRating(review[axis])}
            </dd>
          </div>
        ))}
      </dl>

      {body && (
        <p className="whitespace-pre-line text-[14px] leading-[1.55] text-ink-700">
          {body}
        </p>
      )}
    </article>
  );
}

function formatRating(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}/5`;
}
