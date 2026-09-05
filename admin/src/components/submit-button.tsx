"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ label = "Save changes", pendingLabel = "Saving…", className = "button-primary" }: { label?: string; pendingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-disabled={pending} className={className}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}{pending ? pendingLabel : label}</button>;
}
