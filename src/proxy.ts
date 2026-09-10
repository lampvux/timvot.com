import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { refreshSession } from "@/lib/supabase/proxy";
import {
  finishFunctionProfile,
  startFunctionProfile,
} from "@/lib/racket-detail-profile";

const handleI18n = createIntlMiddleware(routing);

export default async function proxy(request: NextRequest) {
  const started = startFunctionProfile();
  // Locale first: it decides the redirect and owns the NEXT_LOCALE cookie.
  const response = handleI18n(request);
  // Then roll the Supabase session onto whatever response that produced.
  const result = await refreshSession(request, response);
  finishFunctionProfile("proxy.total", started, {
    path: request.nextUrl.pathname,
  });
  return result;
}

export const config = {
  matcher: [
    // Everything except Next internals, the API, /auth, and files with an
    // extension.
    //
    // `/auth` has to be excluded. `localePrefix` is "always", so next-intl
    // redirects any unprefixed path to a locale-prefixed one — which sent
    // /auth/callback?code=… to /vi/auth/callback?code=…, a route that does not
    // exist. Every OAuth and email-confirmation redirect landed on a 404 with
    // the one-time code already spent.
    "/((?!api|auth|_next|_vercel|.*\\..*).*)",
  ],
};
