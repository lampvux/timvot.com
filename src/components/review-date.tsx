"use client";

import { formatReviewDate } from "@/lib/format";

export function ReviewDate({ iso, locale }: { iso: string; locale: string }) {
  return (
    <span className="ml-auto font-mono text-[11px] tabular-nums text-tertiary">
      {formatReviewDate(iso, locale)}
    </span>
  );
}
