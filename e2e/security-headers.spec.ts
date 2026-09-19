import { expect, test } from "@playwright/test";

/**
 * Every response carries the headers that make the browser defend the page.
 *
 * Asserted on a prerendered route *and* a dynamic one, because the two are
 * served by different paths — a header configured only in `next.config.ts`
 * reaches both, but a header added in a proxy or a route handler may not, and
 * that difference is invisible until someone scans production.
 *
 * The CSP is checked directive by directive rather than as one string. A CSP
 * that merely exists is not a CSP that stops anything, and a directive dropped
 * during a refactor is exactly the kind of change that looks harmless.
 */

/** One prerendered, one dynamic, one route handler. */
const ROUTES = [
  "/vi/rackets",
  "/vi/methodology",
  "/vi/rackets/yonex/astrox-99-pro",
  "/vi/rackets?brand=yonex&sort=price-asc",
];

const REQUIRED: Array<[string, RegExp]> = [
  ["x-content-type-options", /^nosniff$/i],
  ["x-frame-options", /^(DENY|SAMEORIGIN)$/i],
  ["referrer-policy", /strict-origin-when-cross-origin/i],
  ["strict-transport-security", /max-age=\d{7,}/i],
  ["permissions-policy", /camera=\(\)/i],
  ["content-security-policy", /default-src/i],
];

for (const route of ROUTES) {
  test(`${route} carries the security headers`, async ({ request, baseURL }) => {
    const response = await request.get(new URL(route, baseURL).toString());
    expect(response.status()).toBeLessThan(400);

    const headers = response.headers();

    for (const [name, pattern] of REQUIRED) {
      const value = headers[name];
      expect(value, `${route} is missing ${name}`).toBeTruthy();
      expect(value, `${route} has ${name}: ${value}`).toMatch(pattern);
    }
  });
}

test("the CSP forbids the things it is there to forbid", async ({ request, baseURL }) => {
  const response = await request.get(new URL("/vi/rackets", baseURL).toString());
  const csp = response.headers()["content-security-policy"] ?? "";

  const directive = (name: string) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `) || part === name) ?? "";

  // Nothing may frame the app. The catalogue carries prices and a "set price
  // alert" button, and a transparent overlay over that button is a real click.
  expect(directive("frame-ancestors")).toMatch(/'none'|'self'/);
  expect(directive("object-src")).toContain("'none'");
  expect(directive("base-uri")).toContain("'self'");
  expect(directive("form-action")).toContain("'self'");

  // A default-src of `*` would make the rest of the policy decorative.
  expect(directive("default-src")).not.toContain("*");
  expect(directive("default-src")).toContain("'self'");

  // `unsafe-eval` is the one that turns a text injection into code execution.
  expect(
    csp,
    "the CSP allows unsafe-eval, which is what makes an injected string run.",
  ).not.toContain("'unsafe-eval'");
});

test("the CSP allows what the app actually loads", async ({ page }) => {
  // A policy that blocks the product is a policy that gets removed. This
  // renders a real page and fails on a CSP violation report.
  const violations: string[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (!/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(text)) {
      return;
    }

    // `@vercel/analytics` and `@vercel/speed-insights` fetch their scripts
    // from `/_vercel/...`, which only the platform serves. Locally that is a
    // 404 whose `text/plain` body `nosniff` then refuses to execute — a
    // correct refusal of a script that does not exist, not the CSP blocking
    // something the app needs.
    if (/_vercel\/(insights|speed-insights)/.test(text)) return;

    violations.push(text);
  });

  for (const route of ["/vi/rackets", "/vi/rackets/yonex/astrox-99-pro", "/vi/finder"]) {
    await page.goto(route, { waitUntil: "load" });
    await page.waitForTimeout(700);
  }

  expect(
    violations,
    `the CSP blocked something the app needs:\n${violations.join("\n")}`,
  ).toEqual([]);
});

test("no response advertises the stack it is running", async ({ request, baseURL }) => {
  const response = await request.get(new URL("/vi/rackets", baseURL).toString());
  const headers = response.headers();

  // Not a vulnerability on its own — it is a free hint, and free hints are
  // what turn a scan into a targeted attempt.
  expect(headers["x-powered-by"] ?? "").not.toMatch(/next\.js|express/i);
  expect(headers["server"] ?? "").not.toMatch(/\d+\.\d+\.\d+/);
});

test("no response leaks a server secret in a header", async ({ request, baseURL }) => {
  const response = await request.get(new URL("/vi/rackets", baseURL).toString());
  const serialised = JSON.stringify(response.headers());

  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "REVALIDATE_SECRET",
    "DIRECT_URL",
    "SUPABASE_ACCESS_TOKEN",
  ]) {
    const value = process.env[name];
    if (!value || value.length < 16) continue;
    expect(serialised, `${name} appears in a response header`).not.toContain(value);
  }

  // And a service-role JWT by shape, whether or not it is set here.
  for (const jwt of serialised.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g)) {
    const payload = Buffer.from(jwt[0].split(".")[1], "base64url").toString("utf8");
    expect(payload, "a service-role JWT is in a response header").not.toContain(
      "service_role",
    );
  }
});

test("the revalidate endpoint refuses an unauthenticated caller", async ({
  request,
  baseURL,
}) => {
  // The one endpoint that can evict the whole app's cache.
  const response = await request.post(new URL("/api/revalidate", baseURL).toString(), {
    data: { tags: ["rackets"] },
  });

  expect(response.status(), "an anonymous POST was able to revalidate").toBe(401);
  expect(await response.json()).toEqual({ revalidated: false });
});

test("the revalidate endpoint refuses a wrong secret the same way", async ({
  request,
  baseURL,
}) => {
  const response = await request.post(new URL("/api/revalidate", baseURL).toString(), {
    headers: { authorization: "Bearer definitely-not-the-secret" },
    data: {},
  });

  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ revalidated: false });
});
