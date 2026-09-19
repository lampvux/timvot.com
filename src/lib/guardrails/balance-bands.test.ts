import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { balanceTypeOf } from "@/lib/format";
import {
  BALANCE_MAX_MM,
  BALANCE_MIN_MM,
  EVEN_BAND_MAX_MM,
  EVEN_BAND_MIN_MM,
} from "@/lib/types";
import { ROOT, read } from "./source";

/**
 * TypeScript and SQL have to agree about where "even" starts and stops.
 *
 * `racket_market` resolves `balance_type` in a CASE expression so the
 * catalogue can filter and sort on it in Postgres. That makes the band a
 * constant in two languages, and the two cannot import each other. When they
 * disagree, a racket is filtered as head-heavy and badged as even on the same
 * page — the kind of bug that reads as a data problem for a week.
 *
 * `catalog-page.ts` already throws at runtime through `assertBalanceBands()`.
 * That is the right belt, and this is the braces: a test fails in CI, before
 * the throw can reach a visitor, and it checks the migration text rather than
 * only the TypeScript constant.
 */

const MIGRATIONS = join(ROOT, "supabase", "migrations");

/**
 * Migrations that *resolve* the band, not ones that merely select it.
 *
 * `20260910000000_racket_detail_rpc.sql` reads `balance_type` straight off the
 * view, which is the correct thing to do and is not a second definition of the
 * band. Only a file that compares `balance_point_mm` to a literal is restating
 * the constant, and only those have to agree with `types.ts`.
 */
const BAND_COMPARISON = /balance_point_mm\s*(?:<=|>=|<|>)\s*\d+/i;

function migrationsDefiningBalanceType(): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), "utf8") }))
    .filter(({ sql }) => /balance_type/i.test(sql) && BAND_COMPARISON.test(sql));
}

test("the even band is 285–295 mm in TypeScript", () => {
  // Not a tautology: this is the value the SQL below is checked against, so
  // changing one without the other fails here rather than in production.
  assert.equal(EVEN_BAND_MIN_MM, 285);
  assert.equal(EVEN_BAND_MAX_MM, 295);
  assert.ok(
    BALANCE_MIN_MM < EVEN_BAND_MIN_MM && EVEN_BAND_MAX_MM < BALANCE_MAX_MM,
    "the even band has to sit inside the 280–305 mm rule.",
  );
});

test("every migration that resolves balance_type uses the same band", () => {
  const defining = migrationsDefiningBalanceType();

  assert.ok(
    defining.length > 0,
    "no migration defines balance_type on racket_market any more. If the " +
      "view stopped resolving it, the catalogue is back to sorting in JS.",
  );

  for (const { file, sql } of defining) {
    const numbers = [...sql.matchAll(/balance_point_mm\s*(?:<|>|<=|>=)\s*(\d+)/gi)].map(
      (m) => Number(m[1]),
    );

    assert.ok(
      numbers.length >= 2,
      `${file} mentions balance_type but compares balance_point_mm to ` +
        `fewer than two numbers; the CASE cannot be reading a band.`,
    );

    const distinct = [...new Set(numbers)].sort((a, b) => a - b);

    assert.deepEqual(
      distinct,
      [EVEN_BAND_MIN_MM, EVEN_BAND_MAX_MM],
      `${file} bands balance_point_mm at ${distinct.join("–")} while ` +
        `types.ts says ${EVEN_BAND_MIN_MM}–${EVEN_BAND_MAX_MM}. The ` +
        `catalogue would filter a racket as one type and badge it as another.`,
    );
  }
});

test("the runtime guard is still wired into the catalogue read", () => {
  const source = read("lib", "data", "catalog-page.ts");

  assert.ok(
    /function assertBalanceBands\(\)/.test(source),
    "assertBalanceBands() was removed from catalog-page.ts.",
  );

  // Declared is not enough; it has to be called on the path that reads the view.
  const calls = source.match(/assertBalanceBands\(\)/g) ?? [];
  assert.ok(
    calls.length >= 2,
    `assertBalanceBands() is declared in catalog-page.ts but never called. ` +
      `It has to run on the read path, or the disagreement it catches reaches ` +
      `a visitor first.`,
  );
});

test("balanceTypeOf agrees with the band at every boundary", () => {
  // The exact millimetres the CASE has to match, including the endpoints —
  // an off-by-one on an inclusive bound is the whole failure mode.
  assert.equal(balanceTypeOf(EVEN_BAND_MIN_MM - 1), "head-light");
  assert.equal(balanceTypeOf(EVEN_BAND_MIN_MM), "even");
  assert.equal(balanceTypeOf(EVEN_BAND_MAX_MM), "even");
  assert.equal(balanceTypeOf(EVEN_BAND_MAX_MM + 1), "head-heavy");

  assert.equal(balanceTypeOf(BALANCE_MIN_MM), "head-light");
  assert.equal(balanceTypeOf(BALANCE_MAX_MM), "head-heavy");
});
