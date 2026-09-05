import { Activity, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { AuditEvent } from "@/lib/data";

function entityHref(event: AuditEvent) {
  if (event.entity_type === "staff") return "/team";
  return event.entity_id
    ? `/content/${event.entity_type}/${encodeURIComponent(event.entity_id)}`
    : `/content/${event.entity_type}`;
}

export function ActivityList({ events, compact = false }: { events: AuditEvent[]; compact?: boolean }) {
  if (!events.length) {
    return <div className="grid min-h-52 place-items-center px-6 py-10 text-center"><div><Activity aria-hidden="true" className="mx-auto size-6 text-[#8a8491]" /><p className="mt-3 text-sm font-semibold">No activity recorded yet</p><p className="mt-1 text-xs text-[#77717e]">Saved changes will appear here.</p></div></div>;
  }
  return (
    <div className="divide-y divide-[#ebe9ee]">
      {events.map((event) => (
        <div key={event.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f2efff] text-[#5b37d2]"><Activity aria-hidden="true" className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-[#37323d]"><span className="font-semibold capitalize">{event.action.replaceAll("_", " ")}</span> <span className="text-[#77717e]">{event.entity_type.replaceAll("-", " ")}</span>{event.entity_id ? <span className="font-mono text-xs"> · {event.entity_id}</span> : null}</p>
            <p className="mt-0.5 text-xs text-[#8a8491]">{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))} · {event.actor_role}</p>
          </div>
          {!compact || event.entity_type !== "staff" ? <Link href={entityHref(event)} aria-label="Open affected record" className="grid size-10 shrink-0 place-items-center rounded-lg text-[#5b37d2] hover:bg-[#eee9ff]"><ArrowUpRight aria-hidden="true" className="size-4" /></Link> : null}
        </div>
      ))}
    </div>
  );
}
