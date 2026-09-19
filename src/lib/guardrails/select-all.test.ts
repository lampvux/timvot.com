import assert from "node:assert/strict";
import test from "node:test";
import { chainFrom, callRanges, list, read, within } from "./source";

/**
 * A read of a table that can exceed 1000 rows is paged, or it is bounded.
 *
 * PostgREST caps a response at `db-max-rows` — 1000 by default — and reports
 * *no error* when it truncates. A plain `.select()` therefore returned the
 * first 1000 of 3037 rackets and 404ed every detail page beyond it, with
 * nothing anywhere to say so. `selectAll` exists to page past that, and it
 * only works if the query it pages carries a total ordering: Postgres makes no
 * promise about row order between two statements, so paging an unordered
 * result puts some rows on two pages and drops others entirely.
 *
 * This asserts the invariant on the source rather than the symptom in
 * production, because the symptom is silent by construction.
 */

const REPOSITORY = ["lib", "data", "repository.ts"] as const;
const STRING_REPOSITORY = ["lib", "data", "string-repository.ts"] as const;
const CATALOG_PAGE = ["lib", "data", "catalog-page.ts"] as const;

/**
 * Tables and views whose row count is not bounded by anything the product
 * controls. `brands` and `guides` are editorial and tiny; they are absent on
 * purpose.
 */
const UNBOUNDED = [
  "rackets",
  "racket_variants",
  "racket_images",
  "racket_market",
  "racket_scores",
  "offers",
  "price_points",
  "reviews",
  "deal_watch",
  "strings",
  "string_offers",
  "string_price_points",
] as const;

/** A read is safe if it pages, or if it can only ever return a few rows. */
const BOUNDED_BY = [".range(", ".limit(", ".in(", ".single(", ".maybeSingle("];
const IS_COUNT = /head:\s*true/;

/**
 * How far past a read to look for the thing that bounds it.
 *
 * Not every query is one chain. `getCatalogPage` assigns the builder to a
 * `query` variable, adds predicates in a loop, and applies `.range()` several
 * statements later; `readFacetCounts` does the same. Insisting the bound sit
 * inside the chain would fail both of those correct reads, so the window is
 * the enclosing few statements instead. The cost is that an unrelated
 * `.range()` nearby could mask a genuine offender — acceptable for a rule
 * whose job is catching a *newly added* naked full-table read, not proving a
 * theorem.
 */
const BOUND_WINDOW = 1500;

interface Read {
  table: string;
  chain: string;
  index: number;
  pages: boolean;
  bounded: boolean;
}

function readsIn(source: string): Read[] {
  const ranges = callRanges(source, "selectAll");
  const found: Read[] = [];

  for (const match of source.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) {
    const table = match[1];
    if (!(UNBOUNDED as readonly string[]).includes(table)) continue;

    const index = match.index!;
    const chain = chainFrom(source, index);
    if (!chain.includes(".select(")) continue;

    const window = source.slice(index, index + BOUND_WINDOW);
    const scope = chain.includes(".range(") ? chain : window;

    found.push({
      table,
      chain,
      index,
      pages: within(ranges, index),
      bounded:
        BOUNDED_BY.some((marker) => scope.includes(marker)) || IS_COUNT.test(scope),
    });
  }

  return found;
}

/**
 * Reads that are known to be unpaged and unbounded today.
 *
 * This is debt, named rather than hidden: `string-repository.ts` reads four
 * tables in full with no paging at all, so a catalogue that grows past 1000
 * strings, string offers or string price points will truncate exactly the way
 * the racket catalogue did — silently. The entry stays until that file reads
 * through `selectAll`, and the test below fails when an entry stops being
 * needed, so fixing one cannot leave a stale exemption behind.
 */
const KNOWN_UNPAGED: Record<string, string[]> = {
  "string-repository.ts": [
    "strings",
    "string_offers",
    "string_price_points",
  ],
};

test("every unbounded read in the repository pages or is bounded", () => {
  const offenders = readsIn(read(...REPOSITORY))
    .filter((r) => !r.pages && !r.bounded)
    .map((r) => r.table);

  assert.deepEqual(
    offenders,
    [],
    `repository.ts reads ${list(offenders)} without selectAll, a .range(), a ` +
      `.limit() or an .in(). PostgREST truncates at 1000 rows and reports no ` +
      `error, so this returns a partial catalogue that looks complete.`,
  );
});

test("every unbounded read in the catalogue page query pages or is bounded", () => {
  const offenders = readsIn(read(...CATALOG_PAGE))
    .filter((r) => !r.pages && !r.bounded)
    .map((r) => r.table);

  assert.deepEqual(offenders, [], `catalog-page.ts: ${list(offenders)}`);
});

test("the string catalogue's unpaged reads are exactly the ones we know about", () => {
  const offenders = readsIn(read(...STRING_REPOSITORY))
    .filter((r) => !r.pages && !r.bounded)
    .map((r) => r.table);

  const known = KNOWN_UNPAGED["string-repository.ts"];

  const unexpected = offenders.filter((table) => !known.includes(table));
  assert.deepEqual(
    unexpected,
    [],
    `string-repository.ts gained a new unpaged read of ${list(unexpected)}. ` +
      `Route it through selectAll rather than adding it to KNOWN_UNPAGED.`,
  );

  const stale = known.filter((table) => !offenders.includes(table));
  assert.deepEqual(
    stale,
    [],
    `${list(stale)} now pages correctly in string-repository.ts. Remove it ` +
      `from KNOWN_UNPAGED so the exemption cannot outlive the problem.`,
  );
});

test("every selectAll pages against a total ordering", () => {
  for (const file of [REPOSITORY, STRING_REPOSITORY, CATALOG_PAGE]) {
    const source = read(...file);

    for (const [from, to] of callRanges(source, "selectAll")) {
      const body = source.slice(from, to + 1);

      // Not every selectAll takes a literal chain — `getDeals` passes a `page`
      // factory defined just above it, so both the range and the ordering live
      // outside the call. Those are checked by the next assertion instead.
      if (!body.includes(".select(")) continue;

      assert.ok(
        body.includes(".range("),
        `a selectAll in ${file.join("/")} pages a query with no .range(); ` +
          `it would read the same first page forever.`,
      );

      assert.ok(
        body.includes(".order("),
        `a selectAll in ${file.join("/")} pages an unordered query. ` +
          `Postgres makes no promise about row order between statements, so ` +
          `this duplicates some rows and drops others.\n${body.slice(0, 300)}`,
      );
    }
  }
});

test("a page factory handed to selectAll orders before it ranges", () => {
  // `getDeals` builds its query as a named `page` function and hands it to
  // `selectAll` — the one shape the assertion above deliberately skips.
  const source = read(...REPOSITORY);

  for (const match of source.matchAll(
    /const\s+page\s*=\s*\([^)]*\)\s*=>\s*/g,
  )) {
    const chain = chainFrom(source, match.index! + match[0].length);
    if (!chain.includes(".range(")) continue;

    assert.ok(
      chain.includes(".order("),
      `the page factory at index ${match.index} ranges without ordering.`,
    );
  }
});
