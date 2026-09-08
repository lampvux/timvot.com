import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FolderTree, ImagePlus, Pencil, Sparkles } from "lucide-react";
import { setRacketHeroAction } from "@/app/actions/content";
import type { RacketMediaMapping } from "@/lib/data";

export function RacketMediaPanel({ media }: { media: RacketMediaMapping }) {
  const galleryHero = media.images.find((image) => image.isHero);
  const heroMatches = galleryHero
    ? galleryHero.publicUrl === media.heroImageUrl
      && (galleryHero.thumbUrl ?? null) === (media.heroThumbUrl ?? null)
    : !media.images.some((image) => image.publicUrl === media.heroImageUrl);
  const misplacedCount = media.images.filter((image) => !image.folderMatches).length;
  const healthy = heroMatches && misplacedCount === 0;

  return (
    <section className="admin-card overflow-hidden" aria-labelledby="media-mapping-title">
      <div className="flex flex-col gap-4 border-b border-[#e5e2e9] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eee9ff] text-[#5b37d2]">
            <FolderTree aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="media-mapping-title" className="font-bold text-[#282330]">Media mapping</h2>
            <p className="mt-1 text-sm leading-6 text-[#686470]">Expected folder <code className="rounded bg-[#f2f0f4] px-1.5 py-0.5 text-xs text-[#443d4c]">{media.expectedFolder}/</code></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold ${healthy ? "bg-[#e8f8f0] text-[#067647]" : "bg-[#fff4d6] text-[#8a5200]"}`}>
            {healthy ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <AlertTriangle aria-hidden="true" className="size-3.5" />}
            {healthy ? "Mapping aligned" : "Needs attention"}
          </span>
          <Link href={`/content/racket-images/new?racket=${encodeURIComponent(media.racketId)}`} className="button-primary">
            <ImagePlus aria-hidden="true" className="size-4" />Add image
          </Link>
        </div>
      </div>

      {!heroMatches || misplacedCount > 0 ? (
        <div role="status" className="border-b border-[#f1d795] bg-[#fff9e9] px-5 py-3 text-sm text-[#704100] sm:px-6">
          {!heroMatches ? "The selected gallery hero and the racket's hero/thumbnail pointers differ. " : null}
          {misplacedCount > 0 ? `${misplacedCount} image${misplacedCount === 1 ? " is" : "s are"} outside the expected folder. ` : null}
          Open an image below and save it to repair its whole source gallery, or choose a new hero here.
        </div>
      ) : null}

      {media.images.length ? (
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
          {media.images.map((image) => {
            const previewUrl = image.thumbUrl ?? image.publicUrl;
            return (
              <article key={image.id} className="overflow-hidden rounded-xl border border-[#dedbe4] bg-white">
                <div className="relative aspect-[4/3] bg-[#f6f4f8]">
                  {previewUrl ? (
                    <Image src={previewUrl} alt="" fill sizes="(max-width: 640px) 100vw, 320px" className="object-contain p-3" unoptimized />
                  ) : (
                    <div className="grid h-full place-items-center text-xs font-semibold text-[#8a8491]">No public image</div>
                  )}
                  <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                    {image.isHero ? <span className="inline-flex items-center gap-1 rounded-full bg-[#5b37d2] px-2.5 py-1 text-[0.6875rem] font-bold text-white"><Sparkles aria-hidden="true" className="size-3" />Hero</span> : null}
                    {!image.folderMatches ? <span className="rounded-full bg-[#fff0ee] px-2.5 py-1 text-[0.6875rem] font-bold text-[#9c251b]">Wrong folder</span> : null}
                  </div>
                </div>
                <div className="space-y-3 border-t border-[#ebe8f0] p-4">
                  <div>
                    <p className="text-xs font-bold text-[#37323d]">Position {image.position} · {image.provider}</p>
                    <code className="mt-1 block truncate text-[0.6875rem] text-[#686470]" title={`${image.storageBucket}/${image.storagePath}`}>{image.storagePath}</code>
                    <p className={`mt-1 text-[0.6875rem] font-semibold ${image.thumbUrl ? "text-[#067647]" : "text-[#9a5b00]"}`}>{image.thumbUrl ? "Thumbnail ready" : "Thumbnail will be generated on save"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/content/racket-images/${encodeURIComponent(image.id)}`} className="button-secondary min-h-10 px-3">
                      <Pencil aria-hidden="true" className="size-3.5" />Edit mapping
                    </Link>
                    {!image.isHero ? (
                      <form action={setRacketHeroAction}>
                        <input type="hidden" name="racket_id" value={media.racketId} />
                        <input type="hidden" name="image_id" value={image.id} />
                        <button type="submit" className="button-secondary min-h-10 px-3 text-[#5b37d2]">
                          <Sparkles aria-hidden="true" className="size-3.5" />Use as hero
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="px-6 py-10 text-center">
          <p className="font-semibold text-[#37323d]">No gallery images mapped to this racket.</p>
          <p className="mt-1 text-sm text-[#686470]">Upload one here, or find a misplaced image in Racket images and change its racket mapping.</p>
        </div>
      )}
    </section>
  );
}
