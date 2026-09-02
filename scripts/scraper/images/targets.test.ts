import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseEquivalentRacketTargets,
  type RacketTarget,
} from "./targets";

function target(id: string, slug: string): RacketTarget {
  return {
    id,
    slug,
    name: "Nanoflare 800 Pro",
    brandSlug: "yonex",
    brandName: "Yonex",
    equivalentIds: [id],
  };
}

test("collapses brand-prefixed duplicate rackets onto the public route record", () => {
  const collapsed = collapseEquivalentRacketTargets([
    target("r-yonex-nanoflare-800-pro", "yonex-nanoflare-800-pro"),
    target("r-nanoflare-800-pro", "nanoflare-800-pro"),
  ]);

  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].id, "r-nanoflare-800-pro");
  assert.deepEqual(collapsed[0].equivalentIds, [
    "r-nanoflare-800-pro",
    "r-yonex-nanoflare-800-pro",
  ]);
});

test("does not merge the same model slug across brands", () => {
  const yonex = target("r-yonex-model", "model");
  const victor = {
    ...target("r-victor-model", "model"),
    brandSlug: "victor",
    brandName: "Victor",
  };

  assert.equal(collapseEquivalentRacketTargets([yonex, victor]).length, 2);
});
