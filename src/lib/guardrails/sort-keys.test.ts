import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { AXIS_SORTS } from "@/lib/types";
import type { SortKey } from "@/lib/types";
import { ROOT, read, readRoot } from "./source";

/**
 * A sort key is five places that have to agree: the type, the view's ORDER BY
 * (`catalog-page.ts`), the in-memory fallback (`sortRackets`), the select in
 * the filter rail, and a label in both message files. Miss the view and the
 * sort silently becomes Court Score order; miss the fallback and it does so
 * only when the database is away, which is the case nobody looks at.
 *
 * The four axis sorts add a sixth and seventh: `racket_scores.spec_<axis>` has
 * to exist in a migration and `refresh-market.ts` has to write it, or the view
 * orders by a column that is null for every racket.
 */

const ALL_SORTS: SortKey[] = [
  "popular",
  "score",
  "price-asc",
  "price-desc",
  "new",
  ...AXIS_SORTS,
];

const LABEL_KEY: Record<SortKey, string> = {
  popular: "sortPopular",
  score: "sortScore",
  "price-asc": "sortPriceAsc",
  "price-desc": "sortPriceDesc",
  new: "sortNewest",
  power: "sortPower",
  speed: "sortSpeed",
  control: "sortControl",
  comfort: "sortComfort",
};

test("the filter rail offers every sort key, each with a label in both locales", () => {
  const rail = read("components", "filter-rail.tsx");
  const vi = JSON.parse(readRoot("messages", "vi.json")).catalog;
  const en = JSON.parse(readRoot("messages", "en.json")).catalog;

  for (const sort of ALL_SORTS) {
    assert.ok(
      rail.includes(`value: "${sort}"`),
      `filter-rail.tsx has no option for sort "${sort}".`,
    );
    const key = LABEL_KEY[sort];
    assert.ok(rail.includes(`tc("${key}")`), `filter-rail.tsx does not label "${sort}" with ${key}.`);
    assert.ok(vi[key], `messages/vi.json catalog.${key} is missing.`);
    assert.ok(en[key], `messages/en.json catalog.${key} is missing.`);
  }
});

test("the view and the in-memory fallback both order by every axis", () => {
  const view = read("lib", "data", "catalog-page.ts");
  const memory = read("lib", "data", "repository.ts");

  for (const axis of AXIS_SORTS) {
    assert.match(view, new RegExp(`case "${axis}":`), `applySort has no case for "${axis}".`);
    assert.match(memory, new RegExp(`case "${axis}":`), `sortRackets has no case for "${axis}".`);
  }
  // The view orders by the stored column, never by an expression that would
  // restate specProfile() in SQL.
  assert.match(view, /order\(`spec_\$\{sort\}`/);
});

test("every axis column is created by a migration and written by refresh-market", () => {
  const migrations = readdirSync(join(ROOT, "supabase", "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readRoot("supabase", "migrations", name))
    .join("\n");
  const refresh = readRoot("scripts", "refresh-market.ts");

  for (const axis of AXIS_SORTS) {
    const column = `spec_${axis}`;
    assert.ok(
      migrations.includes(`add column if not exists ${column} `),
      `no migration adds racket_scores.${column}.`,
    );
    assert.ok(
      new RegExp(`s\\.${column}[,\\s]`).test(migrations),
      `no migration exposes ${column} on racket_market.`,
    );
    assert.ok(
      refresh.includes(`${column}: score.spec.${axis},`),
      `refresh-market.ts does not write ${column} from the spec profile.`,
    );
  }
});
