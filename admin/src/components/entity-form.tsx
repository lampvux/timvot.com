"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, FolderSync } from "lucide-react";
import { saveEntityAction, type ContentActionState } from "@/app/actions/content";
import type { CollectionConfig, FieldConfig, FieldOption } from "@/lib/collections";
import { SubmitButton } from "./submit-button";

type EntityRecord = Record<string, unknown>;

function initialValue(record: EntityRecord | null, field: FieldConfig) {
  const value = record?.[field.name];
  if (field.kind === "text-list" && Array.isArray(value)) return value.join(", ");
  if (field.kind === "date" && typeof value === "string") return value.slice(0, 10);
  if (value === null || value === undefined) return "";
  return String(value);
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="mt-1.5 text-xs font-medium text-[#b42318]">{message}</p> : null;
}

function RacketImagePreview({ record }: { record: EntityRecord }) {
  const originalUrl = typeof record.public_url === "string" ? record.public_url : null;
  const thumbUrl = typeof record.thumb_url === "string" ? record.thumb_url : null;
  if (!originalUrl) return null;

  const previews = [
    { label: "Original", url: originalUrl, path: record.storage_path },
    { label: "Thumbnail", url: thumbUrl, path: record.thumb_path },
  ];

  return (
    <section className="rounded-xl border border-[#d9d3ed] bg-[#faf9ff] p-4 sm:p-5" aria-labelledby="current-files-title">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eee9ff] text-[#5b37d2]">
          <FolderSync aria-hidden="true" className="size-4" />
        </span>
        <div>
          <h2 id="current-files-title" className="text-sm font-bold text-[#282330]">Current image mapping</h2>
          <p className="mt-0.5 text-xs leading-5 text-[#686470]">Saving repairs the brand/model folder, moves its paired thumbnail, and synchronizes hero pointers when selected.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {previews.map((preview) => (
          <figure key={preview.label} className="overflow-hidden rounded-lg border border-[#e1ddea] bg-white">
            <div className="relative aspect-[4/3] bg-[#f5f3f8]">
              {preview.url ? (
                <Image src={preview.url} alt={`${preview.label} racket image`} fill sizes="(max-width: 640px) 100vw, 360px" className="object-contain p-3" unoptimized />
              ) : (
                <div className="grid h-full place-items-center text-xs font-semibold text-[#8a8491]">Not generated</div>
              )}
            </div>
            <figcaption className="border-t border-[#ebe8f0] px-3 py-2">
              <span className="text-xs font-bold text-[#37323d]">{preview.label}</span>
              <code className="mt-1 block truncate text-[0.6875rem] text-[#686470]" title={String(preview.path ?? "")}>{String(preview.path ?? "No stored path")}</code>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function FormField({ field, record, editing, relationOptions, error }: {
  field: FieldConfig;
  record: EntityRecord | null;
  editing: boolean;
  relationOptions?: FieldOption[];
  error?: string;
}) {
  if (editing && field.createOnly) return null;
  const id = `field-${field.name}`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [error ? errorId : "", field.help ? helpId : ""].filter(Boolean).join(" ") || undefined;
  const value = initialValue(record, field);
  const disabled = editing && field.readOnlyOnEdit;
  const options = relationOptions ?? field.options ?? [];
  const wrapperClass = field.fullWidth ? "sm:col-span-2" : "";

  if (field.kind === "boolean") {
    return (
      <div className={`${wrapperClass} flex items-start pt-2`}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[#dddbe3] bg-[#f8f8fa] px-3 py-2 text-sm font-semibold">
          <input id={id} name={field.name} type="checkbox" defaultChecked={Boolean(record?.[field.name])} disabled={disabled} className="size-4 accent-[#5b37d2]" />
          {field.label}
        </label>
      </div>
    );
  }

  if (field.kind === "multi-select") {
    const selected = new Set(Array.isArray(record?.[field.name]) ? record?.[field.name] as string[] : []);
    return (
      <fieldset className={`${wrapperClass} rounded-xl border border-[#dddbe3] p-4`} aria-describedby={describedBy}>
        <legend className="px-1 text-[0.8125rem] font-semibold">{field.label}{field.required ? <span className="text-[#b42318]"> *</span> : null}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {options.map((option) => (
            <label key={option.value} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#dddbe3] bg-[#f8f8fa] px-3 text-sm">
              <input type="checkbox" name={field.name} value={option.value} defaultChecked={selected.has(option.value)} className="size-4 accent-[#5b37d2]" />
              {option.label}
            </label>
          ))}
        </div>
        {field.help ? <p id={helpId} className="mt-2 text-xs text-[#686470]">{field.help}</p> : null}
        <FieldError id={errorId} message={error} />
      </fieldset>
    );
  }

  return (
    <div className={wrapperClass}>
      <label htmlFor={id} className="field-label">{field.label}{field.required ? <span className="text-[#b42318]"> *</span> : null}</label>
      {field.kind === "textarea" ? (
        <textarea id={id} name={field.name} required={field.required} defaultValue={value} disabled={disabled} rows={field.name.startsWith("body_") ? 10 : 4} aria-invalid={Boolean(error)} aria-describedby={describedBy} className="field-control min-h-28 resize-y" />
      ) : field.kind === "select" ? (
        <select id={id} name={field.name} required={field.required} defaultValue={value} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={describedBy} className="field-control">
          <option value="">Select {field.label.toLowerCase()}</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <input id={id} name={field.name} type={field.kind === "file" ? "file" : field.kind === "number" ? "number" : field.kind === "date" ? "date" : field.kind === "url" ? "url" : "text"}
          accept={field.kind === "file" ? "image/jpeg,image/png,image/webp,image/avif,image/gif" : undefined}
          required={field.required && !(editing && field.createOnly)} defaultValue={field.kind === "file" ? undefined : value}
          readOnly={disabled && field.kind !== "file"} disabled={disabled && field.kind === "file"}
          min={field.min} max={field.max} step={field.step} placeholder={field.placeholder}
          aria-invalid={Boolean(error)} aria-describedby={describedBy} className="field-control" />
      )}
      {field.help ? <p id={helpId} className="mt-1.5 text-xs leading-5 text-[#686470]">{field.help}</p> : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function EntityForm({ collection, record, relationOptions, initialValues = null }: {
  collection: CollectionConfig;
  record: EntityRecord | null;
  relationOptions: Record<string, FieldOption[]>;
  initialValues?: EntityRecord | null;
}) {
  const [state, formAction] = useActionState(saveEntityAction, {} as ContentActionState);
  const errorRef = useRef<HTMLDivElement>(null);
  const editing = Boolean(record);
  const values = record ?? initialValues;

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} encType="multipart/form-data" className="space-y-6">
      <input type="hidden" name="collection" value={collection.key} />
      <input type="hidden" name="entity_id" value={record ? String(record[collection.primaryKey]) : ""} />
      {state.message ? (
        <div ref={errorRef} tabIndex={-1} role={state.status === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${state.status === "error" ? "border-[#efc0bb] bg-[#fff0ee] text-[#8f1b13]" : "border-[#9fd8bd] bg-[#e8f8f0] text-[#05603a]"}`}>
          {state.status === "error" ? <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          <div><p className="font-semibold">{state.message}</p>{state.fieldErrors ? <ul className="mt-1 list-disc pl-4">{Object.values(state.fieldErrors).map((message) => <li key={message}>{message}</li>)}</ul> : null}</div>
        </div>
      ) : null}
      {collection.key === "racket-images" && record ? <RacketImagePreview record={record} /> : null}
      <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
        {collection.fields.map((field) => (
          <FormField key={field.name} field={field} record={values} editing={editing} relationOptions={relationOptions[field.name]} error={state.fieldErrors?.[field.name]} />
        ))}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-[#e5e2e9] pt-5 sm:flex-row sm:justify-end">
        <Link href={`/content/${collection.key}`} className="button-secondary">Cancel</Link>
        <SubmitButton
          label={editing ? "Save changes" : `Create ${collection.singular.toLowerCase()}`}
          pendingLabel={collection.key === "racket-images" ? "Updating image files…" : "Saving…"}
        />
      </div>
    </form>
  );
}
