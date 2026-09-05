import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-[#6b4bd3]">{eyebrow}</p> : null}
        <h1 className="text-balance text-2xl font-bold tracking-[-0.025em] text-[#17151d] sm:text-[1.75rem]">{title}</h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[#686470] sm:text-base">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
