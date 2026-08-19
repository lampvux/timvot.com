"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eyebrow } from "@/components/ds/primitives";
import { SpecRow } from "@/components/ds/data";

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
      <div className="mb-3 flex items-baseline gap-2">
        <Eyebrow as="h2">{t("keySpecs")}</Eyebrow>
        <button
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="ml-auto cursor-pointer text-[12.5px] font-semibold text-brand"
        >
          {expanded ? t("hideExtraSpecs") : t("showAllSpecs", { count: total })}
        </button>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {shown.map((spec, index) => (
          <SpecRow
            key={spec.label}
            label={spec.label}
            value={spec.value}
            border={index < shown.length - (shown.length % 2 === 0 ? 2 : 1)}
          />
        ))}
      </dl>
    </div>
  );
}
