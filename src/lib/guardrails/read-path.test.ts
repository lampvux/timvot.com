import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The catalogue listing must not read the catalogue.
 *
 * `/rackets` answers a page from `racket_market` with the offset applied in
 * Postgres — ~126 ms and 1 KB. It then used to call `getBrands()`, which
 * called `loadSnapshot()`, which read seven tables in full: 9,4 MB, ~6,6 s
 * from a laptop, and far worse from a function that is not in the database's
 * region. Because that call sits on the route's dynamic half, it ran per
 * request against a per-instance in-memory cache, so the miss was routine
 * rather than rare. The page closed at 23,14 s in production.
 *
 * These are source-level assertions on purpose. The failure they guard is
 * someone adding one convenient snapshot read back to a hot path, and that is
 * visible in the import list long before it is visible in a timing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..");

const read = (...parts: string[]) => readFileSync(join(src, ...parts), "utf8");

/** Repository functions that read the whole catalogue to answer anything. */
const WHOLE_CATALOGUE = ["loadSnapshot", "getRackets"];

test("the catalogue listing imports no whole-catalogue read", () => {
  const page = read("app", "[locale]", "rackets", "page.tsx");

  // `[^}]` already spans newlines, so this needs no dotAll flag — which
  // `target: "ES2017"` in tsconfig.json does not allow.
  const imports = page.match(
    /import\s*\{([^}]*)\}\s*from\s*"@\/lib\/data\/repository"/,
  );
  assert.ok(imports, "the listing should still import from the repository");

  const named = imports[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  for (const forbidden of WHOLE_CATALOGUE) {
    assert.ok(
      !named.includes(forbidden),
      `/rackets imports ${forbidden}. It reads the whole catalogue to render ` +
        `24 cards — extend the query-shaped read instead.`,
    );
  }
});

test("the brand list is read as the brand list", () => {
  const repository = read("lib", "data", "repository.ts");

  const body = repository.match(
    /async function readCatalogBrands\(\)[^{]*\{([\s\S]*?)\n\}/,
  );
  assert.ok(body, "readCatalogBrands should still exist and be the brand read");

  for (const forbidden of ["loadSnapshot", "loadIndex"]) {
    assert.ok(
      !body[1].includes(forbidden),
      `readCatalogBrands calls ${forbidden}, which loads seven tables to ` +
        `return thirty-six rows.`,
    );
  }

  // The tables the brand filter has no business touching, whatever route it
  // is reached from.
  for (const table of ["rackets", "offers", "price_points", "racket_images"]) {
    assert.ok(
      !body[1].includes(`"${table}"`),
      `readCatalogBrands reads the ${table} table.`,
    );
  }
});

test("the brand read is tagged so a scrape can invalidate it", () => {
  const repository = read("lib", "data", "repository.ts");
  const body = repository.match(
    /async function readCatalogBrands\(\)[^{]*\{([\s\S]*?)\n\}/,
  );
  assert.ok(body);

  // Without `use cache` the route cannot prerender a static shell at all —
  // Next treats the Supabase call as runtime data and refuses.
  assert.match(body[1], /"use cache"/);
  assert.match(body[1], /cacheTag\(\s*TAG\.brands\s*\)/);
});
