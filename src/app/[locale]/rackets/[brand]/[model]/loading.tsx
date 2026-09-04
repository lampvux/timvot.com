import { cx } from "@/components/ds/primitives";

/**
 * Only the 200 highest-scoring rackets are prerendered; the other ~2.800
 * render on demand, and this is what a visitor sees while one of those is
 * built. Boxes match the real page: a 4/3 gallery, a spec grid, an offer table.
 */
function Bar({ className }: { className?: string }) {
  return <div className={cx("rounded-sm bg-sunken", className)} aria-hidden />;
}

export default function Loading() {
  return (
    <div className="page-shell max-w-[1160px] py-5 lg:py-6" role="status" aria-busy="true">
      <span className="sr-only">Loading racket</span>
      <Bar className="mb-5 h-3 w-52" />
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.36fr)_minmax(320px,0.94fr)]">
        <div>
          <Bar className="h-3 w-20" />
          <Bar className="mt-2 h-10 w-3/4" />
          <Bar className="mt-4 h-6 w-40" />
          <div className="mt-5 aspect-[4/3] w-full rounded-md bg-sunken" aria-hidden />
          <Bar className="mt-5 h-12 w-full" />
          <Bar className="mt-6 h-52 w-full" />
          <Bar className="mt-5 h-40 w-full" />
        </div>
        <div className="space-y-5">
          <div className="rounded-md border border-line bg-card p-4">
            <Bar className="h-3 w-24" />
            <div className="mt-4 grid grid-cols-2 gap-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i}>
                <Bar className="h-3 w-16" />
                <Bar className="mt-1.5 h-4 w-28" />
              </div>
            ))}
            </div>
          </div>
          <Bar className="h-64 w-full" />
          <Bar className="h-56 w-full" />
        </div>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Bar key={i} className="h-72 w-full" />
        ))}
      </div>
    </div>
  );
}
