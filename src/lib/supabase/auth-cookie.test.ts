import assert from "node:assert/strict";
import test from "node:test";
import { hasAuthCookie } from "./cookies";

/**
 * The guard on the two Supabase Auth round trips that every public page view
 * used to pay — one in `proxy.ts`, one in `components/auth-slot.tsx` — on
 * traffic that carries no session at all.
 *
 * This test exists to fail in one direction. A false positive costs one round
 * trip, which is what the code did before. A false negative would stop
 * refreshing a real session, so every shape Supabase can write has to match.
 */

const named = (...names: string[]) => names.map((name) => ({ name }));

test("the unchunked cookie @supabase/ssr writes counts as a session", () => {
  assert.equal(hasAuthCookie(named("sb-jpndtobbacllovsnnshh-auth-token")), true);
});

test("a JWT split across chunks still counts as a session", () => {
  assert.equal(
    hasAuthCookie(named("sb-jpndtobbacllovsnnshh-auth-token.0", "sb-jpndtobbacllovsnnshh-auth-token.1")),
    true,
  );
  // Only the second chunk surviving is a broken session, not an absent one:
  // answering "signed out" would stop the refresh that repairs it.
  assert.equal(hasAuthCookie(named("sb-jpndtobbacllovsnnshh-auth-token.1")), true);
});

test("another project's ref still counts — the ref is not the test", () => {
  // A project migration changes the ref. The old code did not care and this
  // must not start caring, or sign-in breaks on the day the URL changes.
  assert.equal(hasAuthCookie(named("sb-someotherprojectref-auth-token")), true);
});

test("the cookies an anonymous visitor actually carries do not", () => {
  assert.equal(
    hasAuthCookie(
      named(
        "NEXT_LOCALE",
        "shuttlecraft-remember-session",
        "_vercel_jwt",
        "sb-jpndtobbacllovsnnshh-auth-token-code-verifier",
      ),
    ),
    false,
  );
  assert.equal(hasAuthCookie([]), false);
});

test("the PKCE verifier alone is not a session", () => {
  // Written when sign-in starts and read back at /auth/callback. A visitor
  // holding only this one has not completed an exchange, so there is no token
  // to refresh — and `/auth` is outside the proxy matcher anyway.
  assert.equal(
    hasAuthCookie(named("sb-jpndtobbacllovsnnshh-auth-token-code-verifier")),
    false,
  );
});
