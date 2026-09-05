export default function DashboardLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading admin content" className="animate-pulse space-y-5">
      <div className="h-8 w-64 rounded-lg bg-[#e7e4eb]" />
      <div className="h-5 w-full max-w-xl rounded bg-[#e7e4eb]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-36 rounded-[14px] border border-[#e2dfe6] bg-white" />)}
      </div>
      <div className="h-80 rounded-[14px] border border-[#e2dfe6] bg-white" />
    </div>
  );
}
