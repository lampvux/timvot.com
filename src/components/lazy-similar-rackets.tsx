"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ds/primitives";
import {
  RacketCardView,
  type RacketCardLabels,
} from "@/components/racket-card-view";
import {
  BALANCE_MESSAGE_KEY,
  FLEX_MESSAGE_KEY,
  PLAY_STYLE_MESSAGE_KEY,
} from "@/lib/format";
import type { RacketCardData } from "@/lib/types";

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; rackets: RacketCardData[] }
  | { status: "error" };

/**
 * Fetch recommendations only as their section approaches the viewport.
 *
 * The 400px margin normally completes the small cached request before the
 * heading is visible, while a visitor who never reaches this part of the page
 * pays no query, JSON or image cost at all.
 */
export function LazySimilarRackets({ racketId }: { racketId: string }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const t = useTranslations("racket");
  const tc = useTranslations("common");
  const te = useTranslations("enums");

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    let started = false;
    let controller: AbortController | null = null;

    const load = () => {
      if (started) return;
      started = true;
      controller = new AbortController();
      setState({ status: "loading" });

      void fetch(`/api/rackets/${encodeURIComponent(racketId)}/similar`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = (await response.json()) as { rackets?: unknown };
          if (!Array.isArray(payload.rackets)) throw new Error("Invalid response");
          setState({ status: "loaded", rackets: payload.rackets as RacketCardData[] });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setState({ status: "error" });
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => controller?.abort();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(section);

    return () => {
      observer.disconnect();
      controller?.abort();
    };
  }, [attempt, racketId]);

  const labelsFor = (racket: RacketCardData): RacketCardLabels => ({
    belowList: tc("belowList"),
    sellers: tc("sellers", { count: racket.sellerCount }),
    headLight: t("headLight"),
    headHeavy: t("headHeavy"),
    balance: te(BALANCE_MESSAGE_KEY[racket.balanceType]),
    flex: te(FLEX_MESSAGE_KEY[racket.shaftFlex]),
    playStyles: Object.fromEntries(
      racket.playStyleTags.map((style) => [style, te(PLAY_STYLE_MESSAGE_KEY[style])]),
    ),
  });

  return (
    <section ref={sectionRef} className="mt-10" aria-labelledby="similar">
      <h2 id="similar" className="font-display text-h3 font-bold text-primary">
        {t("similar")}
      </h2>

      {state.status === "loaded" ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.rackets.map((racket) => (
            <RacketCardView
              key={racket.id}
              racket={racket}
              compact
              labels={labelsFor(racket)}
            />
          ))}
        </div>
      ) : state.status === "error" ? (
        <div className="mt-4 rounded-md border border-line bg-sunken p-4">
          <Button type="button" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {tc("retry")}
          </Button>
        </div>
      ) : (
        <div
          className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label={state.status === "loading" ? tc("loading") : undefined}
          aria-live="polite"
        >
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              aria-hidden
              className="h-[360px] animate-pulse rounded-md border border-line bg-sunken"
            />
          ))}
        </div>
      )}
    </section>
  );
}
