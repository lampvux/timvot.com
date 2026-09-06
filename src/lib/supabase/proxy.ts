import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import {
  REMEMBER_SESSION_COOKIE,
  cookieOptionsForPersistence,
} from "./cookies";

/**
 * Refreshes the Supabase session on every request and copies the rotated
 * auth cookies onto the response next-intl already produced. Keeping both in
 * one pass means one proxy file, not two competing ones.
 */
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  if (!isSupabaseConfigured) return response;
  const rememberSession =
    request.cookies.get(REMEMBER_SESSION_COOKIE)?.value === "1";

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(
            name,
            value,
            cookieOptionsForPersistence(options, rememberSession),
          );
        }
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}
