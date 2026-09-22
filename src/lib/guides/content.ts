/** Shared by the local publisher and the server renderer. No browser/server APIs. */
export const GUIDE_CATEGORIES = ["rackets", "strings", "comparison", "buying", "prices", "maintenance", "technique"] as const;
export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];
export interface GuideSource { id: number; title: string; url: string; accessedAt: string }
export interface GuideSection {
  id: string;
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
  sourceIds: number[];
}
export interface GuideDocument { version: 1; takeaways: string[]; sections: GuideSection[] }
export interface GuideTranslation { title: string; excerpt: string; document: GuideDocument }
export interface GuideDraft {
  slug: string;
  category: GuideCategory;
  subjects: string[];
  intent: string;
  en: GuideTranslation;
  vi: GuideTranslation;
}

export function record(value: unknown, label = "Value"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) throw new Error("Invalid text length");
  // Content is plain text. Links are constructed exclusively from validated sources.
  if (/<\/?[a-z][^>]*>/i.test(value) || /https?:\/\//i.test(value)) throw new Error("Use source IDs, not HTML or inline URLs");
  return value.trim();
}
function strings(value: unknown, min: number, max: number, length = 3000): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error("Invalid list length");
  return value.map((v) => text(v, length));
}
export function parseDocument(value: unknown, sourceIds?: Set<number>, label = "Document"): GuideDocument {
  const doc = record(value, label);
  if (doc.version !== 1 || !Array.isArray(doc.sections) || doc.sections.length < 3 || doc.sections.length > 14) throw new Error("Invalid guide document");
  const ids = new Set<string>(["takeaways", "sources"]);
  const sections = doc.sections.map((value, index): GuideSection => {
    const s = record(value, `${label} section ${index + 1}`);
    const id = text(s.id, 90);
    if (!/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) throw new Error("Section IDs must be unique ASCII anchors");
    ids.add(id);
    if (!Array.isArray(s.sourceIds) || !s.sourceIds.length || s.sourceIds.some((n) => !Number.isSafeInteger(n) || n < 1 || (sourceIds && !sourceIds.has(n)))) throw new Error("Missing or unknown citation");
    const result: GuideSection = { id, heading: text(s.heading, 180), paragraphs: strings(s.paragraphs, 1, 10), sourceIds: [...new Set(s.sourceIds as number[])] };
    if (s.bullets !== undefined) result.bullets = strings(s.bullets, 1, 12, 600);
    if (s.table !== undefined) {
      const table = record(s.table, `${label} section ${index + 1} table`);
      const headers = strings(table.headers, 2, 6, 100);
      if (!Array.isArray(table.rows) || !table.rows.length || table.rows.length > 20) throw new Error("Invalid table");
      result.table = { headers, rows: table.rows.map((r) => strings(r, headers.length, headers.length, 350)) };
    }
    return result;
  });
  return { version: 1, takeaways: strings(doc.takeaways, 2, 6, 500), sections };
}
export function documentText(doc: GuideDocument): string {
  return [...doc.takeaways, ...doc.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.bullets ?? []), ...(s.table?.rows.flat() ?? [])])].join(" ");
}
function vietnameseMarkCount(value: string): number {
  // NFD exposes Vietnamese tone marks as combining characters; đ/Đ does not
  // decompose, so count it explicitly. This rejects ASCII transliteration
  // while allowing product names and technical terms to remain unchanged.
  const combiningMarks = value.normalize("NFD").match(/[\u0300-\u036f]/g)?.length ?? 0;
  const strokedD = value.match(/[đĐ]/g)?.length ?? 0;
  return combiningMarks + strokedD;
}
function assertNaturalVietnamese(value: string, minimumMarks: number): void {
  if (vietnameseMarkCount(value) < minimumMarks) throw new Error("Vietnamese translation must use natural Unicode Vietnamese with diacritics");
}
export function validateDraft(value: unknown, sources: GuideSource[]): GuideDraft {
  const d = record(value, "Guide draft");
  const slug = text(d.slug, 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Invalid guide slug");
  if (!GUIDE_CATEGORIES.includes(d.category as GuideCategory)) throw new Error("Unknown category");
  const allowed = new Set(sources.map((s) => s.id));
  const translation = (v: unknown, label: string): GuideTranslation => {
    const t = record(v, `${label} translation`);
    const document = parseDocument(t.document, allowed, `${label} document`);
    const words = documentText(document).split(/\s+/).length;
    if (words < 450 || words > 3500) throw new Error("Each translation must contain 450–3500 words");
    const used = new Set(document.sections.flatMap((s) => s.sourceIds));
    const hosts = new Set(sources.filter((s) => used.has(s.id)).map((s) => new URL(s.url).hostname.replace(/^www\./, "")));
    // Count an operator's regional subdomains as the same source.
    const operators = new Set([...hosts].map((h) => h.endsWith("victorsport.com") ? "victorsport.com" : h.endsWith("yonex.com") ? "yonex.com" : h));
    if (operators.size < 2) throw new Error("Guide needs two independent source operators");
    return { title: text(t.title, 180, 10), excerpt: text(t.excerpt, 400, 30), document };
  };
  const result: GuideDraft = { slug, category: d.category as GuideCategory, subjects: strings(d.subjects, 1, 5, 100), intent: text(d.intent, 160), en: translation(d.en, "English"), vi: translation(d.vi, "Vietnamese") };
  assertNaturalVietnamese(result.vi.title, 2);
  assertNaturalVietnamese(result.vi.excerpt, 4);
  assertNaturalVietnamese(documentText(result.vi.document), 20);
  if (result.en.document.sections.map((s) => s.id).join() !== result.vi.document.sections.map((s) => s.id).join()) throw new Error("Translations must share section IDs");
  if (result.en.title === result.vi.title || documentText(result.en.document) === documentText(result.vi.document)) throw new Error("Translations must differ");
  return result;
}
export function readDocument(body: string | null | undefined): GuideDocument | null {
  if (!body) return null;
  try { return parseDocument(JSON.parse(body)); } catch { return null; }
}
export function safeSources(value: unknown): GuideSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    try {
      const s = record(item);
      const url = new URL(String(s.url));
      if (url.protocol !== "https:" || url.username || url.password || !Number.isSafeInteger(s.id) || Number(s.id) < 1 || typeof s.title !== "string" || !Number.isFinite(Date.parse(String(s.accessedAt)))) return [];
      return [{ id: Number(s.id), title: s.title, url: url.href, accessedAt: String(s.accessedAt) }];
    } catch { return []; }
  });
}
