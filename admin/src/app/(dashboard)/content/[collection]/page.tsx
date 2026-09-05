import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { notFound } from "next/navigation";
import { EntityTable } from "@/components/entity-table";
import { PageHeader } from "@/components/page-header";
import { getCollection } from "@/lib/collections";
import { getCollectionPage } from "@/lib/data";

export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }): Promise<Metadata> {
  const { collection: key } = await params;
  const collection = getCollection(key);
  return { title: collection?.label ?? "Content" };
}

function pageHref(key: string, page: number, query: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return `/content/${key}${suffix ? `?${suffix}` : ""}`;
}

export default async function CollectionPage({ params, searchParams }: {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{ q?: string; page?: string; deleted?: string }>;
}) {
  const [{ collection: key }, queryParams] = await Promise.all([params, searchParams]);
  const collection = getCollection(key);
  if (!collection) notFound();
  const query = queryParams.q?.trim() ?? "";
  const requestedPage = Number(queryParams.page ?? 1);
  const data = await getCollectionPage(collection, query, requestedPage);

  return (
    <>
      <PageHeader eyebrow={collection.group} title={collection.label} description={collection.description} actions={<Link href={`/content/${collection.key}/new`} className="button-primary"><Plus aria-hidden="true" className="size-4" />Add {collection.singular.toLowerCase()}</Link>} />
      {queryParams.deleted ? <div role="status" className="mb-4 rounded-lg border border-[#9fd8bd] bg-[#e8f8f0] px-4 py-3 text-sm font-medium text-[#05603a]">The record was deleted.</div> : null}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action={`/content/${collection.key}`} className="relative w-full sm:max-w-md">
          <label htmlFor="collection-search" className="sr-only">Search {collection.label.toLowerCase()}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8a8491]" />
          <input id="collection-search" name="q" defaultValue={query} placeholder={`Search ${collection.label.toLowerCase()}…`} className="field-control pl-10 pr-24" />
          <button type="submit" className="absolute right-1.5 top-1.5 min-h-8 rounded-md bg-[#eee9ff] px-3 text-xs font-semibold text-[#4423ad] hover:bg-[#ddd3ff]">Search</button>
        </form>
        <p className="shrink-0 text-sm text-[#686470]"><span className="font-semibold tabular-nums text-[#37323d]">{data.count.toLocaleString()}</span> records</p>
      </div>
      <EntityTable collection={collection} rows={data.rows} />
      {data.pageCount > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between">
          {data.page > 1 ? <Link href={pageHref(collection.key, data.page - 1, query)} className="button-secondary"><ChevronLeft aria-hidden="true" className="size-4" />Previous</Link> : <span />}
          <p className="text-sm tabular-nums text-[#686470]">Page {data.page} of {data.pageCount}</p>
          {data.page < data.pageCount ? <Link href={pageHref(collection.key, data.page + 1, query)} className="button-secondary">Next<ChevronRight aria-hidden="true" className="size-4" /></Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}
