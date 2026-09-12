/**
 * The message namespaces that reach the browser.
 *
 * `<NextIntlClientProvider>` with no `messages` prop serialises the whole
 * message file into the RSC payload of every route — 26,8 KB for `vi`, 30 KB
 * committed — including namespaces no Client Component can ever read. `home`,
 * `deals`, `methodology`, `strings`, `sellers` and `dashboard` are rendered
 * entirely on the server; they were shipped to every visitor anyway, on every
 * page, in both the document and the client-side navigation payload.
 *
 * This is the list that is actually reachable from a `"use client"` module.
 * `client-namespaces.test.ts` derives the same list from the source and fails
 * if they disagree — so adding `useTranslations("deals")` to a Client
 * Component is caught by a test rather than by a missing-message error in
 * production.
 *
 * Server components are unaffected: `getTranslations` reads the full set on
 * the server, which is also why "I need a translation" is never a reason to
 * make a component a client one.
 */
export const CLIENT_NAMESPACES = [
  "auth",
  "catalog",
  "common",
  "compare",
  "enums",
  "finder",
  "nav",
  "profile",
  "racket",
  "sellerApplication",
  "sellerListing",
  "specs",
  "stringRecommender",
] as const;

export type ClientNamespace = (typeof CLIENT_NAMESPACES)[number];

/** Narrow a full message object to what the client tree can read. */
export function clientMessages(
  messages: Record<string, unknown>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const namespace of CLIENT_NAMESPACES) {
    if (namespace in messages) picked[namespace] = messages[namespace];
  }
  return picked;
}
