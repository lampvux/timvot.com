"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "./mutation-utils";

export interface StaffActionState {
  status?: "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

const createStaffSchema = z.object({
  email: z.email("Enter a valid email address."),
  displayName: z.string().trim().min(2, "Enter a display name."),
  password: z.string().min(12, "Use at least 12 characters."),
  role: z.enum(["admin", "manager"]),
});

export async function createStaffAction(
  _previousState: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const actor = await assertAdmin();
  const parsed = createStaffSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    displayName: String(formData.get("display_name") ?? ""),
    password: String(formData.get("password") ?? ""),
    role: String(formData.get("role") ?? "manager"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      ),
    };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { display_name: parsed.data.displayName },
    });
    if (error || !data.user) throw error ?? new Error("Supabase did not create the user.");

    const { error: profileError } = await admin.from("profiles").upsert({
      id: data.user.id,
      display_name: parsed.data.displayName,
      role: parsed.data.role,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw profileError;
    }

    await recordAudit(actor, "created", "staff", data.user.id, {
      role: parsed.data.role,
      email: parsed.data.email,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not create the staff account.",
    };
  }

  revalidatePath("/team");
  return { status: "success", message: "Staff account created and ready to sign in." };
}

export async function updateStaffRoleAction(formData: FormData) {
  const actor = await assertAdmin();
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId || (role !== "admin" && role !== "manager")) {
    throw new Error("Invalid staff role update.");
  }
  if (userId === actor.id && role !== "admin") {
    throw new Error("You cannot remove your own administrator access.");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;

  await recordAudit(actor, "role_changed", "staff", userId, { role });
  revalidatePath("/team");
}

export async function setStaffActiveAction(formData: FormData) {
  const actor = await assertAdmin();
  const userId = String(formData.get("user_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!userId) throw new Error("Invalid staff account.");
  if (userId === actor.id && !active) {
    throw new Error("You cannot deactivate your own account.");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (error) throw error;

  await recordAudit(actor, active ? "reactivated" : "deactivated", "staff", userId);
  revalidatePath("/team");
}
