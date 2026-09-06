"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordAudit } from "./mutation-utils";

export interface SellerReviewState {
  status?: "error" | "success";
  message?: string;
}
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function reviewSellerApplicationAction(
  _previousState: SellerReviewState,
  formData: FormData,
): Promise<SellerReviewState> {
  const staff = await assertStaff();
  const applicationId = String(formData.get("application_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (
    !UUID_PATTERN.test(applicationId) ||
    (decision !== "approved" && decision !== "rejected")
  ) {
    return { status: "error", message: "Invalid review request." };
  }
  if (decision === "rejected" && notes.length < 5) {
    return {
      status: "error",
      message: "Add a short reason so the applicant can correct their submission.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_seller_application", {
    application_id: applicationId,
    decision,
    notes: notes || null,
  });

  if (error) return { status: "error", message: error.message };

  await recordAudit(staff, decision, "seller-application", applicationId, {
    notes: notes || null,
  });
  revalidatePath("/content/seller-applications");

  return {
    status: "success",
    message:
      decision === "approved"
        ? "Application approved and seller access granted."
        : "Application returned to the applicant.",
  };
}
