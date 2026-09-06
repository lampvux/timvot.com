"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SellerApplicationState {
  error?: "auth" | "config" | "invalid" | "approved" | "generic";
  notice?: "submitted";
}
type BusinessType = "individual" | "business";

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function isValidWebsite(value: string | null) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function submitSellerApplication(
  _previousState: SellerApplicationState,
  formData: FormData,
): Promise<SellerApplicationState> {
  const businessType = String(formData.get("businessType") ?? "") as BusinessType;
  const businessName = String(formData.get("businessName") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const taxId = optionalText(formData.get("taxId"));
  const websiteUrl = optionalText(formData.get("websiteUrl"));
  const yearsInBusiness = Number(formData.get("yearsInBusiness") ?? 0);
  const inventorySummary = String(formData.get("inventorySummary") ?? "").trim();
  const accepted = formData.get("sellerAgreement") === "1";

  if (
    !["individual", "business"].includes(businessType) ||
    businessName.length < 2 ||
    businessName.length > 120 ||
    contactName.length < 2 ||
    contactName.length > 100 ||
    phone.length < 7 ||
    phone.length > 24 ||
    city.length < 2 ||
    city.length > 80 ||
    address.length < 5 ||
    address.length > 240 ||
    (taxId?.length ?? 0) > 40 ||
    !isValidWebsite(websiteUrl) ||
    !Number.isInteger(yearsInBusiness) ||
    yearsInBusiness < 0 ||
    yearsInBusiness > 100 ||
    inventorySummary.length < 20 ||
    inventorySummary.length > 1200 ||
    !accepted
  ) {
    return { error: "invalid" };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "auth" };

  const { data: existing, error: loadError } = await supabase
    .from("seller_applications")
    .select("id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadError) return { error: "generic" };
  if (existing?.status === "approved") return { error: "approved" };

  const application = {
    business_type: businessType,
    business_name: businessName,
    contact_name: contactName,
    phone,
    city,
    address,
    tax_id: taxId,
    website_url: websiteUrl,
    years_in_business: yearsInBusiness,
    inventory_summary: inventorySummary,
  };

  const mutation = existing
    ? supabase
        .from("seller_applications")
        .update({
          ...application,
          status: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
    : supabase.from("seller_applications").insert({
        ...application,
        user_id: user.id,
      });

  const { error } = await mutation;
  if (error) return { error: "generic" };

  revalidatePath("/en/seller");
  revalidatePath("/vi/seller");
  return { notice: "submitted" };
}
