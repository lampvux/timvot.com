import assert from "node:assert/strict";
import test from "node:test";
import { safeNext } from "../../src/app/auth/callback/route";
import { routing } from "../../src/i18n/routing";

/**
 * `/auth/callback` must only ever redirect somewhere on this site.
 *
 * `next` arrives in a URL anyone can hand to anyone, so taking it at face
 * value turns the one route every sign-in passes through into an open
 * redirect: a link to `/auth/callback?next=https://evil.example` lands a
 * freshly authenticated user on an attacker's page, wearing our domain as the
 * referrer, at the exact moment they are most likely to trust what they see.
 *
 * The check is "starts with a single slash", not "is not absolute", because a
 * browser reads a leading `//` or `/\` as the start of a host. This file is
 * the table of everything that has ever been used to smuggle one past a
 * naive check.
 */

const LOCALE = "vi";
const FALLBACK = `/${LOCALE}/account`;

/** Values that must never survive. Each is a real bypass, not a variation. */
const HOSTILE = [
  // Absolute, in every scheme a browser will follow.
  "https://evil.example",
  "http://evil.example",
  "//evil.example",
  "///evil.example",
  "////evil.example",
  // Backslashes: most browsers normalise these to forward slashes.
  "/\\evil.example",
  "/\\/evil.example",
  "\\\\evil.example",
  "\\/evil.example",
  // Schemes that execute rather than navigate.
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  // Protocol-relative with credentials, which hides the real host.
  "//user:password@evil.example",
  "//evil.example@shuttlecraft.example",
  // No scheme at all: a bare host is still off-site.
  "evil.example",
  "evil.example/path",
  // Empty and whitespace.
  "",
  " ",
  "\t",
  "\n",
];

test("a same-site path is kept", () => {
  assert.equal(safeNext("/vi/rackets", LOCALE), "/vi/rackets");
  assert.equal(safeNext("/en/deals?sort=score", LOCALE), "/en/deals?sort=score");
  assert.equal(safeNext("/vi/rackets/yonex/astrox-99-pro", LOCALE), "/vi/rackets/yonex/astrox-99-pro");
});

test("no hostile value survives", () => {
  for (const value of HOSTILE) {
    const result = safeNext(value, LOCALE);
    assert.equal(
      result,
      FALLBACK,
      `safeNext(${JSON.stringify(value)}) returned ${JSON.stringify(result)} ` +
        `instead of falling back. That is an open redirect on the route every ` +
        `sign-in passes through.`,
    );
  }
});

test("a missing parameter falls back rather than throwing", () => {
  assert.equal(safeNext(null, LOCALE), FALLBACK);
});

test("the fallback respects the locale it was given", () => {
  for (const locale of routing.locales) {
    assert.equal(safeNext(null, locale), `/${locale}/account`);
    assert.equal(safeNext("https://evil.example", locale), `/${locale}/account`);
  }
});

test("whatever survives can only ever be a path", () => {
  // The property, rather than the enumeration: parsed against any origin, the
  // result has to stay on that origin.
  const origins = ["https://shuttlecraft.example", "http://localhost:3000"];

  for (const value of [...HOSTILE, "/vi/rackets", "/en", "/vi/account", null]) {
    const result = safeNext(value, LOCALE);

    for (const origin of origins) {
      const resolved = new URL(result, origin);
      assert.equal(
        resolved.origin,
        new URL(origin).origin,
        `safeNext(${JSON.stringify(value)}) resolved to ${resolved.href} ` +
          `against ${origin}, which is a different origin.`,
      );
    }
  }
});

test("a path that merely looks hostile is still allowed through", () => {
  // The rule is about the *shape* of the value, not about its content. A
  // legitimate path may contain a hostname-looking segment.
  assert.equal(safeNext("/vi/sellers/evil.example", LOCALE), "/vi/sellers/evil.example");
  assert.equal(safeNext("/vi/rackets?q=https://x", LOCALE), "/vi/rackets?q=https://x");
});

test("the route excludes itself from the i18n proxy matcher", () => {
  // Not a redirect check, but the failure that hides one: next-intl rewrites
  // unprefixed paths, so /auth/callback?code=… became /vi/auth/callback?code=…
  // — a 404, with the one-time code already spent. Every OAuth and email
  // confirmation in the product lands here.
  const proxy = readProxy();

  assert.ok(
    /auth/.test(proxy),
    `src/proxy.ts no longer mentions auth in its matcher. If /auth stopped ` +
      `being excluded, every sign-in that leaves the site 404s on return.`,
  );
});

function readProxy(): string {
  // Imported as text rather than as a module: proxy.ts is middleware and
  // pulls in the next-intl request pipeline when evaluated.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  const { dirname, join } = require("node:path") as typeof import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "..", "..", "src", "proxy.ts"), "utf8");
}
