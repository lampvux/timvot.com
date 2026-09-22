import "server-only";
import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { createStaticClient } from "@/lib/supabase/server";
import { TAG } from "./tags";
import { mapGuide } from "./mappers";
import { GUIDE_CATEGORIES, readDocument, safeSources, type GuideDocument, type GuideSource } from "@/lib/guides/content";
import type { Guide } from "@/lib/types";

export interface GuideDetail extends Guide {
  body: { en: string; vi: string };
  document: { en: GuideDocument | null; vi: GuideDocument | null };
  sources: GuideSource[];
  category: string;
  publishedAt: string | null;
  updatedAt: string | null;
  aiGenerated: boolean;
}
async function readGuide(slug: string): Promise<GuideDetail | null> {
  "use cache";
  cacheLife("catalogue");
  cacheTag(TAG.guides);
  const client = createStaticClient("guide-detail");
  if (!client || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const { data, error } = await client.from("guides").select("slug,title_en,title_vi,excerpt_en,excerpt_vi,read_minutes,tone,body_en,body_vi,content_format,category,sources,published_at,updated_at,generation_model").eq("slug", slug).eq("published", true).maybeSingle();
  if (error) throw new Error("Guide could not be loaded");
  if (!data || !data.body_en?.trim() || !data.body_vi?.trim()) return null;
  const document = { en: readDocument(data.body_en), vi: readDocument(data.body_vi) };
  if (data.content_format === "guide-json-v1" && (!document.en || !document.vi)) return null;
  return { ...mapGuide(data), body: { en: data.body_en, vi: data.body_vi }, document, sources: safeSources(data.sources), category: GUIDE_CATEGORIES.includes(data.category) ? data.category : "buying", publishedAt: data.published_at, updatedAt: data.updated_at, aiGenerated: Boolean(data.generation_model) };
}
export const getGuide = cache(readGuide);
