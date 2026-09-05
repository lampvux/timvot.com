"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { createStaffAction, type StaffActionState } from "@/app/actions/staff";
import { SubmitButton } from "./submit-button";

export function StaffCreateForm() {
  const [state, formAction] = useActionState(createStaffAction, {} as StaffActionState);
  return (
    <form action={formAction} className="space-y-5">
      {state.message ? <div role={state.status === "error" ? "alert" : "status"} className={`flex gap-2 rounded-lg border px-4 py-3 text-sm ${state.status === "error" ? "border-[#efc0bb] bg-[#fff0ee] text-[#8f1b13]" : "border-[#9fd8bd] bg-[#e8f8f0] text-[#05603a]"}`}>{state.status === "error" ? <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}<span>{state.message}</span></div> : null}
      <div><label htmlFor="display_name" className="field-label">Display name <span className="text-[#b42318]">*</span></label><input id="display_name" name="display_name" required className="field-control" aria-invalid={Boolean(state.fieldErrors?.displayName)} aria-describedby={state.fieldErrors?.displayName ? "display-name-error" : undefined} />{state.fieldErrors?.displayName ? <p id="display-name-error" className="mt-1 text-xs text-[#b42318]">{state.fieldErrors.displayName}</p> : null}</div>
      <div><label htmlFor="staff_email" className="field-label">Email address <span className="text-[#b42318]">*</span></label><input id="staff_email" name="email" type="email" autoComplete="email" required className="field-control" aria-invalid={Boolean(state.fieldErrors?.email)} />{state.fieldErrors?.email ? <p className="mt-1 text-xs text-[#b42318]">{state.fieldErrors.email}</p> : null}</div>
      <div><label htmlFor="staff_password" className="field-label">Temporary password <span className="text-[#b42318]">*</span></label><input id="staff_password" name="password" type="password" autoComplete="new-password" minLength={12} required className="field-control" aria-invalid={Boolean(state.fieldErrors?.password)} /><p className="mt-1 text-xs text-[#686470]">At least 12 characters. Share it through a secure channel.</p>{state.fieldErrors?.password ? <p className="mt-1 text-xs text-[#b42318]">{state.fieldErrors.password}</p> : null}</div>
      <div><label htmlFor="staff_role" className="field-label">Role <span className="text-[#b42318]">*</span></label><select id="staff_role" name="role" defaultValue="manager" className="field-control"><option value="manager">Manager · content only</option><option value="admin">Admin · content and staff</option></select></div>
      <SubmitButton label="Create staff account" pendingLabel="Creating account…" />
    </form>
  );
}
