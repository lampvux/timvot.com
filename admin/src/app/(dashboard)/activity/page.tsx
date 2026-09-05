import type { Metadata } from "next";
import { ActivityList } from "@/components/activity-list";
import { PageHeader } from "@/components/page-header";
import { getActivity } from "@/lib/data";

export const metadata: Metadata = { title: "Activity log" };

export default async function ActivityPage() {
  const events = await getActivity(150);
  return <><PageHeader eyebrow="Operations" title="Activity log" description="An append-only view of content and access changes. Managers see their own events; administrators see all staff activity." /><div className="admin-card overflow-hidden"><ActivityList events={events} /></div></>;
}
