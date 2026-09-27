"use client";

import { useState } from "react";
import { Button } from "@/components/ds/primitives";

/**
 * Copies text, or a same-origin path as an absolute URL, to the clipboard.
 * The copied state is announced so a screen reader hears the result.
 */
export function CopyButton({
  text,
  path,
  label,
  copiedLabel,
  failedLabel,
  variant = "secondary",
}: {
  text?: string;
  path?: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
  variant?: "primary" | "secondary";
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      const value = path ? new URL(path, window.location.origin).toString() : (text ?? "");
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        size="lg"
        variant={variant}
        iconLeft={state === "copied" ? "Check" : "Copy"}
        onClick={copy}
      >
        {state === "copied" ? copiedLabel : label}
      </Button>
      <span role="status" className={state === "failed" ? "text-caption text-risk" : "sr-only"}>
        {state === "copied" ? copiedLabel : state === "failed" ? failedLabel : ""}
      </span>
    </div>
  );
}
