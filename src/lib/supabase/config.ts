/**
 * Supabase is the system of record. When the keys are absent the app still
 * runs: the repository falls back to the seeded catalogue in src/lib/data/seed
 * so the design and the flows are reviewable before a project is provisioned.
 * Auth-only surfaces say so plainly rather than pretending to work.
 */

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

/** @deprecated Legacy fallback alias; preference is SUPABASE_PUBLISHABLE_KEY */
export const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY,
);

/**
 * The origin product images come from, for a connection hint in the document
 * head.
 *
 * Card thumbnails are rendered `unoptimized`, which is deliberate — the
 * crawler already produced them and Vercel Hobby allows 5.000 image
 * transformations a month against 3.010 heroes. The cost of that choice is
 * that the browser meets a *third* origin, and it does not meet it until it
 * has parsed the first `<img>`: DNS, TCP and TLS to Singapore, 200–300 ms on
 * mobile, inserted directly in front of the LCP image.
 *
 * A `preconnect` in the head starts that handshake while the HTML is still
 * arriving, so the image request finds an open connection. `crossOrigin` has
 * to be set and has to match how the images are actually fetched, or the
 * browser opens a second connection and the hint buys nothing.
 *
 * Null when the project is not provisioned — there is no origin to warm, and a
 * hint to nowhere is a wasted socket.
 */
export const SUPABASE_ORIGIN = (() => {
  if (!SUPABASE_URL) return null;
  try {
    return new URL(SUPABASE_URL).origin;
  } catch {
    return null;
  }
})();

/* ------------------------------------------------------- OAuth providers */

/**
 * Social sign-in providers this deployment offers.
 *
 * Whether a provider works is decided in the Supabase dashboard, not here —
 * this only decides whether the button is rendered. The two have to be turned
 * on together: a Google button on a project where Google is disabled sends the
 * user to Supabase and bounces them back with `?error=…`, which reads as the
 * site being broken rather than as a provider that was never configured. So
 * the default is none, and you opt in per environment once the provider is
 * actually enabled.
 *
 *   NEXT_PUBLIC_AUTH_PROVIDERS=google,facebook
 */
export const OAUTH_PROVIDERS = ["google", "facebook"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

function parseEnabledProviders(raw: string | undefined): OAuthProvider[] {
  const valueToParse = raw === undefined ? "google,facebook" : raw;
  if (!valueToParse.trim()) return [];
  return valueToParse
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is OAuthProvider =>
      (OAUTH_PROVIDERS as readonly string[]).includes(value),
    );
}

export const enabledOAuthProviders: OAuthProvider[] = parseEnabledProviders(
  process.env.NEXT_PUBLIC_AUTH_PROVIDERS,
);

export const hasOAuthProviders = enabledOAuthProviders.length > 0;

/**
 * The origin OAuth redirects come back to.
 *
 * Supabase sends the browser to `<site>/auth/callback`, and that URL has to be
 * on the provider's allow-list, so it cannot be inferred from the request host
 * without risking a redirect to an origin nobody whitelisted. Vercel exposes
 * the deployment host but without a scheme, hence the prefix.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

