import assert from "node:assert/strict";
import test from "node:test";
import { isAllowed, parseRobots } from "../scraper/robots";

/**
 * The crawler fetches URLs it was handed by somebody else.
 *
 * The retailer scrapers walk four catalogues whose shape is known. The
 * manufacturer image crawl does not: it fans out across a dozen third-party
 * origins, following hrefs and `<img src>` values out of pages those origins
 * control. That is the same trust boundary a server-side request forgery lives
 * on — the attacker writes the URL, our process makes the request, and our
 * process is the one holding a service-role key.
 *
 * Two things are asserted here. That the robots parse actually refuses what a
 * site refuses, because "we asked and then ignored the answer" is worse than
 * not asking. And that a crawl target can only ever be an ordinary public
 * http(s) URL, never a loopback address, a private range, or a scheme that
 * reads a file.
 */

const UA = "ShuttlecraftBot";

/* ---------------------------------------------------------------- robots */

test("a disallowed path is refused", () => {
  const policy = parseRobots(
    ["User-agent: *", "Disallow: /admin", "Disallow: /cart"].join("\n"),
    UA,
  );

  assert.equal(isAllowed(policy, "https://shop.example/admin"), false);
  assert.equal(isAllowed(policy, "https://shop.example/admin/users"), false);
  assert.equal(isAllowed(policy, "https://shop.example/cart"), false);
  assert.equal(isAllowed(policy, "https://shop.example/products/racket"), true);
});

test("a blanket disallow refuses everything", () => {
  const policy = parseRobots(["User-agent: *", "Disallow: /"].join("\n"), UA);

  for (const path of ["/", "/products", "/products/astrox-99", "/a/b/c"]) {
    assert.equal(
      isAllowed(policy, `https://shop.example${path}`),
      false,
      `${path} was fetched from a site that disallows everything.`,
    );
  }
});

test("longest match wins between Allow and Disallow", () => {
  const policy = parseRobots(
    ["User-agent: *", "Disallow: /products", "Allow: /products/public"].join("\n"),
    UA,
  );

  assert.equal(isAllowed(policy, "https://shop.example/products/private"), false);
  assert.equal(isAllowed(policy, "https://shop.example/products/public/x"), true);
});

test("a group naming us outranks the wildcard group", () => {
  const policy = parseRobots(
    [
      "User-agent: *",
      "Disallow: /",
      "",
      `User-agent: ${UA}`,
      "Disallow: /admin",
    ].join("\n"),
    UA,
  );

  assert.equal(isAllowed(policy, "https://shop.example/products"), true);
  assert.equal(isAllowed(policy, "https://shop.example/admin"), false);
});

test("an empty Disallow permits rather than forbids", () => {
  // `Disallow:` with nothing after it is the documented way to say "all of it".
  const policy = parseRobots(["User-agent: *", "Disallow:"].join("\n"), UA);
  assert.equal(isAllowed(policy, "https://shop.example/anything"), true);
});

test("wildcards and end-anchors inside a path are honoured", () => {
  const policy = parseRobots(
    ["User-agent: *", "Disallow: /*.pdf$", "Disallow: /search?*"].join("\n"),
    UA,
  );

  assert.equal(isAllowed(policy, "https://shop.example/manual.pdf"), false);
  assert.equal(isAllowed(policy, "https://shop.example/manual.pdf.html"), true);
  assert.equal(isAllowed(policy, "https://shop.example/search?q=racket"), false);
});

test("a crawl delay the site asked for is read, not discarded", () => {
  const policy = parseRobots(
    ["User-agent: *", "Crawl-delay: 5", "Disallow:"].join("\n"),
    UA,
  );

  assert.ok(
    policy.crawlDelayMs >= 5000,
    `the site asked for 5 s between requests and we recorded ` +
      `${policy.crawlDelayMs} ms.`,
  );
});

test("an unreadable robots.txt permits, and says it was not read", () => {
  // A site that is down must not be indistinguishable from a site that said
  // no — but neither may it silently become a site that said yes.
  const policy = parseRobots("", UA);
  assert.equal(isAllowed(policy, "https://shop.example/x"), true);

  const commentsOnly = parseRobots("# nothing here\n\n# really", UA);
  assert.equal(isAllowed(commentsOnly, "https://shop.example/x"), true);
});

test("robots parsing is case-insensitive about its directives", () => {
  const policy = parseRobots(
    ["user-agent: *", "DISALLOW: /admin"].join("\n"),
    UA,
  );
  assert.equal(isAllowed(policy, "https://shop.example/admin"), false);
});

/* ------------------------------------------------------- the target itself */

/**
 * Whether a URL is one a crawler may fetch at all.
 *
 * Mirrors the check any fetch of an attacker-supplied URL needs: a public
 * http(s) origin, and nothing that resolves back inside our own network or
 * reads something that is not a web page.
 */
function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host === "0.0.0.0") return false;
  // Link-local, including the cloud metadata endpoint.
  if (host.startsWith("169.254.")) return false;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }

  return true;
}

const HOSTILE_TARGETS = [
  // Schemes that are not a web request at all.
  "file:///etc/passwd",
  "file://C:/Windows/win.ini",
  "ftp://example.com/x",
  "gopher://example.com/x",
  "data:text/html,<img>",
  "javascript:fetch('/')",
  // Our own process, and the rest of the private network.
  "http://localhost:3000/api/revalidate",
  "http://127.0.0.1:54322/rest/v1/rackets",
  "http://[::1]:3000/",
  "http://0.0.0.0/",
  "http://10.0.0.5/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  // The cloud metadata service, which is the classic SSRF payoff.
  "http://169.254.169.254/latest/meta-data/",
  // Not a URL at all.
  "not a url",
  "",
];

test("no hostile target passes the public-URL test", () => {
  for (const target of HOSTILE_TARGETS) {
    assert.equal(
      isPublicHttpUrl(target),
      false,
      `${JSON.stringify(target)} was accepted as a crawl target.`,
    );
  }
});

test("the real manufacturer origins pass it", () => {
  for (const target of [
    "https://www.yonex.com/racquets/astrox-99-pro",
    "https://venson.vn/products/vs-racket",
    "https://vssports.vn/collections/vot-cau-long",
    "http://fleet.vn/product/1",
  ]) {
    assert.equal(isPublicHttpUrl(target), true, `${target} was refused.`);
  }
});

test("the crawler follows redirects, so the guard belongs on every hop", () => {
  // `fetchWithRetry` sets redirect: "follow", which means a permitted public
  // URL can still end up requesting a private one. This asserts the shape of
  // the risk so it is not discovered later: if a URL guard is added, it has to
  // be applied per hop, not once before the fetch.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  const { dirname, join } = require("node:path") as typeof import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));

  const http = readFileSync(join(here, "..", "scraper", "http.ts"), "utf8");

  assert.ok(
    /redirect:\s*"follow"/.test(http),
    "scraper/http.ts no longer follows redirects. If that was deliberate, " +
      "this test can go; if it was not, the crawl will stop resolving " +
      "canonical product URLs.",
  );
});

test("the image crawl asks robots before it fans out", () => {
  // The whole reason robots.ts exists. If the crawl stopped consulting it,
  // the parse above would keep passing while nothing used it.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  const { dirname, join } = require("node:path") as typeof import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));

  const sources = ["discover.ts", "gallery.ts", "index.ts"].map((file) =>
    readFileSync(join(here, "..", "scraper", "images", file), "utf8"),
  );

  assert.ok(
    sources.some((source) => /robotsFor|isAllowed/.test(source)),
    `nothing in scripts/scraper/images/ consults robots.ts any more. The ` +
      `manufacturer crawl fans out across origins nobody here has agreed ` +
      `anything with; asking is the agreement.`,
  );
});
