"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  reviewSellerApplicationAction,
  type SellerReviewState,
} from "@/app/actions/seller-applications";

export function SellerApplicationReviewForm({
  applicationId,
}: {
  applicationId: string;
}) {
  const [state, action, pending] = useActionState<SellerReviewState, FormData>(
    reviewSellerApplicationAction,
    {},
  );

  return (
    <form action={action} className="mt-5 border-t border-[#e5e2e9] pt-4">
      <input type="hidden" name="application_id" value={applicationId} />
      <label htmlFor={`review-notes-${applicationId}`} className="field-label">
        Review notes
      </label>
      <textarea
        id={`review-notes-${applicationId}`}
        name="notes"
        rows={3}
        maxLength={1200}
        className="field-control resize-y"
        placeholder="Optional for approval; required when returning an application."
      />

      {state.message && (
        <div
          role={state.status === "error" ? "alert" : "status"}
          className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
            state.status === "error"
              ? "border-[#efc0bb] bg-[#fff0ee] text-[#8f1b13]"
              : "border-[#9fd8bd] bg-[#e8f8f0] text-[#05603a]"
          }`}
        >
          {state.status === "error" ? (
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{state.message}</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="submit"
          name="decision"
          value="rejected"
          className="button-danger"
          disabled={pending}
        >
          Return for changes
        </button>
        <button
          type="submit"
          name="decision"
          value="approved"
          className="button-primary"
          disabled={pending}
        >
          {pending ? "Saving review…" : "Approve seller"}
        </button>
      </div>
    </form>
  );
}
