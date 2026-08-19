import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

/**
 * Static Supabase client (no cookies required).
 * Used for reading public RLS data in static contexts like `generateStaticParams` or SSG.
 */
export function createStaticClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Server-side Supabase client bound to the request cookies.
 * Returns null when the project is not provisioned yet — every caller has to
 * handle that branch, which keeps the seeded fallback honest.
 *
 * If executed inside a static context (e.g. `generateStaticParams`), falls back
 * to a static client rather than crashing on `cookies()`.
 */
export async function createClient(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured) return null;

  try {
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
            // Called from a Server Component. The proxy refreshes the session,
            // so this is safe to swallow.
          }
        },
      },
    });
  } catch {
    // Called inside static context (e.g. generateStaticParams / static generation).
    // Accessing cookies() is not supported without an HTTP request.
    return createStaticClient();
  }
}

export async function getUser() {
  const supabase = await createClient();
  if (!supabase) return null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
