/**
 * The abort path, which is what makes an abandoned shop actually stop.
 *
 * A watchdog that only stops *waiting* for a shop is half a fix: the walk keeps
 * fetching, keeps retrying with backoff, and keeps competing for the runner
 * with the shops that came after it. These tests pin the other half.
 *
 *   npm run test:scraper
 */

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { fetchWithRetry, pool } from "./http";

let server: Server;
let origin = "";
/** Requests the server actually received, by path. */
const hits = new Map<string, number>();

before(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "/";
    hits.set(path, (hits.get(path) ?? 0) + 1);

    if (path.startsWith("/hang")) return; // never answers, never closes
    if (path.startsWith("/flaky")) {
      res.writeHead(503).end("try again");
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  origin = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

describe("fetchWithRetry with a caller's abort signal", () => {
  it("fetches normally when the signal never fires", async () => {
    const res = await fetchWithRetry(`${origin}/ok`);
    assert.equal(res.ok, true);
    assert.equal(res.body, "ok");
  });

  it("never touches the host once the caller has given up", async () => {
    const path = "/ok-already-aborted";
    await assert.rejects(() => fetchWithRetry(`${origin}${path}`, { signal: AbortSignal.abort() }));
    assert.equal(hits.get(path), undefined, "an abandoned shop must not be fetched at all");
  });

  it("stops mid-flight instead of running out the request timeout", async () => {
    const path = "/hang-aborted-midflight";
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("Abandoned after 30 minute(s)")), 30);

    const startedAt = Date.now();
    await assert.rejects(
      () =>
        fetchWithRetry(`${origin}${path}`, {
          signal: controller.signal,
          timeoutMs: 30_000,
          retries: 3,
        }),
      /Abandoned after 30 minute\(s\)/,
    );

    assert.ok(Date.now() - startedAt < 5_000, "should not wait out the 30s request timeout");
    // One attempt, not four: the caller's abort is not a transient fault.
    assert.equal(hits.get(path), 1);
  });

  it("does not spend its retries after the caller aborts between attempts", async () => {
    const path = "/flaky-aborted-between-attempts";
    const controller = new AbortController();

    // 503 is retried with a 1s backoff; abort inside that window.
    setTimeout(() => controller.abort(new Error("Abandoned after 1 minute(s)")), 50);

    await assert.rejects(
      () => fetchWithRetry(`${origin}${path}`, { signal: controller.signal, retries: 5 }),
      /Abandoned after 1 minute\(s\)/,
    );
    assert.equal(hits.get(path), 1);
  });

  it("still returns a 503 as a status rather than a throw when nobody aborts", async () => {
    const res = await fetchWithRetry(`${origin}/flaky-no-abort`, { retries: 1 });
    assert.equal(res.ok, false);
    assert.equal(res.status, 503);
  });
});

describe("pool", () => {
  it("runs every item and keeps their order", async () => {
    const out = await pool([1, 2, 3, 4, 5], 2, 0, async (n) => n * 2);
    assert.deepEqual(out, [2, 4, 6, 8, 10]);
  });

  it("stops dispatching once a worker throws, and reports that error", async () => {
    const seen: number[] = [];
    await assert.rejects(
      () =>
        pool(Array.from({ length: 50 }, (_, i) => i), 2, 0, async (n) => {
          seen.push(n);
          if (n >= 3) throw new Error("aborted");
          return n;
        }),
      /aborted/,
    );

    // Without the bail-out this walked all 50 items for a result the caller
    // had already given up on.
    assert.ok(seen.length < 12, `dispatched ${seen.length} of 50 items after the failure`);
  });
});
