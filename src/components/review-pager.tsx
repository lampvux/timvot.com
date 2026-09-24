"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, cx } from "@/components/ds/primitives";
import { ReviewCard } from "@/components/review-card";
import type { Review } from "@/lib/types";

/**
 * The review list, a page at a time.
 *
 * Page one arrives with the detail page, server-rendered. Every later page is
 * fetched when the reader clicks for it — never before, and never all of
 * them — so a racket with thousands of reviews still costs the page three.
 * A page once fetched is kept, so paging back is instant.
 *
 * Why this is client state and not a `page` key in the URL like the
 * catalogue: a search param would make the detail page dynamic and throw away
 * its prerendered shell for every visitor, to serve the few who page reviews.
 * The review page is not a filtered result anybody pastes into a chat.
 */
export function ReviewPager({
  racketId,
  total,
  pageSize,
  initial,
}: {
  racketId: string;
  total: number;
  pageSize: number;
  initial: Review[];
}) {
  const t = useTranslations("racket");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const [page, setPage] = useState(1);
  const [cache, setCache] = useState<Record<number, Review[]>>({ 1: initial });
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);

  const show = (target: number) => {
    setPage(target);
    setStatus("idle");
    // Land at the top of the list, not at the old page's controls.
    const top = topRef.current;
    if (top && top.getBoundingClientRect().top < 0) {
      top.scrollIntoView({ block: "start" });
    }
  };

  const go = (target: number) => {
    if (target < 1 || target > pages) return;
    if (cache[target]) return show(target);

    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStatus("loading");

    void fetch(
      `/api/rackets/${encodeURIComponent(racketId)}/reviews?page=${target}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as { reviews?: unknown };
        if (!Array.isArray(payload.reviews)) throw new Error("Invalid response");
        setCache((current) => ({ ...current, [target]: payload.reviews as Review[] }));
        show(target);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailedPage(target);
        setStatus("error");
      });
  };

  const reviews = cache[page] ?? [];
  const loading = status === "loading";

  return (
    <div ref={topRef} className="scroll-mt-24">
      <div
        aria-busy={loading}
        aria-live="polite"
        className={cx(
          "grid gap-3 transition-opacity duration-[90ms] lg:grid-cols-3",
          loading && "opacity-60",
        )}
      >
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </div>

      {status === "error" && failedPage !== null && (
        <p
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-2 text-body-sm text-risk"
        >
          <Icon name="CircleAlert" size="sm" />
          {t("reviewPageError", { page: failedPage })}
          <Button size="sm" variant="secondary" onClick={() => go(failedPage)}>
            {t("reviewPageRetry")}
          </Button>
        </p>
      )}

      {pages > 1 && (
        <nav
          aria-label={t("reviewPagination")}
          className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"
        >
          <Button
            variant="secondary"
            iconLeft="ArrowLeft"
            disabled={page <= 1 || loading}
            onClick={() => go(page - 1)}
          >
            {t("reviewPrevious")}
          </Button>
          <span className="order-last w-full text-center font-mono text-[12px] tabular-nums text-tertiary sm:order-none sm:w-auto">
            {t("reviewPageOf", { page, pages, total })}
          </span>
          <Button
            variant="secondary"
            iconRight="ArrowRight"
            disabled={page >= pages || loading}
            onClick={() => go(page + 1)}
          >
            {loading ? t("reviewLoading") : t("reviewNext")}
          </Button>
        </nav>
      )}
    </div>
  );
}
