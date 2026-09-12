import type { CookieOptions } from "@supabase/ssr";

export const REMEMBER_SESSION_COOKIE = "shuttlecraft-remember-session";
export const REMEMBER_SESSION_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * Supabase's auth cookie, whatever this project happens to call it.
 *
 * `@supabase/ssr` writes `sb-<project-ref>-auth-token`, and splits it into
 * `.0`, `.1`, … when the JWT outgrows a single cookie. The ref is derivable
 * from `SUPABASE_URL`, but matching the shape rather than the exact name is
 * what makes this safe to fail in only one direction: a project-ref change, a
 * custom storage key or a future chunking scheme still matches, so the answer
 * is never a false "signed out".
 */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * Is there a session here at all?
 *
 * Every public page view used to pay two Supabase Auth round trips — one in
 * the proxy, one in the account slot — including the great majority that
 * carry no session whatsoever. Both calls answer "nobody" after a trip to
 * Singapore that the cookie jar could have answered locally.
 *
 * This is a *presence* test and nothing more. It says a request is worth
 * asking Supabase about; it never says who the visitor is, and nothing that
 * gates data may branch on it. See `components/auth-slot.tsx` for the one
 * display-only use, and `CLAUDE.md` for the rule.
 */
export function hasAuthCookie(
  cookies: readonly { name: string }[],
): boolean {
  return cookies.some((cookie) => AUTH_COOKIE.test(cookie.name));
}

/**
 * Supabase deliberately writes long-lived auth cookies. When a visitor has
 * not opted into "remember me", remove the lifetime attributes so the browser
 * treats those auth cookies as session cookies. Expiry cookies must retain
 * maxAge=0 or sign-out would not remove them.
 */
export function cookieOptionsForPersistence(
  options: CookieOptions,
  rememberSession: boolean,
): CookieOptions {
  if (rememberSession || options.maxAge === 0) return options;

  const { maxAge: _maxAge, expires: _expires, ...sessionOptions } = options;
  return sessionOptions;
}
