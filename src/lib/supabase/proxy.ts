import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";
import {
  REMEMBER_SESSION_COOKIE,
  cookieOptionsForPersistence,
  hasAuthCookie,
} from "./cookies";
import {
  finishFunctionProfile,
  profiledSupabaseFetch,
  startFunctionProfile,
} from "@/lib/racket-detail-profile";

/**
 * Refreshes the Supabase session on every request that has one, and copies the
 * rotated auth cookies onto the response next-intl already produced. Keeping
 * both in one pass means one proxy file, not two competing ones.
 *
 * A request with no auth cookie returns immediately. That is not an
 * optimisation of the refresh — it is the observation that there is nothing to
 * refresh, and that finding it out cost a round trip to Supabase Auth in
 * Singapore in front of the first byte of every page. `/vi/methodology` reads
 * nothing from the catalogue and still answered in 660 ms; this call and the
 * account slot's were most of it, and the proxy runs ahead of the CDN, so a
 * fully prerendered page paid it too.
 *
 * The visitor sees the same response either way: the old code also returned
 * `response` unchanged once `getUser()` came back with nobody.
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

  if (!hasAuthCookie(request.cookies.getAll())) {
    finishFunctionProfile("proxy.refreshSession", started, {
      path: request.nextUrl.pathname,
      configured: true,
      session: false,
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
    session: true,
  });
  return response;
}
