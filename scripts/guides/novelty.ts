import { createHash } from "node:crypto";
import { documentText, readDocument, type GuideDraft } from "../../src/lib/guides/content";
export interface PreviousGuide { slug: string; title_en: string; title_vi: string; excerpt_en: string | null; body_en: string | null; topic_key: string | null; category: string; subjects: string[]; intent: string | null }
export function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
export function hash(value: string): string { return createHash("sha256").update(normalize(value)).digest("hex"); }
export function topicKey(category: string, subjects: string[], intent: string): string { return hash(`${category}|${subjects.map(normalize).sort().join("|")}|${normalize(intent)}`); }
function shingles(value: string, size: number): Set<string> {
  const words = normalize(value).split(/\s+/);
  return new Set(words.slice(0, Math.max(0, words.length - size + 1)).map((_, i) => words.slice(i, i + size).join(" ")));
}
export function similarity(a: string, b: string, size = 2): number {
  const left = shingles(a, size), right = shingles(b, size);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((v) => right.has(v)).length;
  return (2 * intersection) / (left.size + right.size);
}
export function closest(title: string, history: PreviousGuide[], count = 20): PreviousGuide[] {
  return [...history].sort((a, b) => similarity(title, `${b.title_en} ${b.intent ?? ""}`) - similarity(title, `${a.title_en} ${a.intent ?? ""}`)).slice(0, count);
}
export function assertNovel(draft: GuideDraft, history: PreviousGuide[]): void {
  const key = topicKey(draft.category, draft.subjects, draft.intent);
  const body = documentText(draft.en.document);
  for (const previous of history) {
    const doc = readDocument(previous.body_en);
    const oldBody = doc ? documentText(doc) : previous.body_en ?? "";
    if (previous.slug === draft.slug || previous.topic_key === key || similarity(draft.en.title, previous.title_en) >= 0.72 || (oldBody && (hash(body) === hash(oldBody) || similarity(body, oldBody, 5) >= 0.28))) throw new Error(`Duplicate or overlapping guide: ${previous.slug}`);
  }
}
