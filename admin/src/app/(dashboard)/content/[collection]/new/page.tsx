import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { EntityForm } from "@/components/entity-form";
import { PageHeader } from "@/components/page-header";
import { getCollection } from "@/lib/collections";
import { getRelationOptions } from "@/lib/data";

export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }): Promise<Metadata> {
  const collection = getCollection((await params).collection);
  return { title: collection ? `New ${collection.singular}` : "New record" };
}

export default async function NewEntityPage({ params, searchParams }: {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{ racket?: string }>;
}) {
  const [{ collection: collectionKey }, query] = await Promise.all([params, searchParams]);
  const collection = getCollection(collectionKey);
  if (!collection) notFound();
  const options = await getRelationOptions(collection);
  const initialValues = collection.key === "racket-images"
    ? { racket_id: query.racket ?? "", position: 0 }
    : null;
  return (
    <>
      <PageHeader eyebrow={collection.label} title={`New ${collection.singular.toLowerCase()}`} description={`Add a ${collection.singular.toLowerCase()} to the shared Shuttlecraft data source.`} actions={<Link href={`/content/${collection.key}`} className="button-secondary"><ChevronLeft aria-hidden="true" className="size-4" />Back to list</Link>} />
      <div className="admin-card p-5 sm:p-7"><EntityForm collection={collection} record={null} relationOptions={options} initialValues={initialValues} /></div>
    </>
  );
}
