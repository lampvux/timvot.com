import { cx } from "@/components/ds/primitives";

/**
 * Loading shapes, not spinners.
 *
 * Every box here matches the real component's geometry — the rail is
 * `--filter-rail-w`, the card image has the same compact aspect, and the grid
 * follows the catalogue's responsive column count. That is the whole job: a skeleton whose boxes
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
    <div className="flex h-full flex-col rounded-md border border-line bg-card p-2">
      <div className="aspect-[1.05/1] w-full rounded-md bg-sunken" aria-hidden />
      <Bar className="mt-2 h-3 w-16" />
      <Bar className="mt-1.5 h-5 w-3/4" />
      <Bar className="mt-2.5 h-5 w-28" />
      <Bar className="mt-3 h-1.5 w-full" />
      <Bar className="mt-1.5 h-3 w-2/3" />
      <Bar className="mt-2 h-11 w-full lg:h-7" />
    </div>
  );
}

/** Matches the rail's own `hidden … lg:block` so it never appears on mobile,
 *  where the real filters live in a bottom sheet instead. */
function RailSkeleton() {
  return (
    <aside
      className="hidden w-[var(--filter-rail-w)] shrink-0 self-stretch border-r border-line bg-card px-5 pb-10 pt-5 min-[1440px]:block"
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
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 min-[1081px]:!grid-cols-6">
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

/** The listing check before it knows whether it is showing the form or a result. */
export function CheckSkeleton() {
  return (
    <div className="page-shell py-8 lg:py-12" role="status" aria-busy="true">
      <span className="sr-only">Loading listing check</span>
      <div className="mx-auto max-w-[560px]">
        <Bar className="h-9 w-3/4" />
        <Bar className="mt-3 h-5 w-full" />
        <div className="mt-8 flex flex-col gap-6">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i}>
              <Bar className="h-4 w-32" />
              <Bar className="mt-2 h-12 w-full" />
            </div>
          ))}
          <Bar className="h-12 w-full" />
        </div>
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

export function DealsSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading price drop deals</span>
      <div className="bg-green-900">
        <div className="page-shell grid gap-8 py-9 lg:grid-cols-2 lg:py-14">
          <div>
            <Bar className="h-6 w-36 !bg-green-800" />
            <Bar className="mt-4 h-12 w-4/5 !bg-green-800" />
            <Bar className="mt-3 h-4 w-full max-w-md !bg-green-800" />
            <div className="mt-6 grid max-w-sm grid-cols-3 gap-5">
              <Bar className="h-10 !bg-green-800" />
              <Bar className="h-10 !bg-green-800" />
              <Bar className="h-10 !bg-green-800" />
            </div>
          </div>
          <div className="h-48 rounded-md border border-green-800 bg-green-800" />
        </div>
      </div>
      <div className="page-shell py-10 lg:py-12">
        <Bar className="h-3 w-32" />
        <Bar className="mt-2 h-8 w-48" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-md border border-line bg-card">
              <div className="aspect-[1.35/1] bg-sunken" />
              <div className="p-3.5">
                <Bar className="h-3 w-16" />
                <Bar className="mt-2 h-5 w-3/4" />
                <Bar className="mt-3 h-5 w-28" />
                <Bar className="mt-4 h-11 w-full lg:h-7" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Bar key={i} className="h-[74px] w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SellersSkeleton() {
  return (
    <div className="page-shell py-8 lg:py-12" role="status" aria-busy="true">
      <span className="sr-only">Loading sellers directory</span>
      <Bar className="h-3 w-24" />
      <Bar className="mt-2 h-9 w-3/4 max-w-[26rem]" />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-md border border-line bg-card p-4">
            <Bar className="h-5 w-24" />
            <Bar className="mt-2 h-3.5 w-full" />
          </div>
        ))}
      </div>
      <SellerDirectorySkeleton bare />
    </div>
  );
}

/** The ranked list alone: the fallback while the directory reads its URL.
 *  Same boxes as the real controls and cards so nothing moves on arrival. */
export function SellerDirectorySkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div
      className="mt-8"
      {...(bare ? {} : { role: "status", "aria-busy": true })}
    >
      {!bare && <span className="sr-only">Loading sellers directory</span>}
      <div className="space-y-3 rounded-md border border-line bg-card p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Bar className="h-3 w-16" />
            <Bar className="h-11 w-24 lg:h-8" />
            <Bar className="h-11 w-24 lg:h-8" />
            <Bar className="h-11 w-24 lg:h-8" />
          </div>
        ))}
      </div>
      <Bar className="mt-5 h-3.5 w-32" />
      <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-md border border-line bg-card p-5">
            <Bar className="h-5 w-36" />
            <Bar className="mt-2 h-4 w-20" />
            <Bar className="mt-3 h-3.5 w-full" />
            <Bar className="mt-1.5 h-3.5 w-4/5" />
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
              <Bar className="h-4 w-12" />
              <Bar className="h-4 w-12" />
              <Bar className="h-4 w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GuidesSkeleton() {
  return (
    <div className="page-shell py-8 lg:py-12" role="status" aria-busy="true">
      <span className="sr-only">Loading buying guides</span>
      <Bar className="h-3 w-24" />
      <Bar className="mt-2 h-9 w-2/3 max-w-[26rem]" />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-md border border-line bg-card p-6">
            <Bar className="h-6 w-4/5" />
            <Bar className="mt-3 h-4 w-full" />
            <Bar className="mt-1.5 h-4 w-3/4" />
            <Bar className="mt-4 h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SellerDetailSkeleton() {
  return (
    <div className="page-shell py-8 lg:py-12" role="status" aria-busy="true">
      <span className="sr-only">Loading seller profile</span>
      <Bar className="h-3 w-20" />
      <Bar className="mt-2 h-9 w-64" />
      <Bar className="mt-3 h-4 w-32" />
      <Bar className="mt-4 h-4 w-full max-w-[42rem]" />
      <div className="mt-8 overflow-hidden rounded-md border border-line bg-card">
        <div className="h-10 border-b border-line bg-sunken" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center justify-between border-b border-line px-4 py-3.5 last:border-0">
            <div>
              <Bar className="h-4 w-40" />
              <Bar className="mt-1 h-3 w-24" />
            </div>
            <Bar className="h-5 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

