"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eyebrow } from "@/components/ds/primitives";

export interface SpecEntry {
  label: string;
  value: string;
}

/**
 * Progressive disclosure: eight key fields, the rest one click away. The full
 * sheet is rendered either way so it is in the page source for search and for
 * anyone reading with JavaScript off.
 */
export function SpecSheet({
  keySpecs,
  extraSpecs,
}: {
  keySpecs: SpecEntry[];
  extraSpecs: SpecEntry[];
}) {
  const t = useTranslations("racket");
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? [...keySpecs, ...extraSpecs] : keySpecs;
  const total = keySpecs.length + extraSpecs.length;

  return (
    <div className="rounded-md border border-line bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <Eyebrow as="h2">{t("keySpecs")}</Eyebrow>
        <button
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="ml-auto inline-flex min-h-11 cursor-pointer items-center text-[12px] font-semibold text-brand lg:min-h-7"
        >
          {expanded ? t("hideExtraSpecs") : t("showAllSpecs", { count: total })}
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        {shown.map((spec) => (
          <div key={spec.label} className="min-w-0">
            <dt className="eyebrow !text-[10px]">{spec.label}</dt>
            <dd className="mt-1 [overflow-wrap:anywhere] font-mono text-[13px] tabular-nums text-primary">
              {spec.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
