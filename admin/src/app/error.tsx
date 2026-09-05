"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f4f5f7] px-4 py-10">
      <div className="admin-card w-full max-w-lg p-7 text-center"><span className="mx-auto grid size-12 place-items-center rounded-full bg-[#fff0ee] text-[#b42318]"><AlertTriangle aria-hidden="true" className="size-5" /></span><h1 className="mt-4 text-xl font-bold">The admin console hit a problem</h1><p className="mt-2 text-sm leading-6 text-[#686470]">{error.message || "The request could not be completed. Try again, then check the deployment logs if it persists."}</p><button onClick={reset} className="button-primary mt-5"><RotateCcw aria-hidden="true" className="size-4" />Try again</button></div>
    </main>
  );
}
