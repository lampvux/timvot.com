import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { DeletePanel } from "@/components/delete-panel";
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { getCollection } from "@/lib/collections";
import { getEntity, getRelationOptions } from "@/lib/data";

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
  const [record, options] = await Promise.all([getEntity(collection, id), getRelationOptions(collection)]);
  if (!record) notFound();
  const entityId = String(record[collection.primaryKey]);
  return (
    <>
      <PageHeader eyebrow={collection.label} title={`Edit ${collection.singular.toLowerCase()}`} description={`Record ${entityId}`} actions={<Link href={`/content/${collection.key}`} className="button-secondary"><ChevronLeft aria-hidden="true" className="size-4" />Back to list</Link>} />
      {query.saved ? <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-[#9fd8bd] bg-[#e8f8f0] px-4 py-3 text-sm font-medium text-[#05603a]"><CheckCircle2 aria-hidden="true" className="size-4" />Changes saved.</div> : null}
      <div className="admin-card p-5 sm:p-7"><EntityForm collection={collection} record={record} relationOptions={options} /></div>
      <div className="mt-6"><DeletePanel collection={collection.key} entityId={entityId} singular={collection.singular} /></div>
    </>
  );
}
