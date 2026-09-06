import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertStaff, type StaffSession } from "@/lib/auth";
import {
  getCollection,
  type CollectionConfig,
  type FieldOption,
} from "@/lib/collections";

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
