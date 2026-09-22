export default function LoadingGuide() {
  return <div className="page-shell grid gap-10 py-12 lg:grid-cols-[240px_minmax(0,1fr)]" role="status" aria-busy="true"><span className="sr-only">Loading guide / Đang tải cẩm nang</span><div className="h-72 animate-pulse rounded-md bg-card" /><div className="space-y-6"><div className="h-28 animate-pulse rounded-md bg-card" /><div className="h-80 animate-pulse rounded-md bg-card" /></div></div>;
}
