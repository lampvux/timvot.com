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
    <div className="page-shell py-8 lg:py-12" role="status" aria-busy="true">
      <span className="sr-only">Loading racket</span>
      <div className="grid gap-8 lg:grid-cols-[550px_1fr] lg:gap-12">
        <div className="aspect-[4/3] w-full rounded-md bg-sunken" aria-hidden />
        <div>
          <Bar className="h-3 w-20" />
          <Bar className="mt-2 h-10 w-3/4" />
          <Bar className="mt-4 h-6 w-40" />
          <Bar className="mt-6 h-12 w-full max-w-[22rem]" />
          <div className="mt-8 grid grid-cols-2 gap-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i}>
                <Bar className="h-3 w-16" />
                <Bar className="mt-1.5 h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-10 overflow-hidden rounded-md border border-line bg-card">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="border-b border-line px-4 py-3.5 last:border-0">
            <Bar className="h-4 w-full max-w-[36rem]" />
          </div>
        ))}
      </div>
    </div>
  );
}
