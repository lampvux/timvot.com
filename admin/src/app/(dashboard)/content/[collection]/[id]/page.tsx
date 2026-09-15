import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, FilePenLine } from "lucide-react";
import { notFound } from "next/navigation";
import { DeletePanel } from "@/components/delete-panel";
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { RacketMediaPanel } from "@/components/racket-media-panel";
import { getCollection } from "@/lib/collections";
import { getEntity, getRacketMediaMapping, getRelationOptions } from "@/lib/data";

export async function generateMetadata({ params }: { params: Promise<{ collection: string; id: string }> }): Promise<Metadata> {
  const { collection: key, id } = await params;
  const collection = getCollection(key);
  return { title: collection ? `Edit ${collection.singular}` : id };
}

export default async function EditEntityPage({ params, searchParams }: {
  params: Promise<{ collection: string; id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const [{ collection: key, id }, query] = await Promise.all([params, searchParams]);
  const collection = getCollection(key);
  if (!collection) notFound();
  const [record, options, media] = await Promise.all([
    getEntity(collection, id),
    getRelationOptions(collection),
    collection.key === "rackets" ? getRacketMediaMapping(id) : Promise.resolve(null),
  ]);
  if (!record) notFound();
  const entityId = String(record[collection.primaryKey]);
  const isRacket = collection.key === "rackets";
  return (
    <>
      <PageHeader
        eyebrow={collection.label}
        title={`Edit ${collection.singular.toLowerCase()}`}
        description={isRacket ? "Update product details and its Supabase image gallery in one workspace." : `Record ${entityId}`}
        actions={<Link href={`/content/${collection.key}`} className="button-secondary"><ChevronLeft aria-hidden="true" className="size-4" />Back to list</Link>}
      />
      {query.saved ? <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-[#9fd8bd] bg-[#e8f8f0] px-4 py-3 text-sm font-medium text-[#05603a]"><CheckCircle2 aria-hidden="true" className="size-4" />Changes saved.</div> : null}
      {media ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.85fr)]">
          <section className="admin-card overflow-hidden" aria-labelledby="racket-details-title">
            <div className="flex items-start gap-3 border-b border-[#e5e2e9] px-5 py-4 sm:px-7 sm:py-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eef3ff] text-[#3157a4]"><FilePenLine aria-hidden="true" className="size-5" /></span>
              <div>
                <h2 id="racket-details-title" className="font-bold text-[#282330]">Racket details</h2>
                <p className="mt-1 text-sm leading-5 text-[#686470]">Specifications, classification, pricing, and catalogue copy.</p>
              </div>
            </div>
            <div className="p-5 sm:p-7"><EntityForm collection={collection} record={record} relationOptions={options} /></div>
          </section>
          <aside className="min-w-0 xl:sticky xl:top-8"><RacketMediaPanel media={media} /></aside>
        </div>
      ) : (
        <div className="admin-card p-5 sm:p-7"><EntityForm collection={collection} record={record} relationOptions={options} /></div>
      )}
      <div className="mt-6"><DeletePanel collection={collection.key} entityId={entityId} singular={collection.singular} /></div>
    </>
  );
}
