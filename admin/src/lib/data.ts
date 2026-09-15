import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertStaff, type StaffSession } from "@/lib/auth";
import {
  getCollection,
  type CollectionConfig,
  type FieldOption,
} from "@/lib/collections";
import {
  racketImageFolder,
  storagePathMatchesRacket,
} from "@/lib/racket-image-paths";

export type EntityRecord = Record<string, unknown>;

export const PAGE_SIZE = 24;

export interface CollectionPageResult {
  rows: EntityRecord[];
  count: number;
  page: number;
  pageCount: number;
}

function safeSearchTerm(value: string) {
  return value.trim().replace(/[,().%]/g, " ").replace(/\s+/g, " ").slice(0, 80);
}

export async function getCollectionPage(
  collection: CollectionConfig,
  search: string,
  requestedPage: number,
): Promise<CollectionPageResult> {
  await assertStaff();
  const supabase = await createClient();
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from(collection.table)
    .select("*", { count: "exact" })
    .order(collection.orderBy, {
      ascending: collection.orderAscending ?? true,
    })
    .range(from, to);

  const term = safeSearchTerm(search);
  if (term && collection.searchColumns.length) {
    query = query.or(
      collection.searchColumns
        .map((column) => `${column}.ilike.%${term}%`)
        .join(","),
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Could not load ${collection.label}: ${error.message}`);

  const total = count ?? 0;
  return {
    rows: (data ?? []) as EntityRecord[],
    count: total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function getEntity(
  collection: CollectionConfig,
  id: string,
): Promise<EntityRecord | null> {
  await assertStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(collection.table)
    .select("*")
    .eq(collection.primaryKey, id)
    .maybeSingle();

  if (error) throw new Error(`Could not load ${collection.singular}: ${error.message}`);
  return (data as EntityRecord | null) ?? null;
}

export interface RacketMediaImage {
  id: string;
  publicUrl: string | null;
  thumbUrl: string | null;
  position: number;
  isHero: boolean;
  provider: string;
  adminManaged: boolean;
  colourway: string | null;
  sourcePageUrl: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  folderMatches: boolean;
}

export interface RacketMediaMapping {
  racketId: string;
  racketName: string;
  expectedFolder: string;
  heroPointersMatch: boolean;
  images: RacketMediaImage[];
}

export async function getRacketMediaMapping(
  racketId: string,
): Promise<RacketMediaMapping> {
  await assertStaff();
  const supabase = await createClient();
  const { data: racket, error: racketError } = await supabase
    .from("rackets")
    .select("id, name, slug, brand_id, hero_image_url, hero_thumb_url")
    .eq("id", racketId)
    .single();
  if (racketError || !racket) {
    throw new Error(`Could not load racket media: ${racketError?.message ?? "racket not found"}`);
  }

  const [{ data: brand, error: brandError }, { data: images, error: imagesError }] =
    await Promise.all([
      supabase.from("brands").select("slug").eq("id", racket.brand_id).single(),
      supabase
        .from("racket_images")
        .select("id, public_url, thumb_url, storage_path, thumb_path, position, is_hero, provider, admin_managed, colourway, source_page_url, bytes, width, height")
        .eq("racket_id", racketId)
        .order("position")
        .order("id"),
    ]);
  if (brandError || !brand) {
    throw new Error(`Could not load racket brand: ${brandError?.message ?? "brand not found"}`);
  }
  if (imagesError) throw new Error(`Could not load racket images: ${imagesError.message}`);

  const target = {
    brandSlug: String(brand.slug),
    racketSlug: String(racket.slug),
  };

  const mappedImages = (images ?? []).map((image) => ({
    id: String(image.id),
    publicUrl: image.public_url ? String(image.public_url) : null,
    thumbUrl: image.thumb_url ? String(image.thumb_url) : null,
    position: Number(image.position),
    isHero: Boolean(image.is_hero),
    provider: String(image.provider),
    adminManaged: Boolean(image.admin_managed),
    colourway: image.colourway ? String(image.colourway) : null,
    sourcePageUrl: String(image.source_page_url),
    bytes: image.bytes === null ? null : Number(image.bytes),
    width: image.width === null ? null : Number(image.width),
    height: image.height === null ? null : Number(image.height),
    folderMatches: storagePathMatchesRacket(String(image.storage_path), target)
      && (!image.thumb_path || storagePathMatchesRacket(String(image.thumb_path), target)),
  }));
  const selectedHero = mappedImages.find((image) => image.isHero);

  return {
    racketId,
    racketName: String(racket.name),
    expectedFolder: racketImageFolder(target),
    heroPointersMatch: selectedHero
      ? selectedHero.publicUrl === (racket.hero_image_url ? String(racket.hero_image_url) : null)
        && (selectedHero.thumbUrl ?? null) === (racket.hero_thumb_url ? String(racket.hero_thumb_url) : null)
      : racket.hero_image_url === null && racket.hero_thumb_url === null,
    images: mappedImages,
  };
}

export async function getRelationOptions(collection: CollectionConfig) {
  await assertStaff();
  const supabase = await createClient();
  const result: Record<string, FieldOption[]> = {};

  await Promise.all(
    collection.fields.map(async (field) => {
      if (!field.relation) return;
      const relation = field.relation;
      const { data, error } = await supabase
        .from(relation.table)
        .select(`${relation.valueColumn}, ${relation.labelColumn}`)
        .order(relation.orderColumn ?? relation.labelColumn)
        .limit(5000);

      if (error) {
        throw new Error(`Could not load options for ${field.label}: ${error.message}`);
      }

      result[field.name] = ((data ?? []) as unknown as EntityRecord[]).map((row) => ({
        value: String(row[relation.valueColumn]),
        label: String(row[relation.labelColumn] ?? row[relation.valueColumn]),
      }));
    }),
  );

  return result;
}

export interface DashboardMetric {
  label: string;
  value: number;
  href: string;
  tone: "violet" | "blue" | "amber" | "green";
}

export interface AuditEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string;
  actor_role: string;
  created_at: string;
}

async function countRows(
  supabase: SupabaseClient,
  table: string,
  filter?: [string, string],
) {
  let query = supabase.from(table).select("*", { head: true, count: "exact" });
  if (filter) query = query.eq(filter[0], filter[1]);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function getDashboardData(staff: StaffSession) {
  const supabase = await createClient();
  const [rackets, strings, sellers, liveDeals, reviewQueue, sellerReviewQueue, imageCount] =
    await Promise.all([
      countRows(supabase, "rackets"),
      countRows(supabase, "strings"),
      countRows(supabase, "sellers"),
      countRows(supabase, "offers", ["status", "live"]),
      countRows(supabase, "reviews", ["status", "pending"]),
      countRows(supabase, "seller_applications", ["status", "pending"]),
      countRows(supabase, "racket_images"),
    ]);

  const { data: activity } = await supabase
    .from("admin_audit_log")
    .select("id, action, entity_type, entity_id, actor_id, actor_role, created_at")
    .order("created_at", { ascending: false })
    .limit(8);

  const metrics: DashboardMetric[] = [
    { label: "Rackets", value: rackets, href: "/content/rackets", tone: "violet" },
    { label: "Strings", value: strings, href: "/content/strings", tone: "blue" },
    { label: "Sellers", value: sellers, href: "/content/sellers", tone: "green" },
    { label: "Live deals", value: liveDeals, href: "/content/offers", tone: "amber" },
  ];

  return {
    metrics,
    reviewQueue,
    sellerReviewQueue,
    imageCount,
    activity: (activity ?? []) as AuditEvent[],
    staff,
  };
}

export async function getActivity(limit = 100) {
  await assertStaff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_audit_log")
    .select("id, action, entity_type, entity_id, actor_id, actor_role, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 250));
  if (error) throw new Error(`Could not load activity: ${error.message}`);
  return (data ?? []) as AuditEvent[];
}

export function collectionExists(key: string) {
  return Boolean(getCollection(key));
}
