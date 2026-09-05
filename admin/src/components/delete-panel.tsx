"use client";

import { useActionState } from "react";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { deleteEntityAction, type ContentActionState } from "@/app/actions/content";

function DeleteButton({ singular }: { singular: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="button-danger shrink-0">{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" className="size-4" />}{pending ? "Deleting…" : `Delete ${singular.toLowerCase()}`}</button>;
}

export function DeletePanel({ collection, entityId, singular }: { collection: string; entityId: string; singular: string }) {
  const [state, formAction] = useActionState(deleteEntityAction, {} as ContentActionState);
  return (
    <div className="admin-card border-[#efc0bb] bg-[#fffafa] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[#b42318]" /><div><h2 className="font-semibold text-[#8f1b13]">Danger zone</h2><p className="mt-1 max-w-2xl text-sm text-[#756b72]">Deletion is permanent and may cascade to related records. Confirm references before continuing.</p></div></div>
        <form action={formAction} onSubmit={(event) => { if (!window.confirm(`Permanently delete this ${singular.toLowerCase()}?`)) event.preventDefault(); }}>
          <input type="hidden" name="collection" value={collection} /><input type="hidden" name="entity_id" value={entityId} /><DeleteButton singular={singular} />
        </form>
      </div>
      {state.message ? <p role="alert" className="mt-3 text-sm font-medium text-[#b42318]">{state.message}</p> : null}
    </div>
  );
}
