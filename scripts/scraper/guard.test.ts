/**
 * The claim under test: one shop failing costs that shop and nothing else.
 *
 *   npm run test:scraper
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { describeBudget, runGuarded, walkSites } from "./guard";
import type { ScraperResult, ScraperSource } from "./types";

const NO_TIMEOUT = Infinity;

function ok(source: ScraperSource, itemsCount = 10): ScraperResult {
  return { source, success: true, itemsCount, products: [], durationMs: 1 };
}

/** A shop that never answers, and notices when it is told to stop. */
function hangs(): { walk: (source: ScraperSource, signal: AbortSignal) => Promise<ScraperResult>; aborted: () => boolean } {
  let aborted = false;
  return {
    aborted: () => aborted,
    walk: (_source, signal) =>
      new Promise<ScraperResult>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        });
      }),
  };
}

describe("describeBudget", () => {
  it("reports the budget in the unit --site-timeout was given in", () => {
    // The flag takes seconds, so rounding a short budget to "1 minute" would
    // send someone looking for a limit they did not set.
    assert.equal(describeBudget(1_000), "1s");
    assert.equal(describeBudget(45_000), "45s");
    assert.equal(describeBudget(30 * 60 * 1000), "30 min");
    assert.equal(describeBudget(Infinity), "no time limit");
  });

  it("never rounds a real budget down to zero", () => {
    assert.equal(describeBudget(200), "1s");
  });
});

describe("runGuarded", () => {
  it("passes a healthy walk straight through", async () => {
    const result = await runGuarded("vnb", (source) => Promise.resolve(ok(source, 1204)), NO_TIMEOUT);
    assert.equal(result.success, true);
    assert.equal(result.itemsCount, 1204);
  });

  it("turns an unexpected throw into a skipped shop rather than a rejection", async () => {
    const result = await runGuarded(
      "fbshop",
      () => {
        throw new Error("Cannot read properties of undefined (reading 'slug')\n    at parse (…)");
      },
      NO_TIMEOUT,
    );
    assert.equal(result.success, false);
    assert.equal(result.source, "fbshop");
    // First line only: a stack in a report table is a report nobody reads.
    assert.equal(result.error, "Cannot read properties of undefined (reading 'slug')");
  });

  it("catches a rejected promise the same way as a synchronous throw", async () => {
    const result = await runGuarded("hvshop", () => Promise.reject(new Error("socket hang up")), NO_TIMEOUT);
    assert.equal(result.success, false);
    assert.equal(result.error, "socket hang up");
  });

  it("survives a shop that throws something that is not an Error", async () => {
    const result = await runGuarded("vnb", () => Promise.reject("403 from the WAF"), NO_TIMEOUT);
    assert.equal(result.success, false);
    assert.equal(result.error, "403 from the WAF");
  });

  it("abandons a shop that overruns its budget, and aborts its requests", async () => {
    const shop = hangs();
    const result = await runGuarded("hvshop", shop.walk, 30);

    assert.equal(result.success, false);
    assert.equal(result.timedOut, true);
    assert.match(String(result.error), /budget/);
    assert.match(String(result.error), /--site-timeout/);
    // The point of the signal: the abandoned shop stops fetching rather than
    // walking on in the background while the next shop runs.
    assert.equal(shop.aborted(), true);
  });

  it("does not abort a shop that finishes inside its budget", async () => {
    let aborted = false;
    const result = await runGuarded(
      "vnb",
      (source, signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return Promise.resolve(ok(source));
      },
      60_000,
    );
    assert.equal(result.success, true);

    // The watchdog's timer is cleared, not merely ignored — otherwise it would
    // fire mid-way through the next shop's walk.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(aborted, false);
  });

  it("reports a slow shop's own error when it loses the race by a hair", async () => {
    const result = await runGuarded(
      "fbshop",
      () => new Promise<ScraperResult>((_r, reject) => setTimeout(() => reject(new Error("read ETIMEDOUT")), 5)),
      5_000,
    );
    assert.equal(result.error, "read ETIMEDOUT");
    assert.equal(result.timedOut, undefined);
  });
});

describe("walkSites", () => {
  const sources: ScraperSource[] = ["vnb", "qvbadminton", "fbshop", "hvshop"];

  it("keeps walking the shops after the one that failed", async () => {
    const visited: ScraperSource[] = [];
    const results = await walkSites(
      sources,
      (source) => {
        visited.push(source);
        if (source === "qvbadminton") throw new Error("Store API returned HTTP 403");
        return Promise.resolve(ok(source, 500));
      },
      { timeoutMs: NO_TIMEOUT },
    );

    assert.deepEqual(visited, sources);
    assert.equal(results.length, 4);
    assert.deepEqual(
      results.map((r) => r.success),
      [true, false, true, true],
    );
    // The three healthy shops still carry their products into the sync.
    assert.equal(
      results.filter((r) => r.success).reduce((sum, r) => sum + r.itemsCount, 0),
      1500,
    );
  });

  it("keeps walking after a shop that hangs, without waiting on it", async () => {
    const visited: ScraperSource[] = [];
    const results = await walkSites(
      ["hvshop", "vnb"],
      (source, signal) => {
        visited.push(source);
        if (source === "hvshop") return hangs().walk(source, signal);
        return Promise.resolve(ok(source));
      },
      { timeoutMs: 30 },
    );

    assert.deepEqual(visited, ["hvshop", "vnb"]);
    assert.equal(results[0].timedOut, true);
    assert.equal(results[1].success, true);
  });

  it("returns one result per source, in the order they were asked for", async () => {
    const results = await walkSites(sources, (source) => Promise.resolve(ok(source)), {
      timeoutMs: NO_TIMEOUT,
    });
    assert.deepEqual(
      results.map((r) => r.source),
      sources,
    );
  });

  it("reports each shop as it finishes rather than only at the end", async () => {
    const started: ScraperSource[] = [];
    const finished: ScraperSource[] = [];
    await walkSites(
      ["vnb", "hvshop"],
      (source) => {
        // Whatever was reported before this shop started must already be final.
        assert.deepEqual(finished, started.slice(0, -1));
        return source === "hvshop" ? Promise.reject(new Error("HTTP 403")) : Promise.resolve(ok(source));
      },
      {
        timeoutMs: NO_TIMEOUT,
        onStart: (source) => started.push(source),
        onResult: (result) => finished.push(result.source),
      },
    );
    assert.deepEqual(started, ["vnb", "hvshop"]);
    assert.deepEqual(finished, ["vnb", "hvshop"]);
  });

  it("returns nothing rather than throwing when no source was selected", async () => {
    const results = await walkSites([], () => Promise.reject(new Error("never called")), {
      timeoutMs: NO_TIMEOUT,
    });
    assert.deepEqual(results, []);
  });
});
