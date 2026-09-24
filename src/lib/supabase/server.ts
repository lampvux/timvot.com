import { cookies } from "next/headers";
// The module `next/navigation` re-exports on the server. Imported directly
// because the node:test suites load this file outside the Next bundler, where
// `next/navigation` resolves to its client build and needs a React client
// context that does not exist there.
import { unstable_rethrow } from "next/dist/client/components/unstable-rethrow";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import {
  REMEMBER_SESSION_COOKIE,
  cookieOptionsForPersistence,
} from "./cookies";
import { profiledSupabaseFetch } from "@/lib/racket-detail-profile";

/**
 * Static Supabase client (no cookies required).
 * Used for reading public RLS data in static contexts like `generateStaticParams` or SSG.
 */
export function createStaticClient(source = "static-client"): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: profiledSupabaseFetch(source) },
  });
}

/**
 * Server-side Supabase client bound to the request cookies.
 * Returns null when the project is not provisioned yet — every caller has to
 * handle that branch, which keeps the seeded fallback honest.
 *
 * If executed inside a static context (e.g. `generateStaticParams`), falls back
 * to a static client rather than crashing on `cookies()`.
 */
export async function createClient({
  rememberSession,
}: {
  rememberSession?: boolean;
} = {}): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const cookieStore = await cookies();
    const shouldRemember =
      rememberSession ?? cookieStore.get(REMEMBER_SESSION_COOKIE)?.value === "1";

    return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { fetch: profiledSupabaseFetch("server-client") },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(
                name,
                value,
                cookieOptionsForPersistence(options, shouldRemember),
              );
            }
          } catch {
            // Called from a Server Component. The proxy refreshes the session,
            // so this is safe to swallow.
          }
        },
      },
    });
  } catch (error) {
    // Under Cache Components, `cookies()` in a prerender rejects with the
    // signal Next uses to stop rendering this subtree and stream it at request
    // time. Swallowing that signal is what let the static client below run
    // `auth.getUser()` — and Supabase Auth's `Date.now()` — inside the
    // prerender. Hand it back to Next; only a genuine failure falls through.
    unstable_rethrow(error);
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
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
