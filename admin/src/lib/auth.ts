import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type StaffRole = "admin" | "manager";

export interface StaffSession {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
}

export const getOptionalStaff = cache(async (): Promise<StaffSession | null> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) return null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, role")
      .eq("id", user.id)
      .single();

    if (
      profileError ||
      !profile ||
      (profile.role !== "admin" && profile.role !== "manager")
    ) {
      return null;
    }

    return {
      id: user.id,
      email: user.email ?? "Unknown email",
      displayName: profile.display_name || user.email || "Staff member",
      role: profile.role,
    };
  } catch {
    return null;
  }
});

export async function requireStaff(): Promise<StaffSession> {
  const staff = await getOptionalStaff();
  if (!staff) redirect("/login");
  return staff;
}

export async function requireAdmin(): Promise<StaffSession> {
  const staff = await requireStaff();
  if (staff.role !== "admin") redirect("/");
  return staff;
}

export async function assertStaff(): Promise<StaffSession> {
  const staff = await getOptionalStaff();
  if (!staff) throw new Error("You must sign in with an active staff account.");
  return staff;
}

export async function assertAdmin(): Promise<StaffSession> {
  const staff = await assertStaff();
  if (staff.role !== "admin") {
    throw new Error("Only administrators can manage staff access.");
  }
  return staff;
}
