"use client";

import { useEffect, useState } from "react";

export function GuideToc({ items, label }: { items: { id: string; title: string }[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-100px 0px -55% 0px", threshold: 0 });
    for (const item of items) { const element = document.getElementById(item.id); if (element) observer.observe(element); }
    return () => observer.disconnect();
  }, [items]);
  const links = <ol className="space-y-1">{items.map((item, index) => (
    <li key={item.id}><a href={`#${item.id}`} aria-current={active === item.id ? "location" : undefined}
      onClick={() => setActive(item.id)}
      className={`flex min-h-11 items-center gap-3 rounded-sm border-l-2 px-3 py-2 text-sm transition-colors ${active === item.id ? "border-brand bg-brand/5 font-semibold text-primary" : "border-transparent text-secondary hover:border-line-strong hover:text-primary"}`}>
      <span aria-hidden className="font-mono text-[10px] text-tertiary">{String(index + 1).padStart(2, "0")}</span>{item.title}
    </a></li>
  ))}</ol>;
  return <>
    <nav aria-label={label} className="hidden lg:block"><p className="eyebrow mb-4">{label}</p>{links}</nav>
    <details className="rounded-md border border-line bg-card p-4 lg:hidden"><summary className="cursor-pointer font-semibold text-primary">{label}</summary><nav aria-label={label} className="mt-3">{links}</nav></details>
  </>;
}
