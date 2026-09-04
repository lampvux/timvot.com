import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePopularBrandTiers,
  orderBrandsByPopularity,
} from "./catalog-ranking";

test("popular racket brands form the leading catalogue tier", () => {
  const rackets = [
    { brandSlug: "apacs", name: "A" },
    { brandSlug: "victor", name: "B" },
    { brandSlug: "yonex", name: "C" },
    { brandSlug: "mizuno", name: "D" },
    { brandSlug: "li-ning", name: "E" },
  ];

  const ordered = [...rackets].sort(comparePopularBrandTiers);

  assert.deepEqual(
    ordered.slice(0, 4).map((racket) => racket.brandSlug),
    ["victor", "yonex", "mizuno", "li-ning"],
  );
  assert.equal(ordered.at(-1)?.brandSlug, "apacs");
});

test("the brand filter uses the editorial order, then alphabetical fallback", () => {
  const brands = [
    { slug: "adidas", name: "Adidas" },
    { slug: "mizuno", name: "Mizuno" },
    { slug: "victor", name: "Victor" },
    { slug: "apacs", name: "Apacs" },
    { slug: "yonex", name: "Yonex" },
    { slug: "li-ning", name: "Li-Ning" },
  ];

  assert.deepEqual(
    orderBrandsByPopularity(brands).map((brand) => brand.slug),
    ["yonex", "li-ning", "victor", "mizuno", "adidas", "apacs"],
  );
});
