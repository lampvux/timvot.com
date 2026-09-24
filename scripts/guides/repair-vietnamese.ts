import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "./config";
import { GuideLLM } from "./llm";
import { parseDocument, record, safeSources, validateDraft, type GuideDraft } from "../../src/lib/guides/content";

const settings = config();
const slug = process.argv[2] ?? "";
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Usage: npm run guides:repair-vi -- <guide-slug>");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Local repair requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await client.from("guides").select("slug,title_en,excerpt_en,body_en,category,subjects,intent,sources,published").eq("slug", slug).eq("published", true).maybeSingle();
if (error) throw new Error(`Guide lookup failed: ${error.message}`);
if (!data) throw new Error("Published guide not found");

const sources = safeSources(data.sources);
const allowedSourceIds = new Set(sources.map((source) => source.id));
const en = { title: data.title_en, excerpt: data.excerpt_en, document: parseDocument(JSON.parse(data.body_en), allowedSourceIds, "English document") };
const base = { slug: data.slug, category: data.category, subjects: data.subjects, intent: data.intent, en };
const llm = new GuideLLM();
let draft: GuideDraft | undefined;
let validationError = "";
for (let attempt = 0; attempt < 3; attempt++) {
  const result = record(await llm.json(
    "Translate the supplied English badminton guide into fluent, natural Vietnamese. Every human-readable Vietnamese field must use correct Unicode Vietnamese diacritics; ASCII transliteration is invalid. Preserve every fact, number, product name, source ID, version, table shape, and section id exactly. Do not add or remove claims. Only section id fields stay in ASCII. Return {vi:{title,excerpt,document:{version:1,takeaways:[strings],sections:[{id,heading,paragraphs:[strings],bullets?:[strings],table?:{headers:[strings],rows:[[strings]]},sourceIds:[integers]}]}}}.",
    { english: en, sources, ...(validationError ? { fix: validationError } : {}) }, 10000, "Vietnamese translation",
  ), "Vietnamese repair");
  try {
    draft = validateDraft({ ...base, vi: result.vi }, sources);
    break;
  } catch (repairError) {
    validationError = repairError instanceof Error ? repairError.message : "Invalid Vietnamese repair";
    if (attempt === 2) throw repairError;
  }
}
if (!draft) throw new Error("No valid Vietnamese repair");

const review = record(await llm.json(
  "Compare the English guide and Vietnamese translation. Reject any missing or added claim, changed number, changed product name, changed citation, ASCII-only Vietnamese, unnatural Vietnamese, or mismatched section. Return {approved:boolean,bilingual:boolean,issues:[strings]}.",
  { en: draft.en, vi: draft.vi }, 3500, "translation review",
), "Translation review");
if (review.approved !== true || review.bilingual !== true || !Array.isArray(review.issues) || review.issues.length) throw new Error(`Translation review failed: ${JSON.stringify(review.issues ?? "invalid review")}`);

await mkdir(settings.output, { recursive: true });
const artifact = `${settings.output}/repair-vi-${slug}.json`;
await writeFile(artifact, JSON.stringify({ slug, model: settings.model, vi: draft.vi, review }, null, 2));
const updated = await client.from("guides").update({ title_vi: draft.vi.title, excerpt_vi: draft.vi.excerpt, body_vi: JSON.stringify(draft.vi.document), updated_at: new Date().toISOString() }).eq("slug", slug).eq("published", true).select("slug").single();
if (updated.error) throw new Error(`Vietnamese repair update failed: ${updated.error.message}`);
console.log(`Repaired Vietnamese guide: /vi/guides/${updated.data.slug}`);

