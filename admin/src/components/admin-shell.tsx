"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity, BookOpenText, Boxes, ChartNoAxesColumnIncreasing, ChevronRight,
  CircleDollarSign, GalleryVerticalEnd, LayoutDashboard, LogOut, Menu,
  PackageSearch, PanelLeftClose, ShieldCheck, ShoppingBasket, Store, Tags, Users, X,
} from "lucide-react";
import { navigationGroups } from "@/lib/navigation";
import type { StaffSession } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";

const collectionIcons: Record<string, typeof PackageSearch> = {
  brands: Tags,
  rackets: PackageSearch,
  "racket-variants": Boxes,
  "racket-images": GalleryVerticalEnd,
  strings: PanelLeftClose,
  sellers: Store,
  offers: CircleDollarSign,
  "price-points": ChartNoAxesColumnIncreasing,
  "string-offers": ShoppingBasket,
  "string-price-points": ChartNoAxesColumnIncreasing,
  guides: BookOpenText,
  reviews: ShieldCheck,
};

function NavLink({ href, label, icon: Icon, onNavigate }: { href: string; label: string; icon: typeof PackageSearch; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-[#eee9ff] text-[#4423ad]" : "text-[#56515e] hover:bg-[#f4f2f7] hover:text-[#17151d]"}`}>
      <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.8} />
      <span className="truncate">{label}</span>
      {active ? <ChevronRight aria-hidden="true" className="ml-auto size-4" /> : null}
    </Link>
  );
}

function Sidebar({ staff, onNavigate }: { staff: StaffSession; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-17 items-center gap-3 border-b border-[#e5e2e9] px-5">
        <div className="grid size-9 place-items-center rounded-[10px] bg-[#5b37d2] text-sm font-bold text-white">SC</div>
        <div className="min-w-0"><p className="truncate text-sm font-bold tracking-[-0.01em]">Shuttlecraft</p><p className="text-xs text-[#77717e]">Operations console</p></div>
      </div>
      <nav aria-label="Admin navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        <NavLink href="/" label="Overview" icon={LayoutDashboard} onNavigate={onNavigate} />
        {navigationGroups.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[#8a8491]">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.key} href={`/content/${item.key}`} label={item.label}
                  icon={collectionIcons[item.key] ?? PackageSearch} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
        <div>
          <p className="mb-1.5 px-3 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-[#8a8491]">Operations</p>
          <div className="space-y-0.5">
            <NavLink href="/activity" label="Activity log" icon={Activity} onNavigate={onNavigate} />
            {staff.role === "admin" ? <NavLink href="/team" label="Staff access" icon={Users} onNavigate={onNavigate} /> : null}
          </div>
        </div>
      </nav>
      <div className="border-t border-[#e5e2e9] p-3">
        <div className="mb-2 rounded-lg bg-[#f7f6f9] px-3 py-2.5">
          <p className="truncate text-sm font-semibold">{staff.displayName}</p><p className="truncate text-xs text-[#77717e]">{staff.email}</p>
          <span className="mt-2 inline-flex rounded-full bg-white px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-[#5b37d2] ring-1 ring-[#d9d0fb]">{staff.role}</span>
        </div>
        <form action={logoutAction}><button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#686470] hover:bg-[#fff0ee] hover:text-[#b42318]"><LogOut aria-hidden="true" className="size-[18px]" />Sign out</button></form>
      </div>
    </div>
  );
}

export function AdminShell({ staff, children }: { staff: StaffSession; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-[#f4f5f7] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-[#dddbe3] lg:block"><Sidebar staff={staff} /></aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-[#17151d]/45" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-[min(88vw,300px)] border-r border-[#dddbe3] shadow-2xl">
            <button onClick={() => setOpen(false)} aria-label="Close navigation" className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-lg text-[#686470] hover:bg-[#f4f2f7]"><X aria-hidden="true" className="size-5" /></button>
            <Sidebar staff={staff} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#dddbe3] bg-white/95 px-4 backdrop-blur sm:px-6 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open navigation" className="grid size-11 place-items-center rounded-lg text-[#45404b] hover:bg-[#f4f2f7]"><Menu aria-hidden="true" className="size-5" /></button>
          <p className="text-sm font-bold">Shuttlecraft Admin</p>
          <span className="grid size-9 place-items-center rounded-full bg-[#eee9ff] text-xs font-bold text-[#4423ad]">{staff.displayName.slice(0, 2).toUpperCase()}</span>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
