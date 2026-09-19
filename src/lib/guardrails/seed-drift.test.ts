import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_REVIEWS_FOR_PLAYER_SCORE } from "@/lib/court-score";
import * as seed from "@/lib/data/seed";
import { ROOT, read } from "./source";

/**
 * `supabase/seed.sql` is generated, not edited.
 *
 * The seeded catalogue exists so the app answers the same questions with no
 * database as with one — a fresh clone, a design review, a preview before the
 * project is provisioned, and every end-to-end test in `e2e/`. That promise
 * only holds while the two copies agree. Hand-editing the SQL desynchronises
 * Postgres from the in-memory fallback, and the symptom is a page that renders
 * differently in CI than it does in production, which is a long afternoon.
 *
 * So: change `src/lib/data/seed.ts`, then run `npm run seed:sql`. This test is
 * the thing that notices when only one of those happened.
 */

const SEED_SQL = join(ROOT, "supabase", "seed.sql");

/**
 * Line endings are not content.
 *
 * The generator writes LF. Git checks the file out as CRLF wherever
 * `core.autocrlf` is on, which is the default on Windows — so a byte-for-byte
 * comparison reports the whole file as drifted on half the machines that run
 * it, and reports it identically whether or not anything actually changed.
 */
const normalise = (sql: string) => sql.replace(/\r\n/g, "\n");

test("supabase/seed.sql is what the generator would write", () => {
  const committed = readFileSync(SEED_SQL, "utf8");

  // The generator writes to a fixed path, so the check is: regenerate, compare,
  // and put the committed bytes back whatever the answer. In the passing case
  // the restore writes identical content; in the failing case it leaves the
  // working tree exactly as the test found it, so a red test never also
  // becomes an unexpected diff.
  let regenerated: string;
  try {
    // `node --import tsx`, not `npx`: no shell, no PATH lookup, and no
    // DEP0190 warning about unescaped arguments on Windows.
    execFileSync(process.execPath, ["--import", "tsx", "scripts/generate-seed.ts"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    regenerated = readFileSync(SEED_SQL, "utf8");
  } finally {
    writeFileSync(SEED_SQL, committed, "utf8");
  }

  assert.equal(
    normalise(regenerated),
    normalise(committed),
    `supabase/seed.sql differs from what src/lib/data/seed.ts generates. ` +
      `Either the SQL was hand-edited, or seed.ts changed without running ` +
      `\`npm run seed:sql\`. Run it and commit the result — the no-database ` +
      `fallback and Postgres have to hold the same catalogue.`,
  );
});

test("the generator is the only writer of seed.sql", () => {
  // A second script writing the same file would make the check above pass
  // while the two sources still disagree.
  const generator = readFileSync(join(ROOT, "scripts", "generate-seed.ts"), "utf8");

  assert.ok(
    generator.includes("../supabase/seed.sql"),
    "scripts/generate-seed.ts no longer targets supabase/seed.sql.",
  );
});

test("the seeded catalogue is big enough to render every surface", () => {
  // The e2e suite runs against this data with Supabase unset. A seed that
  // shrank below one page of results, or lost its reviews, would turn several
  // specs green for the wrong reason — they would be asserting on an empty
  // state rather than on the thing they name.
  assert.ok(seed.brands.length >= 3, "fewer than three brands: the brand facet has nothing to show.");
  assert.ok(seed.rackets.length >= 12, `only ${seed.rackets.length} rackets seeded.`);
  assert.ok(seed.sellers.length >= 3, "fewer than three sellers: the seller count column is meaningless.");
  assert.ok(seed.offers.length >= 20, "too few offers to produce a lowest price on most rackets.");
  assert.ok(
    seed.priceHistory.length > 0,
    "the seed has no price history, so the sparkline and /deals render empty.",
  );
  assert.ok(
    seed.reviews.length > 0,
    "the seed has no reviews, so nothing exercises the Court Score's player half.",
  );
});

test("at least one seeded racket has enough reviews for a full Court Score", () => {
  // Without this, every detail page in the e2e run says "spec profile only"
  // and the 50/50 half of the score is never rendered by any test.
  const byRacket = new Map<string, number>();
  for (const review of seed.reviews) {
    byRacket.set(review.racketId, (byRacket.get(review.racketId) ?? 0) + 1);
  }

  const scored = [...byRacket.values()].filter(
    (count) => count >= MIN_REVIEWS_FOR_PLAYER_SCORE,
  );

  assert.ok(
    scored.length > 0,
    `no seeded racket reaches ${MIN_REVIEWS_FOR_PLAYER_SCORE} reviews, so ` +
      `courtScore() returns null for the whole seeded catalogue and nothing ` +
      `renders the published score.`,
  );
});

test("at least one seeded racket has too few reviews to be scored", () => {
  // The other half of the same argument: the "spec profile only" state needs a
  // racket to render it.
  const byRacket = new Map<string, number>();
  for (const racket of seed.rackets) byRacket.set(racket.id, 0);
  for (const review of seed.reviews) {
    byRacket.set(review.racketId, (byRacket.get(review.racketId) ?? 0) + 1);
  }

  const unscored = [...byRacket.values()].filter(
    (count) => count < MIN_REVIEWS_FOR_PLAYER_SCORE,
  );

  assert.ok(
    unscored.length > 0,
    `every seeded racket clears ${MIN_REVIEWS_FOR_PLAYER_SCORE} reviews, so ` +
      `nothing exercises the "spec profile only" state.`,
  );
});

test("the seed is timezone-independent", () => {
  // `new Date(y, m, d)` builds in local time and `.toISOString()` renders UTC,
  // so a seed built that way differs between Hanoi and a CI runner — which
  // makes the drift test above unfalsifiable and every regenerated seed a
  // seventy-three-line diff for no change.
  const source = read("lib", "data", "seed.ts");

  const localDates = [
    ...source.matchAll(/new Date\(\s*(\d{4})\s*,/g),
  ].map((m) => m[0]);

  assert.deepEqual(
    localDates,
    [],
    `src/lib/data/seed.ts builds ${localDates.length} date(s) with the ` +
      `local-time constructor. Use Date.UTC(...) so the generated seed.sql is ` +
      `the same bytes on every machine.`,
  );
});
