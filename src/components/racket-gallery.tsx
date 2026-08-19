"use client";

import { useState } from "react";
import Image from "next/image";
import { Badge, Card, Icon, cx } from "@/components/ds/primitives";
import type { RacketImage } from "@/lib/types";

export interface RacketGalleryProps {
  racketName: string;
  brandName: string;
  heroImageUrl: string | null;
  images?: RacketImage[];
}

export function RacketGallery({
  racketName,
  brandName,
  heroImageUrl,
  images = [],
}: RacketGalleryProps) {
  // Collect all unique non-null image entries
  const galleryList: { url: string; colourway?: string | null; isHero?: boolean }[] = [];

  if (heroImageUrl) {
    galleryList.push({ url: heroImageUrl, isHero: true });
  }

  for (const img of images) {
    if (img.publicUrl && !galleryList.some((g) => g.url === img.publicUrl)) {
      galleryList.push({
        url: img.publicUrl,
        colourway: img.colourway,
        isHero: img.isHero,
      });
    }
  }

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const [isZoomed, setIsZoomed] = useState(false);

  const activeItem = galleryList[selectedIndex];
  const activeUrl = activeItem?.url;
  const isCurrentFailed = Boolean(activeUrl && failedUrls[activeUrl]);
  const hasValidImages = galleryList.length > 0 && !isCurrentFailed;

  const handleImageError = (url: string) => {
    setFailedUrls((prev) => ({ ...prev, [url]: true }));
  };

  return (
    <Card padding="md" className="group relative overflow-hidden">
      {/* Main Image Viewport */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-sunken grid place-items-center">
        {hasValidImages && activeUrl ? (
          <Image
            key={activeUrl}
            src={activeUrl}
            alt={`${racketName} - ${brandName} photography`}
            fill
            priority
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
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md bg-surface/80 backdrop-blur-md text-tertiary hover:text-primary transition-all shadow-sm border border-line cursor-pointer"
            aria-label="Expand image"
          >
            <Icon name="Maximize2" className="h-4 w-4" />
          </button>
        )}

        {/* Counter Badge */}
        {galleryList.length > 1 && (
          <div className="absolute bottom-3 right-3 rounded-full bg-surface/85 px-2.5 py-0.5 font-mono text-[11px] text-secondary border border-line backdrop-blur-md">
            {selectedIndex + 1} / {galleryList.length}
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

            return (
              <button
                key={item.url}
                type="button"
                onClick={() => setSelectedIndex(idx)}
                className={cx(
                  "relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-sunken transition-all cursor-pointer",
                  isSelected
                    ? "border-brand ring-2 ring-brand/20 scale-[1.03]"
                    : "border-line opacity-70 hover:opacity-100 hover:border-strong",
                )}
              >
                <Image
                  src={item.url}
                  alt={`${racketName} thumbnail ${idx + 1}`}
                  fill
                  sizes="56px"
                  className="object-contain p-1"
                  onError={() => handleImageError(item.url)}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Lightbox / Zoom Modal */}
      {isZoomed && activeUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setIsZoomed(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] aspect-square w-[700px] overflow-hidden rounded-lg bg-surface p-4 shadow-2xl border border-line"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsZoomed(false)}
              className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-sunken text-primary hover:bg-line transition-colors cursor-pointer"
            >
              <Icon name="X" className="h-5 w-5" />
            </button>
            <div className="relative h-full w-full">
              <Image
                src={activeUrl}
                alt={`${racketName} zoomed view`}
                fill
                sizes="(max-width: 1200px) 90vw, 700px"
                className="object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
