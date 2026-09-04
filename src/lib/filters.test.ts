import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_FILTERS } from "./types";
import { filtersToQuery, parseFilters } from "./filters";

test("popular brands are the catalogue's clean-URL default", () => {
  assert.equal(parseFilters({}).sort, "popular");
  assert.deepEqual(filtersToQuery(EMPTY_FILTERS), {});
});

test("an explicit Court Score sort remains shareable", () => {
  assert.deepEqual(
    filtersToQuery({ ...EMPTY_FILTERS, sort: "score" }),
    { sort: "score" },
  );
});
