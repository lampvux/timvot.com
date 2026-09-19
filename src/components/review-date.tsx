"use client";

import { useEffect, useState } from "react";
import { formatAbsoluteDate, formatReviewDate } from "@/lib/format";

/**
 * A review's date, relative while it is recent.
 *
 * The relative form cannot be rendered on the server. "Three days ago" is
 * relative to *when it rendered*, and this page is prerendered at build time
 * and read by a visitor days later — so the server's text and the browser's
 * text are guaranteed to differ, which is a hydration mismatch. React's
 * response to one is not a warning: it discards the server's HTML for the
 * surrounding subtree and re-renders it on the client, which is the whole
 * review list, on the page with the most of them.
 *
 * So the absolute date is what ships in the HTML, and the relative form
 * replaces it after mount, when the browser is the only thing rendering.
 * `formatReviewDate` returns the absolute form beyond 30 days anyway, so for
 * most reviews the swap changes nothing visible.
 */
export function ReviewDate({ iso, locale }: { iso: string; locale: string }) {
  const [rendered, setRendered] = useState(() => formatAbsoluteDate(iso, locale));

  useEffect(() => {
    setRendered(formatReviewDate(iso, locale));
  }, [iso, locale]);

  return (
    <span className="ml-auto font-mono text-[11px] tabular-nums text-tertiary">
      {rendered}
    </span>
  );
}
