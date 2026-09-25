import Image from "next/image";
import Link from "next/link";
import { ArrowRight, SearchX } from "lucide-react";
import type { CollectionConfig, ListColumn } from "@/lib/collections";
import type { EntityRecord } from "@/lib/data";

function displayValue(row: EntityRecord, column: ListColumn) {
  let value = row[column.name];
  if (column.kind === "image" && !value) value = row.public_url ?? row.hero_image_url ?? row.image_url;
  if (column.kind === "image") {
    return value ? (
      <span className="relative block size-10 overflow-hidden rounded-lg border border-[#e5e2e9] bg-[#f7f6f9]">
        <Image src={String(value)} alt="" fill sizes="40px" className="object-cover" unoptimized />
      </span>
    ) : <span className="grid size-10 place-items-center rounded-lg bg-[#f2f0f4] text-[0.625rem] font-bold text-[#8a8491]">N/A</span>;
  }
  if (column.kind === "currency" && value !== null && value !== undefined) return <span className="tabular-nums">{new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value))}</span>;
  if (column.kind === "date" && value) return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(String(value)));
  if (column.kind === "boolean") return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${value ? "bg-[#e8f8f0] text-[#067647]" : "bg-[#f2f0f4] text-[#686470]"}`}>{value ? "Yes" : "No"}</span>;
  if (column.kind === "status") return <span className="inline-flex rounded-full bg-[#f2efff] px-2 py-1 text-xs font-semibold capitalize text-[#5130bd]">{String(value ?? "—").replaceAll("-", " ")}</span>;
  if (Array.isArray(value)) return value.join(", ") || "—";
  return String(value ?? "—");
}

export function EntityTable({ collection, rows }: { collection: CollectionConfig; rows: EntityRecord[] }) {
  if (!rows.length) {
    return <div className="admin-card grid min-h-72 place-items-center px-6 py-12 text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-full bg-[#f2efff] text-[#5b37d2]"><SearchX aria-hidden="true" className="size-5" /></span><h2 className="mt-4 font-semibold">No {collection.label.toLowerCase()} found</h2><p className="mt-1 text-sm text-[#686470]">Create the first record or adjust your search.</p></div></div>;
  }
  return (
    <div className="admin-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-[#f8f8fa] text-xs font-semibold uppercase tracking-[0.05em] text-[#686470]"><tr>{collection.columns.map((column) => <th key={column.name} scope="col" className="border-b border-[#dddbe3] px-4 py-3">{column.label}</th>)}<th scope="col" className="border-b border-[#dddbe3] px-4 py-3 text-right"><span className="sr-only">Open</span></th></tr></thead>
          <tbody className="divide-y divide-[#ebe9ee]">
            {rows.map((row) => {
              const id = String(row[collection.primaryKey]);
              return <tr key={id} className="bg-white hover:bg-[#fbfaff]">{collection.columns.map((column) => <td key={column.name} className="max-w-[320px] px-4 py-3 align-middle text-[#37323d]"><div className="truncate">{displayValue(row, column)}</div></td>)}<td className="px-4 py-3 text-right"><Link href={`/content/${collection.key}/${encodeURIComponent(id)}`} aria-label={`Edit ${collection.singular} ${id}`} className="inline-grid size-10 place-items-center rounded-lg text-[#5b37d2] hover:bg-[#eee9ff]"><ArrowRight aria-hidden="true" className="size-4" /></Link></td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
