"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ImagePlus, Trash2, Upload } from "lucide-react";
import type { ContentActionState } from "@/app/actions/content";
import {
  removeStringImageAction,
  uploadStringImageAction,
} from "@/app/actions/string-images";
import type { StringMedia } from "@/lib/data";
import { SubmitButton } from "./submit-button";

function Notice({ state }: { state: ContentActionState }) {
  if (!state.message) return null;
  const success = state.status === "success";
  return (
    <div
      role={success ? "status" : "alert"}
      className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5 ${success
        ? "border-[#9fd8bd] bg-[#e8f8f0] text-[#05603a]"
        : "border-[#efc0bb] bg-[#fff0ee] text-[#8f1b13]"}`}
    >
      {success
        ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        : <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
      <span className="font-semibold">{state.message}</span>
    </div>
  );
}

function sourceLabel(source: string | null) {
  if (!source) return null;
  if (source.startsWith("admin-upload:")) return "Uploaded by staff";
  return source;
}

/**
 * One packshot per string: add it, replace it, or remove it. The storefront's
 * list and detail pages read the same row, so a save here is what shoppers
 * see once the storefront cache revalidates.
 */
export function StringMediaPanel({ media }: { media: StringMedia }) {
  const [uploadState, uploadAction] = useActionState(uploadStringImageAction, {} as ContentActionState);
  const [removeState, removeAction] = useActionState(removeStringImageAction, {} as ContentActionState);
  const [selected, setSelected] = useState<
    { name: string; url: string; basis: ContentActionState } | null
  >(null);

  useEffect(() => () => {
    if (selected) URL.revokeObjectURL(selected.url);
  }, [selected]);

  // The preview belongs to the state it was chosen under. Once that upload
  // succeeds the action returns a new state and the stored image takes over;
  // after a failure the chosen file is still in the input, so it stays.
  const preview =
    selected && (selected.basis === uploadState || uploadState.status === "error")
      ? selected
      : null;

  const shown = preview?.url ?? media.imageUrl;
  const source = sourceLabel(media.sourceUrl);

  return (
    <section className="admin-card overflow-hidden" aria-labelledby="string-image-title">
      <div className="flex items-start gap-3 border-b border-[#e5e2e9] p-4 sm:p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eee9ff] text-[#5b37d2]">
          <ImagePlus aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="string-image-title" className="font-bold text-[#282330]">String image</h2>
          <p className="mt-1 text-sm leading-5 text-[#686470]">
            {media.imageUrl ? "Shown on the strings list and this string's page." : "No image yet. The storefront shows the brand name in its place."}
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="relative aspect-square overflow-hidden rounded-xl border border-[#dedbe4] bg-[#f6f4f8]">
          {shown ? (
            <Image
              src={shown}
              alt={preview ? `Selected upload: ${preview.name}` : `${media.brandName} ${media.stringName}`}
              fill
              sizes="(max-width: 640px) 100vw, 380px"
              className="object-contain p-4"
              unoptimized
            />
          ) : (
            <div className="grid h-full place-items-center text-xs font-semibold uppercase tracking-[0.08em] text-[#8a8491]">
              {media.brandName}
            </div>
          )}
          {preview ? (
            <span className="absolute left-2 top-2 rounded-full bg-[#5b37d2] px-2.5 py-1 text-[0.6875rem] font-bold text-white">Not saved yet</span>
          ) : media.thumbUrl ? (
            <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2.5 py-1 text-[0.6875rem] font-bold text-[#067647] shadow-sm">Thumbnail ready</span>
          ) : null}
        </div>

        {source && !preview ? (
          <p className="mt-2 truncate text-[0.6875rem] text-[#77717e]" title={source}>
            Source: {source}
          </p>
        ) : null}

        <form action={uploadAction} encType="multipart/form-data" className="mt-4 space-y-3">
          <input type="hidden" name="string_id" value={media.stringId} />
          <label
            htmlFor="string-image-file"
            className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#bdb5d1] bg-white px-4 py-4 text-center transition-colors hover:border-[#7a5af8] hover:bg-[#fbfaff]"
          >
            <Upload aria-hidden="true" className="size-5 text-[#5b37d2]" />
            <span className="mt-1.5 text-sm font-bold text-[#37323d]">
              {preview ? preview.name : media.imageUrl ? "Choose a replacement image" : "Choose an image"}
            </span>
            <span className="mt-0.5 text-xs text-[#686470]">JPEG, PNG, WebP, AVIF, or GIF · up to 15 MB</span>
          </label>
          <input
            id="string-image-file"
            name="image_file"
            type="file"
            required
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            className="sr-only"
            aria-invalid={Boolean(uploadState.fieldErrors?.image_file)}
            aria-describedby={uploadState.fieldErrors?.image_file ? "string-image-file-error" : undefined}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              setSelected(file ? { name: file.name, url: URL.createObjectURL(file), basis: uploadState } : null);
            }}
          />
          {uploadState.fieldErrors?.image_file ? (
            <p id="string-image-file-error" className="text-xs font-semibold text-[#b42318]">{uploadState.fieldErrors.image_file}</p>
          ) : null}
          <div>
            <label htmlFor="string-image-source" className="field-label">Source page (optional)</label>
            <input
              id="string-image-source"
              name="source_page_url"
              type="text"
              className="field-control"
              placeholder="Manufacturer product page"
              defaultValue={media.sourceUrl?.startsWith("admin-upload:") ? "" : (media.sourceUrl ?? "")}
            />
          </div>
          <Notice state={uploadState} />
          <SubmitButton
            label={media.imageUrl ? "Replace image" : "Upload image"}
            pendingLabel="Uploading to Supabase…"
            className="button-primary w-full"
          />
        </form>

        {media.imageUrl ? (
          <form action={removeAction} className="mt-3">
            <input type="hidden" name="string_id" value={media.stringId} />
            <SubmitButton label="Remove image" pendingLabel="Removing…" className="button-secondary min-h-10 w-full text-[#b42318]" icon={<Trash2 aria-hidden="true" className="size-3.5" />} />
            <Notice state={removeState} />
          </form>
        ) : null}

        <p className="mt-4 text-[0.6875rem] leading-4 text-[#77717e]">
          Stored in Supabase bucket <code>string-images</code> under <code className="break-all">{media.folder}/</code>. A 400px thumbnail is generated for the list view.
        </p>
      </div>
    </section>
  );
}
