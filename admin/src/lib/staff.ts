import "server-only";

import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface StaffMember {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "manager";
  active: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}

export async function getStaffMembers(): Promise<StaffMember[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data: usersData, error: usersError }, { data: profiles, error: profilesError }] =
    await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("profiles").select("id, display_name, role").in("role", ["admin", "manager"]),
    ]);

  if (usersError) throw usersError;
  if (profilesError) throw profilesError;

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );

  return usersData.users
    .map((user) => {
      const profile = profileById.get(user.id);
      if (!profile || (profile.role !== "admin" && profile.role !== "manager")) return null;
      const bannedUntil = user.banned_until ? new Date(user.banned_until).getTime() : 0;
      return {
        id: user.id,
        email: user.email ?? "Unknown email",
        displayName: profile.display_name || user.email || "Staff member",
        role: profile.role,
        active: !bannedUntil || bannedUntil < Date.now(),
        lastSignInAt: user.last_sign_in_at ?? null,
        createdAt: user.created_at,
      } satisfies StaffMember;
    })
    .filter((member): member is StaffMember => member !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
