import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../src/app/api/revalidate/route";
import { ALL_TAGS, SCRAPE_TAGS, TAG, isCacheTag } from "../../src/lib/data/tags";

/**
 * `/api/revalidate` is the one endpoint a node script can use to evict the
 * app's cache, and the only thing standing in front of it is a shared secret.
 *
 * Three things have to hold. The secret is compared in constant time, so it
 * cannot be recovered a character at a time from response timings. "No secret
 * configured" answers exactly like "wrong secret", so an unconfigured
 * deployment is not an open endpoint *and* does not announce that it is
 * unconfigured. And an unknown tag is an error rather than a success that
 * revalidated nothing — the failure mode that makes a stale price look like a
 * bug in the scraper.
 *
 * Only the rejected paths are exercised here. The accepted path calls
 * `revalidateTag`, which needs a Next request context; `e2e/` covers it
 * against a running server.
 */

const ENDPOINT = "https://shuttlecraft.example/api/revalidate";

function request(
  authorization?: string,
  body?: unknown,
): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: authorization ? { authorization } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Run with a specific REVALIDATE_SECRET, restoring whatever was there. */
async function withSecret<T>(secret: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.REVALIDATE_SECRET;
  if (secret === undefined) delete process.env.REVALIDATE_SECRET;
  else process.env.REVALIDATE_SECRET = secret;

  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = previous;
  }
}

const SECRET = "a-secret-of-some-length";

/* ------------------------------------------------------------ the refusals */

test("no authorization header is refused", async () => {
  await withSecret(SECRET, async () => {
    const response = await POST(request());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { revalidated: false });
  });
});

test("a wrong secret is refused", async () => {
  await withSecret(SECRET, async () => {
    const response = await POST(request(`Bearer ${"b".repeat(SECRET.length)}`));
    assert.equal(response.status, 401);
  });
});

test("a secret of the wrong length is refused", async () => {
  await withSecret(SECRET, async () => {
    for (const offered of ["", "short", `${SECRET}x`, SECRET.slice(0, -1)]) {
      const response = await POST(request(`Bearer ${offered}`));
      assert.equal(response.status, 401, `"${offered}" was accepted.`);
    }
  });
});

test("an unconfigured deployment refuses everything", async () => {
  // Not an open endpoint, and not a 500 either: with no secret set there is
  // simply no remote invalidation.
  await withSecret(undefined, async () => {
    for (const header of [undefined, "Bearer anything", "Bearer "]) {
      const response = await POST(request(header));
      assert.equal(response.status, 401);
    }
  });

  await withSecret("", async () => {
    const response = await POST(request("Bearer "));
    assert.equal(response.status, 401, "an empty secret was treated as a match.");
  });
});

test("every refusal is indistinguishable from outside", async () => {
  // "no secret set", "wrong secret" and "no header" must not be tellable
  // apart: each one that is, is a step in an attacker's search.
  const responses: Array<{ status: number; body: unknown }> = [];

  await withSecret(SECRET, async () => {
    // Every one of these is a *failed* credential. A bare secret with no
    // "Bearer " prefix is deliberately absent: the route strips the prefix if
    // it is there and compares what is left, so that form authenticates.
    for (const header of [undefined, "Bearer wrong", "Bearer ", "Basic xyz"]) {
      const response = await POST(request(header));
      responses.push({ status: response.status, body: await response.json() });
    }
  });

  await withSecret(undefined, async () => {
    const response = await POST(request(`Bearer ${SECRET}`));
    responses.push({ status: response.status, body: await response.json() });
  });

  const first = JSON.stringify(responses[0]);
  for (const response of responses) {
    assert.equal(
      JSON.stringify(response),
      first,
      `one refusal answers differently from another:\n  ${first}\n  ` +
        `${JSON.stringify(response)}`,
    );
  }
});

test("the comparison is constant time over equal-length secrets", async () => {
  // The implementation must not return early on the first differing character.
  // Asserted on the source rather than on a timing, because a timing test is
  // flaky on a shared runner and this property is visible in four lines.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");

  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, "..", "..", "src", "app", "api", "revalidate", "route.ts"),
    "utf8",
  );

  const authorised = source.slice(
    source.indexOf("function authorised"),
    source.indexOf("export async function POST"),
  );

  assert.ok(
    /diff \|=/.test(authorised),
    `the secret comparison in api/revalidate no longer accumulates a ` +
      `difference across the whole string. A === or an early return leaks the ` +
      `secret one character at a time through response timings.`,
  );
  assert.ok(
    !/offered === secret|secret === offered/.test(authorised),
    "the secret is compared with ===, which short-circuits.",
  );
});

/* --------------------------------------------------------------- the tags */

test("an unknown tag is a 400, not a successful no-op", async () => {
  // A typo would otherwise revalidate nothing and report success — which is
  // exactly what makes a stale price look like a scraper bug.
  await withSecret(SECRET, async () => {
    const response = await POST(
      request(`Bearer ${SECRET}`, { tags: ["rackets", "racketz"] }),
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { revalidated: boolean; error: string };
    assert.equal(body.revalidated, false);
    assert.match(body.error, /racketz/);
  });
});

test("an unknown tag is refused before authorisation is granted to anyone else", async () => {
  // The 400 must not be reachable without the secret, or it becomes an oracle
  // for which tags exist.
  await withSecret(SECRET, async () => {
    const response = await POST(request("Bearer wrong-secret-of-len", { tags: ["nope"] }));
    assert.equal(response.status, 401, "an unauthenticated caller learned a tag was invalid.");
  });
});

test("isCacheTag accepts every declared tag and nothing else", () => {
  for (const tag of ALL_TAGS) assert.ok(isCacheTag(tag), tag);

  for (const impostor of [
    "racket",
    "Rackets",
    "rackets ",
    "",
    "__proto__",
    "constructor",
    "toString",
  ]) {
    assert.ok(!isCacheTag(impostor), `"${impostor}" was accepted as a cache tag.`);
  }
});

test("the scrape defaults are the tables a price walk actually changes", () => {
  // Brands and guides do not move on a scrape; revalidating them would only
  // throw away warm entries.
  assert.deepEqual(SCRAPE_TAGS, [TAG.rackets, TAG.sellers, TAG.offers, TAG.pricePoints]);

  // Widened deliberately: the point is that these two are absent, and a
  // narrowly typed `includes` would refuse to ask the question at all.
  const scraped: string[] = SCRAPE_TAGS;
  assert.ok(!scraped.includes(TAG.brands));
  assert.ok(!scraped.includes(TAG.guides));

  for (const tag of SCRAPE_TAGS) assert.ok(ALL_TAGS.includes(tag));
});

test("a malformed body does not become a server error", async () => {
  await withSecret(SECRET, async () => {
    const malformed = new Request(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: "{not json",
    });

    // Falls through to the scrape defaults rather than throwing. That path
    // calls revalidateTag, which needs a Next request context, so the
    // assertion is only that it does not reject with a parse error.
    await assert.rejects(
      () => POST(malformed),
      (error: Error) => !/JSON|Unexpected token/i.test(error.message),
      "a malformed body reached the JSON parser instead of being swallowed.",
    );
  });
});
