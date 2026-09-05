import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { StaffSession } from "@/lib/auth";

export async function recordAudit(
  staff: StaffSession,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const supabase = await createClient();
  const { error } = await supabase.from("admin_audit_log").insert({
    actor_id: staff.id,
    actor_role: staff.role,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });

  if (error) {
    console.error("Could not record admin audit event", error.message);
  }
}

const storefrontTags: Record<string, string[]> = {
  brands: ["brands"],
  rackets: ["rackets"],
  "racket-variants": ["rackets"],
  "racket-images": ["rackets"],
  sellers: ["sellers"],
  offers: ["offers"],
  "price-points": ["price-points"],
  strings: ["strings"],
  "string-offers": ["string-offers"],
  "string-price-points": ["string-price-points"],
  guides: ["guides"],
  reviews: ["reviews"],
};

export async function revalidateStorefront(collectionKey: string) {
  const url = process.env.STOREFRONT_REVALIDATE_URL;
  const secret = process.env.STOREFRONT_REVALIDATE_SECRET;
  const tags = storefrontTags[collectionKey];
  if (!url || !secret || !tags) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tags }),
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      "Content was saved, but storefront cache revalidation failed",
      error,
    );
  }
}
