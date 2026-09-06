import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, GalleryVerticalEnd, ShieldAlert } from "lucide-react";
import { ActivityList } from "@/components/activity-list";
import { PageHeader } from "@/components/page-header";
import { requireStaff } from "@/lib/auth";
import { getDashboardData } from "@/lib/data";

export const metadata: Metadata = { title: "Overview" };
const tones = { violet: "bg-[#eee9ff] text-[#4423ad]", blue: "bg-[#e7f1ff] text-[#175cd3]", amber: "bg-[#fff4d6] text-[#8a5200]", green: "bg-[#e8f8f0] text-[#067647]" };

export default async function DashboardPage() {
  const staff = await requireStaff();
  const data = await getDashboardData(staff);
  return (
    <>
      <PageHeader eyebrow="Operations" title={`Good to see you, ${staff.displayName.split(" ")[0]}`} description="A live view of the catalogue, marketplace, moderation queue, and recent staff changes." />
      <section aria-label="Catalogue metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => <Link key={metric.label} href={metric.href} className="admin-card group p-5 hover:border-[#c9bdf3]"><div className="flex items-start justify-between"><span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${tones[metric.tone]}`}>{metric.label}</span><ArrowRight aria-hidden="true" className="size-4 text-[#8a8491] transition-transform group-hover:translate-x-0.5" /></div><p className="mt-6 text-3xl font-bold tabular-nums tracking-[-0.04em]">{metric.value.toLocaleString()}</p><p className="mt-1 text-xs text-[#77717e]">Open records</p></Link>)}
      </section>
      <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Link href="/content/seller-applications" className="admin-card flex items-center gap-4 p-5 hover:border-[#c9bdf3]"><span className="grid size-11 place-items-center rounded-xl bg-[#eee9ff] text-[#5b37d2]"><ClipboardCheck aria-hidden="true" className="size-5" /></span><div><p className="text-2xl font-bold tabular-nums">{data.sellerReviewQueue.toLocaleString()}</p><p className="text-sm text-[#686470]">Seller applications waiting for review</p></div><ArrowRight aria-hidden="true" className="ml-auto size-5 text-[#8a8491]" /></Link>
        <Link href="/content/reviews" className="admin-card flex items-center gap-4 p-5 hover:border-[#e4c47e]"><span className="grid size-11 place-items-center rounded-xl bg-[#fff4d6] text-[#9a5b00]"><ShieldAlert aria-hidden="true" className="size-5" /></span><div><p className="text-2xl font-bold tabular-nums">{data.reviewQueue.toLocaleString()}</p><p className="text-sm text-[#686470]">Reviews waiting for moderation</p></div><ArrowRight aria-hidden="true" className="ml-auto size-5 text-[#8a8491]" /></Link>
        <Link href="/content/racket-images" className="admin-card flex items-center gap-4 p-5 hover:border-[#c9bdf3]"><span className="grid size-11 place-items-center rounded-xl bg-[#eee9ff] text-[#5b37d2]"><GalleryVerticalEnd aria-hidden="true" className="size-5" /></span><div><p className="text-2xl font-bold tabular-nums">{data.imageCount.toLocaleString()}</p><p className="text-sm text-[#686470]">Racket gallery images</p></div><ArrowRight aria-hidden="true" className="ml-auto size-5 text-[#8a8491]" /></Link>
      </section>
      <section className="admin-card mt-6 overflow-hidden"><div className="flex items-center justify-between border-b border-[#e5e2e9] px-5 py-4"><div><h2 className="font-semibold">Recent activity</h2><p className="mt-0.5 text-xs text-[#77717e]">The latest content and access changes.</p></div><Link href="/activity" className="text-sm font-semibold text-[#5b37d2] hover:text-[#4423ad]">View all</Link></div><ActivityList events={data.activity} compact /></section>
    </>
  );
}
