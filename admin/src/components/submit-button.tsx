"use client";

import type { ReactNode } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  label = "Save changes",
  pendingLabel = "Saving…",
  className = "button-primary",
  icon,
}: {
  label?: string;
  pendingLabel?: string;
  className?: string;
  /** Replaces the default save icon; a destructive button should not show one. */
  icon?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={className}>
      {pending
        ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        : (icon ?? <Save aria-hidden="true" className="size-4" />)}
      {pending ? pendingLabel : label}
    </button>
  );
}
