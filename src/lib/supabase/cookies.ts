import type { CookieOptions } from "@supabase/ssr";

export const REMEMBER_SESSION_COOKIE = "shuttlecraft-remember-session";
export const REMEMBER_SESSION_MAX_AGE = 400 * 24 * 60 * 60;

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
