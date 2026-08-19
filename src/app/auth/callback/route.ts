import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";

/**
 * The single return point for every sign-in that leaves the site: email
 * confirmation links and OAuth (Google, Facebook) both land here with a
 * one-time `code`, which is exchanged for a session cookie.
 *
 * This route must stay outside the i18n proxy matcher. `localePrefix` is
 * "always", so next-intl rewrites unprefixed paths — /auth/callback?code=…
 * became /vi/auth/callback?code=…, a 404, with the code already spent.
 */

/**
 * Only ever redirect somewhere on this site.
 *
 * `next` arrives in a URL the user can be handed by anyone, so taking it at
 * face value turns this route into an open redirect: a link to
 * /auth/callback?next=https://evil.example lands a freshly authenticated user
 * on an attacker's page wearing our domain's referrer. A leading "//" or a
 * "\" is enough for a browser to read the value as a host, so the check is
 * "starts with a single slash", not "is not absolute".
 */
export function safeNext(raw: string | null, locale: string): string {
  const fallback = `/${locale}/account`;
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const rawLocale = searchParams.get("locale");
  const locale = routing.locales.includes(rawLocale as never)
    ? (rawLocale as string)
    : routing.defaultLocale;

  const signInUrl = (reason: string) =>
    `${origin}/${locale}/sign-in?error=${encodeURIComponent(reason)}`;

  // The provider refused or the user cancelled. Supabase forwards the reason,
  // which is worth keeping: "provider is not enabled" and "user declined" are
  // very different problems and only one of them is the user's doing.
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(signInUrl(providerError));
  }

  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(signInUrl("missing_code"));

  const supabase = await createClient();
  if (!supabase) return NextResponse.redirect(signInUrl("config"));

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(signInUrl(error.message));

  return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"), locale)}`);
}
