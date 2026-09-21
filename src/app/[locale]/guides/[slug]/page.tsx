import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getGuide } from "@/lib/data/guide-repository";
import { getGuides } from "@/lib/data/repository";
import { GuideToc } from "@/components/guide-toc";
import { Badge, Eyebrow, Icon } from "@/components/ds/primitives";

type Props = { params: Promise<{ locale: Locale; slug: string }> };
export async function generateStaticParams() {
  const guides = await getGuides();
  return guides.length ? guides.slice(0, 12).map((guide) => ({ slug: guide.slug })) : [{ slug: "getting-started" }];
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const guide = await getGuide(slug);
  if (!guide) return {};
  return { title: guide.title[locale], description: guide.excerpt[locale], alternates: { canonical: `/${locale}/guides/${slug}`, languages: { en: `/en/guides/${slug}`, vi: `/vi/guides/${slug}` } }, openGraph: { type: "article", title: guide.title[locale], description: guide.excerpt[locale], ...(guide.publishedAt ? { publishedTime: guide.publishedAt } : {}) } };
}
export default async function GuidePage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [guide, t] = await Promise.all([getGuide(slug), getTranslations({ locale, namespace: "guides" })]);
  if (!guide) notFound();
  const doc = guide.document[locale];
  const items = doc ? [{ id: "takeaways", title: t("takeaways") }, ...doc.sections.map((s) => ({ id: s.id, title: s.heading })), ...(guide.sources.length ? [{ id: "sources", title: t("sources") }] : [])] : [];
  const date = (value: string) => new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value));
  return <div className="page-shell py-7 lg:py-12">
    <Link href="/guides" className="inline-flex min-h-11 items-center gap-2 text-sm text-secondary hover:text-primary"><Icon name="ArrowLeft" size="sm" />{t("back")}</Link>
    <div className="mt-6 grid items-start gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
      <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">{items.length > 0 && <GuideToc items={items} label={t("contents")} />}</aside>
      <article className="min-w-0 max-w-[780px]">
        <header className="border-b border-line pb-8">
          <Eyebrow>{t("title")} / {t(`categories.${guide.category}` as "categories.buying")}</Eyebrow>
          <h1 className="display mt-3 text-[30px] leading-tight text-primary sm:text-[40px] lg:text-[46px]">{guide.title[locale]}</h1>
          <p className="mt-5 text-lg leading-relaxed text-secondary">{guide.excerpt[locale]}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-tertiary">
            <span className="font-mono">{t("readTime", { minutes: guide.readMinutes })}</span>
            {guide.publishedAt && <time dateTime={guide.publishedAt}>{t("published", { date: date(guide.publishedAt) })}</time>}
            {guide.aiGenerated && <Badge>{t("aiAssisted")}</Badge>}
          </div>
        </header>
        {doc ? <>
          <section id="takeaways" className="my-8 scroll-mt-28 rounded-md border border-line bg-card p-6">
            <h2 className="font-display text-xl font-bold text-primary">{t("takeaways")}</h2>
            <ul className="mt-4 space-y-3">{doc.takeaways.map((text, i) => <li key={i} className="flex gap-3 leading-7 text-secondary"><span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" />{text}</li>)}</ul>
          </section>
          {doc.sections.map((section, index) => <section id={section.id} key={section.id} className="scroll-mt-28 border-b border-line py-8 first:pt-0">
            <p aria-hidden className="mb-2 font-mono text-xs text-tertiary">{String(index + 1).padStart(2, "0")}</p>
            <h2 className="font-display text-[25px] font-bold leading-snug text-primary">{section.heading}</h2>
            <div className="mt-5 space-y-5 text-base leading-8 text-secondary">{section.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
            {section.bullets && <ul className="mt-5 list-disc space-y-2 pl-5 leading-8 text-secondary">{section.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
            {section.table && <div className="my-6 overflow-x-auto rounded-md border border-line"><table className="w-full min-w-[480px] text-left text-sm"><caption className="sr-only">{section.heading}</caption><thead className="bg-card"><tr>{section.table.headers.map((h, i) => <th scope="col" key={i} className="border-b border-line p-4 font-semibold">{h}</th>)}</tr></thead><tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="border-b border-line p-4 leading-6 text-secondary">{cell}</td>)}</tr>)}</tbody></table></div>}
            <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-tertiary">{t("references")}{section.sourceIds.map((id) => <a key={id} href={`#source-${id}`} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded border border-line hover:text-primary" aria-label={t("sourceNumber", { number: id })}>[{id}]</a>)}</p>
          </section>)}
        </> : <div className="space-y-6 py-8 leading-8 text-secondary">{guide.body[locale].split(/\n\s*\n/).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}</div>}
        {guide.sources.length > 0 && <section id="sources" className="scroll-mt-28 py-8"><h2 className="font-display text-2xl font-bold">{t("sources")}</h2><p className="mt-3 text-sm leading-6 text-secondary">{t("sourceNote")}</p><ol className="mt-5 space-y-4">{guide.sources.map((source) => <li id={`source-${source.id}`} key={source.id} className="scroll-mt-28 text-sm"><a href={source.url} target="_blank" rel="noopener noreferrer" className="break-words font-medium text-brand underline decoration-line-strong underline-offset-4">[{source.id}] {source.title}</a><p className="mt-1 text-xs text-tertiary">{new URL(source.url).hostname} · {t("accessed", { date: date(source.accessedAt) })}</p></li>)}</ol></section>}
        <div className="mt-4 flex flex-wrap gap-5 border-t border-line py-6 text-sm"><Link href="/guides" className="font-semibold text-brand">{t("moreGuides")} →</Link><Link href="/rackets" className="text-secondary">{t("exploreRackets")} →</Link></div>
      </article>
    </div>
  </div>;
}
