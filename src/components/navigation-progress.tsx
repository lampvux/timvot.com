"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);

  // Stop loading state whenever pathname or searchParams change
  useEffect(() => {
    setIsNavigating(false);
    setProgress(100);
    const timer = setTimeout(() => setProgress(0), 200);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  // Intercept click on internal links to start progress instantly
  useEffect(() => {
    const handleAnchorClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      const targetAttr = anchor.getAttribute("target");

      if (
        href &&
        href.startsWith("/") &&
        !href.startsWith("//") &&
        targetAttr !== "_blank" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        const currentUrl = window.location.pathname + window.location.search;
        const targetUrl = new URL(href, window.location.origin);
        const targetPathWithQuery = targetUrl.pathname + targetUrl.search;

        if (targetPathWithQuery !== currentUrl) {
          setIsNavigating(true);
          setProgress(30);
        }
      }
    };

    document.addEventListener("click", handleAnchorClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleAnchorClick, { capture: true });
    };
  }, []);

  // Animate progress smoothly when navigating
  useEffect(() => {
    if (!isNavigating) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + (90 - prev) * 0.15;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isNavigating]);

  if (progress === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 right-0 z-[9999] h-[3px] overflow-hidden bg-transparent"
    >
      <div
        className="h-full bg-brand transition-all duration-200 ease-out shadow-[0_0_8px_var(--green-700)]"
        style={{
          width: `${progress}%`,
          opacity: progress === 100 ? 0 : 1,
          transition: progress === 100 ? "width 150ms ease-out, opacity 150ms ease-out 100ms" : "width 200ms ease-out",
        }}
      />
    </div>
  );
}
