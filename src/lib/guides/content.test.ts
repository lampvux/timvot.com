import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument, safeSources, validateDraft, type GuideDocument, type GuideDraft } from "./content";

const sources = [
  { id: 1, title: "Yonex", url: "https://us.yonex.com/pages/product-safety", accessedAt: "2026-09-20T01:00:00Z" },
  { id: 2, title: "Victor", url: "https://www.victorsport.com/badmintonaz/16586", accessedAt: "2026-09-20T01:00:00Z" },
];
export function fixture(): GuideDraft {
  const doc = (word: string): GuideDocument => ({ version: 1, takeaways: ["Choose for your needs", "Check original specifications"], sections: ["weight", "strings", "care"].map((id) => ({ id, heading: id, paragraphs: [Array(170).fill(word).join(" ")], sourceIds: [1, 2] })) });
  return { slug: "choose-your-first-racket", category: "buying", subjects: ["racket"], intent: "choose first racket", en: { title: "Choosing your first badminton racket", excerpt: "Understand how to make a useful first racket choice.", document: doc("equipment") }, vi: { title: "Chọn vợt cầu lông đầu tiên của bạn", excerpt: "Tìm hiểu cách lựa chọn cây vợt đầu tiên phù hợp với nhu cầu.", document: doc("vợt") } };
}
test("valid bilingual document retains matching section anchors", () => {
  const draft = validateDraft(fixture(), sources);
  assert.deepEqual(draft.en.document.sections.map((s) => s.id), draft.vi.document.sections.map((s) => s.id));
});
test("invalid citations, raw HTML and duplicate IDs fail closed", () => {
  for (const mutate of [
    (d: GuideDraft) => { d.en.document.sections[0].sourceIds = [99]; },
    (d: GuideDraft) => { d.en.document.sections[0].paragraphs = ["<script>alert(1)</script>"]; },
    (d: GuideDraft) => { d.en.document.sections[0].id = "sources"; },
    (d: GuideDraft) => { d.vi.document.sections[0].id = "different"; },
    (d: GuideDraft) => { d.vi = structuredClone(d.en); },
  ]) { const d = fixture(); mutate(d); assert.throws(() => validateDraft(d, sources)); }
});
test("table columns must align and external links must be HTTPS", () => {
  const d = fixture().en.document;
  d.sections[0].table = { headers: ["One", "Two"], rows: [["Missing a column"]] };
  assert.throws(() => parseDocument(d));
  assert.deepEqual(safeSources([{ ...sources[0], url: "javascript:alert(1)" }]), []);
  assert.deepEqual(safeSources([{ ...sources[0], accessedAt: "invalid" }]), []);
});
test("regional domains of one manufacturer are not independent evidence", () => {
  assert.throws(() => validateDraft(fixture(), [sources[0], { ...sources[1], url: "https://www.yonex.com" }]), /independent/);
});
test("ASCII-only Vietnamese transliteration is rejected", () => {
  const draft = fixture();
  draft.vi = { title: "Chon vot cau long dau tien cua ban", excerpt: "Tim hieu cach lua chon cay vot dau tien phu hop voi nhu cau.", document: { ...draft.vi.document, takeaways: ["Chon theo nhu cau", "Kiem tra thong so goc"], sections: draft.vi.document.sections.map((section) => ({ ...section, heading: "Huong dan", paragraphs: [Array(170).fill("vot").join(" ")] })) } };
  assert.throws(() => validateDraft(draft, sources), /diacritics/);
});
