"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Database,
  ImagePlus,
  Images,
  Layers3,
  LoaderCircle,
  Pencil,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  setRacketHeroFromEditorAction,
  updateRacketGalleryImageAction,
  uploadRacketGalleryImagesAction,
  type ContentActionState,
} from "@/app/actions/content";
import type { RacketMediaImage, RacketMediaMapping } from "@/lib/data";
import { SubmitButton } from "./submit-button";

function ActionNotice({ state }: { state: ContentActionState }) {
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

function UploadPanel({ media, onClose }: { media: RacketMediaMapping; onClose: () => void }) {
  const [state, formAction] = useActionState(
    uploadRacketGalleryImagesAction,
    {} as ContentActionState,
  );
  const [previews, setPreviews] = useState<Array<{ name: string; url: string }>>([]);
  const nextPosition = media.images.reduce(
    (highest, image) => Math.max(highest, image.position),
    -1,
  ) + 1;

  useEffect(() => () => {
    previews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [previews]);

  if (state.status === "success") {
    return (
      <div id="racket-gallery-upload" className="border-b border-[#9fd8bd] bg-[#f2fbf6] p-5 text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-full bg-[#d7f2e4] text-[#067647]"><CheckCircle2 aria-hidden="true" className="size-5" /></span>
        <p role="status" className="mt-3 text-sm font-bold text-[#05603a]">{state.message}</p>
        <p className="mt-1 text-xs leading-5 text-[#4c6d5e]">The new database records are visible in the gallery below.</p>
        <button type="button" onClick={onClose} className="button-secondary mt-4 min-h-10 px-4">Done</button>
      </div>
    );
  }

  return (
    <div id="racket-gallery-upload" className="border-b border-[#dedbe4] bg-[#faf9ff] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#282330]">Add gallery images</h3>
          <p className="mt-1 text-xs leading-5 text-[#686470]">Files are uploaded to Supabase Storage and each becomes a database record for this racket.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close image upload" className="grid size-10 shrink-0 place-items-center rounded-lg text-[#686470] hover:bg-[#eee9ff] hover:text-[#4423ad]">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <form action={formAction} encType="multipart/form-data" className="mt-4 space-y-4">
        <input type="hidden" name="racket_id" value={media.racketId} />
        <div>
          <label htmlFor="gallery-image-files" className="field-label">Image files <span className="text-[#b42318]">*</span></label>
          <label htmlFor="gallery-image-files" className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#bdb5d1] bg-white px-4 py-5 text-center transition-colors hover:border-[#7a5af8] hover:bg-[#fbfaff]">
            <Upload aria-hidden="true" className="size-5 text-[#5b37d2]" />
            <span className="mt-2 text-sm font-bold text-[#37323d]">Choose one or more images</span>
            <span className="mt-1 text-xs text-[#686470]">JPEG, PNG, WebP, AVIF, or GIF · up to 12 files · 15 MB each</span>
          </label>
          <input
            id="gallery-image-files"
            name="image_files"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            multiple
            required
            aria-invalid={Boolean(state.fieldErrors?.image_files)}
            aria-describedby={state.fieldErrors?.image_files ? "gallery-image-files-error" : undefined}
            className="sr-only"
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.files ?? []);
              setPreviews(selected.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
            }}
          />
          {state.fieldErrors?.image_files ? <p id="gallery-image-files-error" className="mt-1.5 text-xs font-semibold text-[#b42318]">{state.fieldErrors.image_files}</p> : null}
        </div>

        {previews.length ? (
          <div className="grid grid-cols-3 gap-2" aria-label={`${previews.length} selected image previews`}>
            {previews.slice(0, 6).map((preview) => (
              <figure key={preview.url} className="min-w-0 overflow-hidden rounded-lg border border-[#dddbe3] bg-white">
                <div className="relative aspect-square bg-[#f4f2f7]">
                  <Image src={preview.url} alt={`Selected upload: ${preview.name}`} fill sizes="140px" className="object-contain p-1.5" unoptimized />
                </div>
                <figcaption className="truncate px-2 py-1.5 text-[0.625rem] font-semibold text-[#686470]" title={preview.name}>{preview.name}</figcaption>
              </figure>
            ))}
            {previews.length > 6 ? <div className="grid aspect-square place-items-center rounded-lg border border-[#dddbe3] bg-white text-xs font-bold text-[#5b37d2]">+{previews.length - 6} more</div> : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="gallery-position" className="field-label">Starting position</label>
            <input id="gallery-position" name="position" type="number" min={0} required defaultValue={nextPosition} className="field-control" aria-invalid={Boolean(state.fieldErrors?.position)} aria-describedby={state.fieldErrors?.position ? "gallery-position-error" : "gallery-position-help"} />
            {state.fieldErrors?.position ? <p id="gallery-position-error" className="mt-1 text-[0.6875rem] font-semibold text-[#b42318]">{state.fieldErrors.position}</p> : null}
            <p id="gallery-position-help" className="mt-1 text-[0.6875rem] leading-4 text-[#77717e]">Additional files follow in selection order.</p>
          </div>
          <div>
            <label htmlFor="gallery-colourway" className="field-label">Colourway</label>
            <input id="gallery-colourway" name="colourway" type="text" className="field-control" placeholder="Optional" />
          </div>
        </div>

        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[#dddbe3] bg-white px-3 py-2 text-sm font-semibold text-[#37323d]">
          <input name="make_first_hero" type="checkbox" defaultChecked={!media.images.some((image) => image.isHero)} className="size-4 accent-[#5b37d2]" />
          Use the first image as the product hero
        </label>

        <details className="group rounded-lg border border-[#e1ddea] bg-white">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-xs font-bold text-[#56515e]">
            Source details (optional)
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-[#ebe8f0] p-3">
            <label htmlFor="gallery-source-page" className="field-label">Manufacturer source page</label>
            <input id="gallery-source-page" name="source_page_url" type="text" className="field-control" placeholder="Leave blank for an admin upload record" />
          </div>
        </details>

        <ActionNotice state={state} />
        <SubmitButton label={previews.length > 1 ? `Upload ${previews.length} images` : "Upload image"} pendingLabel="Uploading to Supabase…" className="button-primary w-full" />
      </form>
    </div>
  );
}

function SetHeroButton({ racketId, imageId }: { racketId: string; imageId: string }) {
  const [state, formAction, pending] = useActionState(
    setRacketHeroFromEditorAction,
    {} as ContentActionState,
  );

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="racket_id" value={racketId} />
      <input type="hidden" name="image_id" value={imageId} />
      <button type="submit" disabled={pending} className="button-secondary min-h-10 w-full px-3 text-[#5b37d2]">
        {pending ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Sparkles aria-hidden="true" className="size-3.5" />}
        {pending ? "Updating roles…" : "Use as hero + thumbnail"}
      </button>
      <ActionNotice state={state} />
    </form>
  );
}

function ImageRecordEditor({ image, racketId }: { image: RacketMediaImage; racketId: string }) {
  const [state, formAction] = useActionState(
    updateRacketGalleryImageAction,
    {} as ContentActionState,
  );

  return (
    <details className="group mt-3 rounded-lg border border-[#e1ddea] bg-[#faf9fb]">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 text-xs font-bold text-[#56515e]">
        <span className="inline-flex items-center gap-1.5"><Pencil aria-hidden="true" className="size-3.5" />Edit image details</span>
        <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <form action={formAction} className="space-y-3 border-t border-[#e5e2e9] p-3">
        <input type="hidden" name="racket_id" value={racketId} />
        <input type="hidden" name="image_id" value={image.id} />
        {image.isHero ? <input type="hidden" name="is_hero" value="on" /> : null}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`position-${image.id}`} className="field-label">Position</label>
            <input id={`position-${image.id}`} name="position" type="number" min={0} required defaultValue={image.position} className="field-control" aria-invalid={Boolean(state.fieldErrors?.position)} aria-describedby={state.fieldErrors?.position ? `position-${image.id}-error` : undefined} />
            {state.fieldErrors?.position ? <p id={`position-${image.id}-error`} className="mt-1 text-[0.6875rem] font-semibold text-[#b42318]">{state.fieldErrors.position}</p> : null}
          </div>
          <div>
            <label htmlFor={`colourway-${image.id}`} className="field-label">Colourway</label>
            <input id={`colourway-${image.id}`} name="colourway" type="text" defaultValue={image.colourway ?? ""} className="field-control" />
          </div>
        </div>
        <div>
          <label htmlFor={`source-${image.id}`} className="field-label">Source page or upload ID</label>
          <input id={`source-${image.id}`} name="source_page_url" type="text" defaultValue={image.sourcePageUrl} className="field-control" />
        </div>
        <ActionNotice state={state} />
        <SubmitButton label="Save image details" pendingLabel="Saving image…" className="button-secondary min-h-10 w-full px-3" />
      </form>
    </details>
  );
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function GalleryCard({ image, media }: { image: RacketMediaImage; media: RacketMediaMapping }) {
  const previewUrl = image.thumbUrl ?? image.publicUrl;
  const dimensions = image.width && image.height ? `${image.width} × ${image.height}` : null;
  const fileSize = formatBytes(image.bytes);

  return (
    <article className={`overflow-hidden rounded-xl border bg-white ${image.isHero ? "border-[#9d88e7] ring-2 ring-[#eee9ff] sm:col-span-2" : "border-[#dedbe4]"}`}>
      <div className={`relative bg-[#f6f4f8] ${image.isHero ? "aspect-[16/10]" : "aspect-square"}`}>
        {previewUrl ? (
          <Image
            src={previewUrl}
            alt={`${media.racketName} ${image.isHero ? "hero" : `gallery image ${image.position}`}`}
            fill
            sizes="(max-width: 640px) 100vw, 360px"
            className="object-contain p-3"
            unoptimized
          />
        ) : (
          <div className="grid h-full place-items-center text-xs font-semibold text-[#8a8491]">No public image</div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          {image.isHero ? <span className="inline-flex items-center gap-1 rounded-full bg-[#5b37d2] px-2.5 py-1 text-[0.6875rem] font-bold text-white"><Sparkles aria-hidden="true" className="size-3" />Hero + card</span> : <span className="rounded-full bg-white/95 px-2.5 py-1 text-[0.6875rem] font-bold text-[#56515e] shadow-sm">Gallery {image.position}</span>}
          {image.adminManaged ? <span className="rounded-full bg-[#e8f8f0] px-2.5 py-1 text-[0.6875rem] font-bold text-[#05603a] shadow-sm">Manual override</span> : null}
          {!image.folderMatches ? <span className="rounded-full bg-[#fff0ee] px-2.5 py-1 text-[0.6875rem] font-bold text-[#9c251b]">Storage needs repair</span> : null}
        </div>
      </div>
      <div className="border-t border-[#ebe8f0] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#37323d]">Database image record</p>
            <p className="mt-0.5 truncate text-[0.6875rem] text-[#77717e]" title={image.id}>{image.id}</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#f2f0f4] px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.06em] text-[#686470]">{image.provider}</span>
        </div>

        <div className="mt-3 rounded-lg bg-[#f7f5fc] p-2.5">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.08em] text-[#7965b8]">Mapped to</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {image.isHero ? <>
              <span className="rounded-full bg-white px-2 py-1 text-[0.6875rem] font-semibold text-[#4423ad] ring-1 ring-[#d9d0fb]">Product hero</span>
              <span className="rounded-full bg-white px-2 py-1 text-[0.6875rem] font-semibold text-[#4423ad] ring-1 ring-[#d9d0fb]">Catalogue thumbnail</span>
            </> : null}
            <span className="rounded-full bg-white px-2 py-1 text-[0.6875rem] font-semibold text-[#56515e] ring-1 ring-[#dddbe3]">Gallery</span>
          </div>
        </div>

        {(image.colourway || dimensions || fileSize) ? (
          <p className="mt-2.5 text-[0.6875rem] leading-5 text-[#686470]">
            {[image.colourway, dimensions, fileSize].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <p className={`mt-1 text-[0.6875rem] font-semibold ${image.thumbUrl ? "text-[#067647]" : "text-[#9a5b00]"}`}>
          {image.thumbUrl ? "Paired thumbnail ready" : "Using original until thumbnail is generated"}
        </p>

        {!image.isHero ? <SetHeroButton racketId={media.racketId} imageId={image.id} /> : null}
        <ImageRecordEditor image={image} racketId={media.racketId} />
      </div>
    </article>
  );
}

export function RacketMediaPanel({ media }: { media: RacketMediaMapping }) {
  const [showUpload, setShowUpload] = useState(media.images.length === 0);
  const misplacedCount = media.images.filter((image) => !image.folderMatches).length;

  return (
    <section className="admin-card overflow-hidden" aria-labelledby="racket-gallery-title">
      <div className="flex items-start justify-between gap-3 border-b border-[#e5e2e9] p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eee9ff] text-[#5b37d2]">
            <Images aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="racket-gallery-title" className="font-bold text-[#282330]">Racket gallery</h2>
            <p className="mt-1 text-sm leading-5 text-[#686470]">{media.images.length} database image record{media.images.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <button type="button" onClick={() => setShowUpload((open) => !open)} aria-expanded={showUpload} aria-controls="racket-gallery-upload" className="button-primary shrink-0 px-3">
          <ImagePlus aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Add images</span>
        </button>
      </div>

      {showUpload ? <UploadPanel media={media} onClose={() => setShowUpload(false)} /> : null}

      {!media.heroPointersMatch ? (
        <div role="alert" className="flex items-start gap-2 border-b border-[#f1d795] bg-[#fff9e9] px-4 py-3 text-xs leading-5 text-[#704100] sm:px-5">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>The legacy racket URL pointers do not match the selected database hero. Choose a gallery image as hero to synchronize them.</span>
        </div>
      ) : null}

      {media.images.length ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          {media.images.map((image) => <GalleryCard key={image.id} image={image} media={media} />)}
        </div>
      ) : (
        <div className="px-6 py-10 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#eee9ff] text-[#5b37d2]"><ImagePlus aria-hidden="true" className="size-5" /></span>
          <p className="mt-3 font-semibold text-[#37323d]">No images yet</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-6 text-[#686470]">Upload the first image here. It will be stored in Supabase and mapped directly to this racket.</p>
        </div>
      )}

      <details className="group border-t border-[#e5e2e9] bg-[#faf9fb]">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs font-bold text-[#686470] sm:px-5">
          <span className="inline-flex items-center gap-2"><Database aria-hidden="true" className="size-4" />Storage record details</span>
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-2 border-t border-[#e5e2e9] px-4 py-3 text-xs leading-5 text-[#686470] sm:px-5">
          <p><span className="font-bold text-[#37323d]">Expected folder:</span> <code className="break-all">{media.expectedFolder}/</code></p>
          <p className="flex items-center gap-2">
            {misplacedCount === 0 ? <CheckCircle2 aria-hidden="true" className="size-3.5 text-[#067647]" /> : <Layers3 aria-hidden="true" className="size-3.5 text-[#b42318]" />}
            {misplacedCount === 0 ? "All image files match this racket folder." : `${misplacedCount} image file${misplacedCount === 1 ? " is" : "s are"} outside this racket folder.`}
          </p>
        </div>
      </details>
    </section>
  );
}
