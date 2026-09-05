import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  assertSupabaseConfigured,
} from "./config";

export async function createClient(): Promise<SupabaseClient> {
  assertSupabaseConfigured();
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write response cookies. proxy.ts refreshes
          // the session for normal requests, so render-time writes are ignored.
        }
      },
    },
  });
}
