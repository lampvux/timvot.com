import assert from "node:assert/strict";
import test from "node:test";
import { importedModules, read, stripCommentsAndStrings } from "./source";

/**
 * Nothing in the locale layout may read the request.
 *
 * This layout wraps every route in the app. One `await cookies()` in it opts
 * *every* route out of prerendering, and `getUser()` puts a blocking round
 * trip to Supabase Auth in front of the first byte of every page. Per-user
 * chrome belongs in a leaf behind `<Suspense>` — `components/auth-slot.tsx` is
 * the one that owns that read — rendering a signed-out shell as the fallback.
 *
 * `params` is fine: it is the route segment, not the request. `getMessages` is
 * fine for the same reason, because it is keyed on the locale segment.
 */

const LAYOUT = ["app", "[locale]", "layout.tsx"] as const;

/** Reads of the request, each of which is enough to lose prerendering. */
const REQUEST_READS = [
  "cookies(",
  "headers(",
  "draftMode(",
  "connection(",
  "searchParams",
  "getUser(",
  "getSession(",
];

test("the locale layout reads nothing from the request", () => {
  const code = stripCommentsAndStrings(read(...LAYOUT));

  const found = REQUEST_READS.filter((call) => code.includes(call));

  assert.deepEqual(
    found,
    [],
    `app/[locale]/layout.tsx calls ${found.join(", ")}. This layout wraps ` +
      `every route, so one request read here makes the whole app dynamic. ` +
      `Put it in a leaf behind <Suspense> instead — see components/auth-slot.tsx.`,
  );
});

test("the locale layout imports no Supabase client", () => {
  const modules = importedModules(read(...LAYOUT));

  const supabase = modules.filter(
    (m) => m.includes("supabase/server") || m.includes("supabase/client"),
  );

  assert.deepEqual(
    supabase,
    [],
    `app/[locale]/layout.tsx imports ${supabase.join(", ")}. Creating a ` +
      `request-bound client here is the same blocking round trip as calling ` +
      `getUser() directly. config.ts, which exports only the origin, is fine.`,
  );
});

test("the layout renders the account slot behind a boundary", () => {
  // The signed-in chrome is the one thing on this layout that is per-user, so
  // it is the thing most likely to be "just awaited here" by a later change.
  const source = read(...LAYOUT);

  assert.ok(
    /<AccountSlot\s*\/>/.test(source),
    "the layout no longer renders <AccountSlot />; if per-user chrome moved, " +
      "check that its replacement still reads the request in a leaf.",
  );

  const slot = read("components", "auth-slot.tsx");
  assert.ok(
    slot.includes("Suspense"),
    "components/auth-slot.tsx no longer carries its own <Suspense>. Without " +
      "it the layout's cookie read is back on every route's critical path.",
  );
});

test("the root layout stays free of request reads too", () => {
  // A second layout above this one would defeat the rule silently.
  let root: string;
  try {
    root = read("app", "layout.tsx");
  } catch {
    return; // No root layout of its own. Nothing to check.
  }

  const code = stripCommentsAndStrings(root);
  const found = REQUEST_READS.filter((call) => code.includes(call));
  assert.deepEqual(found, [], `app/layout.tsx calls ${found.join(", ")}.`);
});
