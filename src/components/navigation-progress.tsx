"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const NAVIGATION_START_EVENT = "shuttlecraft:navigation-start";
const SHOW_DELAY_MS = 150;
const STUCK_TIMEOUT_MS = 10_000;

/** Programmatic router calls do not emit a browser navigation event. Client
 *  components call this immediately before `router.push` / `router.replace`
 *  so they get the same feedback as a real Link. */
export function beginNavigation() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(NAVIGATION_START_EVENT));
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mounted = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);

  const start = useCallback(() => setIsNavigating(true), []);

  // The new URL is committed. Complete only a bar that became visible; fast
  // navigations finish before the delay and never flash a loading indicator.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    setIsNavigating(false);
    setProgress((current) => (current > 0 ? 100 : 0));
    const timer = window.setTimeout(() => setProgress(0), 250);
    return () => window.clearTimeout(timer);
  }, [pathname, searchParams]);

  useEffect(() => {
    const handleAnchorClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const targetUrl = new URL(href, window.location.href);
      if (targetUrl.origin !== window.location.origin) return;

      const currentRoute = window.location.pathname + window.location.search;
      const targetRoute = targetUrl.pathname + targetUrl.search;
      if (targetRoute !== currentRoute) start();
    };

    window.addEventListener(NAVIGATION_START_EVENT, start);
    window.addEventListener("popstate", start);
    document.addEventListener("click", handleAnchorClick, { capture: true });
    return () => {
      window.removeEventListener(NAVIGATION_START_EVENT, start);
      window.removeEventListener("popstate", start);
      document.removeEventListener("click", handleAnchorClick, { capture: true });
    };
  }, [start]);

  useEffect(() => {
    if (!isNavigating) return;

    const showTimer = window.setTimeout(() => setProgress(30), SHOW_DELAY_MS);
    const interval = window.setInterval(() => {
      setProgress((current) =>
        current === 0 || current >= 90
          ? current
          : current + (90 - current) * 0.15,
      );
    }, 100);
    // A failed or cancelled navigation must not leave the bar pinned forever.
    const stuckTimer = window.setTimeout(() => {
      setIsNavigating(false);
      setProgress(0);
    }, STUCK_TIMEOUT_MS);

    return () => {
      window.clearTimeout(showTimer);
      window.clearInterval(interval);
      window.clearTimeout(stuckTimer);
    };
  }, [isNavigating]);

  if (progress === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 right-0 top-0 z-[9999] h-[3px] overflow-hidden bg-transparent"
    >
      <div
        className="h-full bg-brand shadow-[0_0_8px_var(--green-700)]"
        style={{
          width: `${progress}%`,
          opacity: progress === 100 ? 0 : 1,
          transition:
            progress === 100
              ? "width 150ms ease-out, opacity 150ms ease-out 100ms"
              : "width 200ms ease-out",
        }}
      />
    </div>
  );
}
