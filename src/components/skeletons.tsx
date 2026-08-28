import { cx } from "@/components/ds/primitives";

/**
 * Loading shapes, not spinners.
 *
 * Every box here matches the real component's geometry — the rail is
 * `--filter-rail-w`, the card image is the same `1.15/1` aspect, the grid has
 * the same three breakpoints. That is the whole job: a skeleton whose boxes
 * differ from the content shifts the layout when the content lands, which is
 * worse than showing nothing.
 *
 * These render inside the prerendered shell, so they are what a visitor sees
 * from the CDN while the filtered results stream in behind them.
 */

/** One neutral block. `bg-sunken` rather than a shimmer: the design system has
 *  no animated placeholder, and motion here would be decoration. */
function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cx("rounded-sm bg-sunken", className)}
      // Announced once by the region below, not once per bar.
      aria-hidden
    />
  );
}

function CardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-md border border-line bg-card p-3">
      <div className="aspect-[1.15/1] w-full rounded-md bg-sunken" aria-hidden />
      <Bar className="mt-3 h-3 w-16" />
      <Bar className="mt-1.5 h-5 w-3/4" />
      <Bar className="mt-2.5 h-5 w-28" />
      <Bar className="mt-3 h-1.5 w-full" />
      <Bar className="mt-1.5 h-3 w-2/3" />
      <Bar className="mt-3.5 h-11 w-full" />
    </div>
  );
}

/** Matches the rail's own `hidden … lg:block` so it never appears on mobile,
 *  where the real filters live in a bottom sheet instead. */
function RailSkeleton() {
  return (
    <aside
      className="hidden w-[var(--filter-rail-w)] shrink-0 self-stretch border-r border-line bg-card px-5 pb-10 pt-5 lg:block"
      aria-hidden
    >
      <Bar className="mb-4 h-4 w-24" />
      {[6, 4, 3, 4].map((rows, group) => (
        <div key={group} className="mb-6">
          <Bar className="mb-3 h-3 w-20" />
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: rows }, (_, row) => (
              <Bar key={row} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

export function CatalogSkeleton({ cards = 12 }: { cards?: number }) {
  return (
    <div className="flex items-stretch" role="status" aria-busy="true">
      <span className="sr-only">Loading rackets</span>
      <RailSkeleton />
      <div className="min-w-0 flex-1 px-4 pb-10 pt-6 lg:px-10">
        <div className="mb-3.5 flex flex-wrap items-center gap-3">
          <Bar className="h-8 w-48" />
          <div className="ml-auto flex items-center gap-2.5">
            <Bar className="h-11 w-24 lg:h-[38px]" />
            <Bar className="h-11 w-36 lg:h-[38px]" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {Array.from({ length: cards }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The comparison table's columns before the picked rackets resolve. */
export function CompareSkeleton() {
  return (
    <div className="page-shell py-8 lg:py-12" role="status" aria-busy="true">
      <span className="sr-only">Loading comparison</span>
      <Bar className="h-3 w-24" />
      <Bar className="mt-2 h-9 w-2/3 max-w-[26rem]" />
      <div className="mt-6 overflow-hidden rounded-md border border-line bg-card">
        {Array.from({ length: 10 }, (_, row) => (
          <div
            key={row}
            className="grid grid-cols-[160px_1fr_1fr] gap-4 border-b border-line px-4 py-3 last:border-0"
          >
            <Bar className="h-4 w-24" />
            <Bar className="h-4 w-full" />
            <Bar className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The finder before it knows whether it is showing the quiz or the results. */
export function FinderSkeleton() {
  return (
    <div className="page-shell py-8 lg:py-12" role="status" aria-busy="true">
      <span className="sr-only">Loading finder</span>
      <Bar className="h-3 w-20" />
      <Bar className="mt-2 h-9 w-3/4 max-w-[30rem]" />
      <div className="mt-8 flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-md border border-line bg-card p-5">
            <Bar className="h-4 w-40" />
            <div className="mt-4 flex flex-wrap gap-2.5">
              {Array.from({ length: 4 }, (_, chip) => (
                <Bar key={chip} className="h-11 w-28" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Auth pages read searchParams only for a callback error or notice, so the
 *  form's own box is all that has to be held. */
export function AuthFormSkeleton() {
  return (
    <div className="page-shell py-12 lg:py-20" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div className="mx-auto w-full max-w-[26rem] rounded-md border border-line bg-card p-6">
        <Bar className="h-7 w-40" />
        <Bar className="mt-2 h-4 w-56" />
        <Bar className="mt-6 h-12 w-full" />
        <Bar className="mt-3 h-12 w-full" />
        <Bar className="mt-5 h-12 w-full" />
        <Bar className="mt-4 h-4 w-48" />
      </div>
    </div>
  );
}
