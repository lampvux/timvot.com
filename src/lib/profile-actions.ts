"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ProfileState {
  error?: "auth" | "config" | "invalid" | "generic";
  notice?: "saved";
}
const SKILL_LEVELS = new Set(["beginner", "intermediate", "advanced"]);

export async function updateProfile(
  _previousState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const skillLevel = String(formData.get("skillLevel") ?? "");

  if (
    displayName.length < 2 ||
    displayName.length > 80 ||
    (skillLevel && !SKILL_LEVELS.has(skillLevel))
  ) {
    return { error: "invalid" };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "config" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "auth" };

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      skill_level: skillLevel || null,
    })
    .eq("id", user.id);

  if (error) return { error: "generic" };

  await supabase.auth.updateUser({
    data: { ...user.user_metadata, display_name: displayName },
  });

  revalidatePath("/", "layout");
  return { notice: "saved" };
}
