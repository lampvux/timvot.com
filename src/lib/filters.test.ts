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

test("each spec-profile axis is a sort the URL keeps", () => {
  for (const axis of ["power", "speed", "control", "comfort"] as const) {
    assert.equal(parseFilters({ sort: axis }).sort, axis);
    assert.deepEqual(filtersToQuery({ ...EMPTY_FILTERS, sort: axis }), {
      sort: axis,
    });
  }
});

test("an unknown sort falls back to the default instead of erroring", () => {
  assert.equal(parseFilters({ sort: "stiffness" }).sort, "popular");
  assert.equal(parseFilters({ sort: "spec_power" }).sort, "popular");
});
