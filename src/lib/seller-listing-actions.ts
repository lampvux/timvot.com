"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect as localeRedirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export interface SellerListingState {
  error?: "auth" | "config" | "invalid" | "notApproved" | "generic";
}
const CONDITIONS = new Set([
  "new",
  "open-box",
  "used-excellent",
  "used-good",
  "used-fair",
]);

function localeOf(formData: FormData): Locale {
  return formData.get("locale") === "en" ? "en" : "vi";
}

export async function createSellerListing(
  _previousState: SellerListingState,
  formData: FormData,
): Promise<SellerListingState> {
  const variantId = String(formData.get("variantId") ?? "");
  const price = Number(formData.get("price") ?? 0);
  const quantity = Number(formData.get("quantity") ?? 0);
  const condition = String(formData.get("condition") ?? "");
  const warrantyMonths = Number(formData.get("warrantyMonths") ?? 0);
  const includesStringing = formData.get("includesStringing") === "1";
  const shipsFrom = String(formData.get("shipsFrom") ?? "").trim();
  const leadTimeDays = Number(formData.get("leadTimeDays") ?? 1);

  if (
    !variantId ||
    !Number.isSafeInteger(price) ||
    price < 1_000 ||
    price > 1_000_000_000 ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    quantity > 10_000 ||
    !CONDITIONS.has(condition) ||
    !Number.isInteger(warrantyMonths) ||
    warrantyMonths < 0 ||
    warrantyMonths > 120 ||
    shipsFrom.length < 2 ||
    shipsFrom.length > 80 ||
    !Number.isInteger(leadTimeDays) ||
    leadTimeDays < 0 ||
    leadTimeDays > 60
  ) {
    return { error: "invalid" };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "auth" };

  const [{ data: profile }, { data: seller }, { data: variant }] =
    await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase.from("sellers").select("id").eq("owner_id", user.id).maybeSingle(),
      supabase
        .from("racket_variants")
        .select("id, racket_id")
        .eq("id", variantId)
        .maybeSingle(),
    ]);

  if (profile?.role !== "seller" || !seller?.id) {
    return { error: "notApproved" };
  }
  if (!variant?.racket_id) return { error: "invalid" };

  const { error } = await supabase.from("offers").insert({
    id: `offer-${randomUUID()}`,
    variant_id: variant.id,
    racket_id: variant.racket_id,
    seller_id: seller.id,
    price,
    currency: "VND",
    qty_available: quantity,
    condition,
    warranty_months: warrantyMonths,
    includes_stringing: includesStringing,
    ships_from: shipsFrom,
    lead_time_days: leadTimeDays,
  });

  if (error) return { error: "generic" };

  revalidatePath(`/${localeOf(formData)}/seller/dashboard`);
  localeRedirect({ href: "/seller/dashboard", locale: localeOf(formData) });
  return {};
}
