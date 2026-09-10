import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import {
  REMEMBER_SESSION_COOKIE,
  cookieOptionsForPersistence,
} from "./cookies";
import {
  finishFunctionProfile,
  profiledSupabaseFetch,
  startFunctionProfile,
} from "@/lib/racket-detail-profile";

/**
 * Refreshes the Supabase session on every request and copies the rotated
 * auth cookies onto the response next-intl already produced. Keeping both in
 * one pass means one proxy file, not two competing ones.
 */
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  const started = startFunctionProfile();
  if (!isSupabaseConfigured) {
    finishFunctionProfile("proxy.refreshSession", started, {
      path: request.nextUrl.pathname,
      configured: false,
    });
    return response;
  }
  const rememberSession =
    request.cookies.get(REMEMBER_SESSION_COOKIE)?.value === "1";

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: profiledSupabaseFetch("proxy-client", request.nextUrl.pathname),
    },
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
  finishFunctionProfile("proxy.refreshSession", started, {
    path: request.nextUrl.pathname,
    configured: true,
  });
  return response;
}
