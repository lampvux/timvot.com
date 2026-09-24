import Image from "next/image";
import { cx } from "@/components/ds/primitives";
import type { BadmintonString } from "@/lib/types";

type Source = Pick<BadmintonString, "brandName" | "name" | "imageUrl" | "thumbUrl">;

/**
 * A string's packshot, or the brand name where none has been added yet —
 * the same placeholder a racket card shows, so a missing photo reads as
 * "not photographed" rather than as a broken page.
 *
 * `thumb` is the list size and prefers the stored 400px WebP, served as-is
 * (it is already the size it is shown at). `hero` is the detail page's and
 * lets next/image size the original.
 */
export function StringImage({
  string,
  variant,
  priority = false,
  className,
}: {
  string: Source;
  variant: "thumb" | "hero";
  priority?: boolean;
  className?: string;
}) {
  const thumb = variant === "thumb";
  const src = thumb ? (string.thumbUrl ?? string.imageUrl) : string.imageUrl;

  return (
    <div
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-sunken",
        thumb ? "size-16" : "aspect-square w-full",
        className,
      )}
    >
      <span
        className={cx(
          "px-1 text-center font-mono text-[var(--text-disabled)]",
          thumb ? "text-[9px]" : "text-[12px]",
        )}
      >
        {string.brandName.toUpperCase()}
      </span>
      {src && (
        <Image
          src={src}
          // In a list the name sits beside the thumbnail, so the image adds
          // nothing for a screen reader; on the detail page it is the product.
          alt={thumb ? "" : `${string.brandName} ${string.name}`}
          fill
          unoptimized={thumb && Boolean(string.thumbUrl)}
          priority={priority}
          sizes={thumb ? "64px" : "(max-width: 1024px) 100vw, 40vw"}
          className={cx("object-contain", thumb ? "p-1" : "p-6")}
        />
      )}
    </div>
  );
}
