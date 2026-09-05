import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, assertSupabaseConfigured } from "./config";

export function createAdminClient() {
  assertSupabaseConfigured();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for staff administration.",
    );
  }

  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
