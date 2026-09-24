import assert from "node:assert/strict";
import test from "node:test";
import { list, sourceFiles } from "./source";

/**
 * A `catch` around a request-time read hands Next's signals back.
 *
 * Under Cache Components, `cookies()` in a prerender rejects with the signal
 * Next uses to stop that subtree and stream it at request time. The Supabase
 * helpers used to catch it and carry on with a static client, so
 * `auth.getUser()` ran inside the prerender and Supabase Auth's `Date.now()`
 * failed the detail route in `next dev` — from the account link, the price
 * alert and the review slot at once. `npm run build` stayed green throughout,
 * because that validation only runs in development.
 *
 * The rule, checked on the Supabase helpers and on server components that
 * read cookies or the session: each `catch` block calls `unstable_rethrow`
 * first. Server actions are exempt; they never run inside a prerender.
 */

const READS_SESSION = /\bcookies\(\)|auth\.getUser\(\)/;

test("every catch around a session read calls unstable_rethrow", () => {
  const offenders: string[] = [];

  const files = [...sourceFiles("lib/supabase"), ...sourceFiles("components")];
  for (const file of files) {
    if (file.path.endsWith(".test.ts") || !READS_SESSION.test(file.text)) continue;
    // Client files and server actions run no prerender; the signal cannot reach them.
    if (/^\s*["']use (client|server)["']/.test(file.text)) continue;

    for (const match of file.text.matchAll(/\bcatch\s*(\(\s*(\w+)\s*\))?\s*\{/g)) {
      const body = file.text.slice(match.index! + match[0].length, match.index! + match[0].length + 800);
      const line = file.text.slice(0, match.index!).split("\n").length;
      // A catch that only guards a cookie *write* from a Server Component
      // cannot swallow a read's signal.
      // That is a short `try` whose last statements are the write itself.
      const before = file.text.slice(Math.max(0, match.index! - 200), match.index!);
      if (/cookieStore\.set\(/.test(before) && !/cookies\(\)/.test(before)) continue;
      if (!match[2] || !body.includes(`unstable_rethrow(${match[2]})`)) {
        offenders.push(`${file.path}:${line}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${list(offenders)}: a catch in a file that reads cookies or the session ` +
      `does not call unstable_rethrow(error) first. It can swallow the prerender ` +
      `signal and run request-time code inside the static shell.`,
  );
});
