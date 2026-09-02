"use client";

import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import Image from "next/image";
import { Badge, Card, Icon, cx } from "@/components/ds/primitives";
import type { RacketImage } from "@/lib/types";

export interface RacketGalleryProps {
  racketName: string;
  brandName: string;
  heroImageUrl: string | null;
  images?: RacketImage[];
}

/** A swipe has to travel this far, in px, before it counts as one. */
const SWIPE_THRESHOLD = 48;

export function RacketGallery({
  racketName,
  brandName,
  heroImageUrl,
  images = [],
}: RacketGalleryProps) {
  // Collect all unique non-null image entries
  const galleryList: {
    url: string;
    thumbnailUrl?: string | null;
    colourway?: string | null;
    isHero?: boolean;
  }[] = [];

  if (heroImageUrl) {
    const hero = images.find((image) => image.publicUrl === heroImageUrl);
    galleryList.push({
      url: heroImageUrl,
      thumbnailUrl: hero?.thumbUrl,
      colourway: hero?.colourway,
      isHero: true,
    });
  }

  for (const img of images) {
    if (img.publicUrl && !galleryList.some((g) => g.url === img.publicUrl)) {
      galleryList.push({
        url: img.publicUrl,
        thumbnailUrl: img.thumbUrl,
        colourway: img.colourway,
        isHero: img.isHero,
      });
    }
  }

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const [failedThumbnailUrls, setFailedThumbnailUrls] = useState<Record<string, boolean>>({});
  const [isZoomed, setIsZoomed] = useState(false);

  const activeItem = galleryList[selectedIndex];
  const activeUrl = activeItem?.url;
  const isCurrentFailed = Boolean(activeUrl && failedUrls[activeUrl]);
  const hasValidImages = galleryList.length > 0 && !isCurrentFailed;

  // An image that 404ed is not a slide you can step onto, so navigation walks
  // the list of ones that still load rather than the raw index range.
  const usableIndexes = galleryList
    .map((_, idx) => idx)
    .filter((idx) => !failedUrls[galleryList[idx].url]);
  const position = usableIndexes.indexOf(selectedIndex);
  const canNavigate = usableIndexes.length > 1;

  const handleImageError = (url: string) => {
    setFailedUrls((prev) => ({ ...prev, [url]: true }));
  };

  // `step` is handed to a keydown listener, so it has to keep one identity across
  // renders; the list it walks is read from a ref that every render refreshes.
  const latest = useRef({ galleryList, failedUrls });
  latest.current = { galleryList, failedUrls };

  const step = useCallback((direction: 1 | -1) => {
    const { galleryList: list, failedUrls: failed } = latest.current;
    setSelectedIndex((current) => {
      const usable = list.map((_, idx) => idx).filter((idx) => !failed[list[idx].url]);
      if (usable.length === 0) return current;
      const at = usable.indexOf(current);
      const next = at === -1 ? 0 : (at + direction + usable.length) % usable.length;
      return usable[next];
    });
  }, []);

  // Arrow keys step the zoom view, Escape closes it. The page behind must not
  // scroll while the lightbox is open — on touch that reads as a broken modal.
  useEffect(() => {
    if (!isZoomed) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsZoomed(false);
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [isZoomed, step]);

  // Horizontal swipe on touch, in both views.
  const touchStartX = useRef<number | null>(null);

  const onTouchStart = (event: TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null || !canNavigate) return;
    const delta = (event.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    step(delta < 0 ? 1 : -1);
  };

  // No display utility here on purpose — each call site sets its own, so a
  // `sm:hidden` never fights a base `flex` for the cascade.
  const navButtonClass =
    "h-10 w-10 items-center justify-center rounded-full border border-line bg-surface/85 text-secondary shadow-sm backdrop-blur-md transition-colors hover:text-primary hover:bg-surface cursor-pointer sm:h-9 sm:w-9";

  return (
    <Card padding="md" className="group relative overflow-hidden">
      {/* Main Image Viewport */}
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-sunken grid place-items-center"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {hasValidImages && activeUrl ? (
          <Image
            key={activeUrl}
            src={activeUrl}
            alt={`${racketName} - ${brandName} photography`}
            fill
            priority
            unoptimized
            sizes="(max-width: 1024px) 100vw, 550px"
            className="object-contain p-4 transition-transform duration-300 group-hover:scale-[1.02]"
            onError={() => handleImageError(activeUrl)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <span className="font-mono text-xs font-semibold tracking-wider text-[var(--text-disabled)] uppercase">
              {brandName}
            </span>
            <span className="mt-1 font-display text-lg font-bold text-tertiary">
              {racketName}
            </span>
          </div>
        )}

        {/* Badges Overlay */}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5 pointer-events-none">
          {activeItem?.isHero && (
            <Badge tone="brand" icon="Sparkles">
              Hero Shot
            </Badge>
          )}
          {activeItem?.colourway && (
            <Badge tone="neutral">
              {activeItem.colourway}
            </Badge>
          )}
        </div>

        {/* Fullscreen / Zoom Trigger */}
        {hasValidImages && activeUrl && (
          <button
            type="button"
            onClick={() => setIsZoomed(true)}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-md bg-surface/80 backdrop-blur-md text-tertiary hover:text-primary transition-all shadow-sm border border-line cursor-pointer sm:h-8 sm:w-8"
            aria-label="Expand image"
          >
            <Icon name="Maximize2" className="h-4 w-4" />
          </button>
        )}

        {/* Previous / next */}
        {canNavigate && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              className={cx(navButtonClass, "absolute left-2 top-1/2 flex -translate-y-1/2 sm:left-3")}
              aria-label="Previous image"
            >
              <Icon name="ChevronLeft" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              className={cx(navButtonClass, "absolute right-2 top-1/2 flex -translate-y-1/2 sm:right-3")}
              aria-label="Next image"
            >
              <Icon name="ChevronRight" className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Counter Badge */}
        {canNavigate && (
          <div className="absolute bottom-3 right-3 rounded-full bg-surface/85 px-2.5 py-0.5 font-mono text-[11px] text-secondary border border-line backdrop-blur-md">
            {Math.max(position, 0) + 1} / {usableIndexes.length}
          </div>
        )}
      </div>

      {/* Thumbnail Strip */}
      {galleryList.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
          {galleryList.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            const isFailed = Boolean(failedUrls[item.url]);
            if (isFailed) return null;
            const hasThumbnail = Boolean(
              item.thumbnailUrl && !failedThumbnailUrls[item.thumbnailUrl],
            );
            const thumbnailSrc = hasThumbnail ? item.thumbnailUrl! : item.url;

            return (
              <button
                key={item.url}
                type="button"
                onClick={() => setSelectedIndex(idx)}
                aria-label={`Show image ${idx + 1}`}
                aria-current={isSelected}
                className={cx(
                  "relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-sunken transition-all cursor-pointer",
                  isSelected
                    ? "border-brand ring-2 ring-brand/20 scale-[1.03]"
                    : "border-line opacity-70 hover:opacity-100 hover:border-strong",
                )}
              >
                <Image
                  src={thumbnailSrc}
                  alt={`${racketName} thumbnail ${idx + 1}`}
                  fill
                  unoptimized
                  sizes="56px"
                  className="object-contain p-1"
                  onError={() => {
                    if (hasThumbnail && item.thumbnailUrl) {
                      setFailedThumbnailUrls((previous) => ({
                        ...previous,
                        [item.thumbnailUrl!]: true,
                      }));
                    } else {
                      handleImageError(item.url);
                    }
                  }}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Lightbox / Zoom Modal */}
      {isZoomed && activeUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setIsZoomed(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${racketName} images`}
        >
          <div
            className="relative flex h-[82vh] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-line bg-surface p-3 shadow-2xl sm:h-[88vh] sm:p-4"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <button
              type="button"
              onClick={() => setIsZoomed(false)}
              className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-primary hover:bg-line transition-colors cursor-pointer sm:right-4 sm:top-4 sm:h-9 sm:w-9"
              aria-label="Close image viewer"
            >
              <Icon name="X" className="h-5 w-5" />
            </button>

            <div className="relative min-h-0 flex-1">
              <Image
                src={activeUrl}
                alt={`${racketName} zoomed view`}
                fill
                unoptimized
                sizes="(max-width: 1200px) 95vw, 760px"
                className="object-contain"
                onError={() => handleImageError(activeUrl)}
              />

              {canNavigate && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    className={cx(navButtonClass, "absolute left-0 top-1/2 hidden -translate-y-1/2 sm:flex")}
                    aria-label="Previous image"
                  >
                    <Icon name="ChevronLeft" className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    className={cx(navButtonClass, "absolute right-0 top-1/2 hidden -translate-y-1/2 sm:flex")}
                    aria-label="Next image"
                  >
                    <Icon name="ChevronRight" className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {canNavigate && (
              <div className="mt-3 flex shrink-0 items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  className={cx(navButtonClass, "flex sm:hidden")}
                  aria-label="Previous image"
                >
                  <Icon name="ChevronLeft" className="h-5 w-5" />
                </button>
                <span className="font-mono text-[11px] text-secondary">
                  {Math.max(position, 0) + 1} / {usableIndexes.length}
                </span>
                <button
                  type="button"
                  onClick={() => step(1)}
                  className={cx(navButtonClass, "flex sm:hidden")}
                  aria-label="Next image"
                >
                  <Icon name="ChevronRight" className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
