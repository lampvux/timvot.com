import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSellerQuery,
  rankSellers,
  sellerCities,
  sellerQueryString,
  type SellerDirectoryEntry,
} from "./seller-ranking";

const seller = (patch: Partial<SellerDirectoryEntry>): SellerDirectoryEntry => ({
  id: patch.slug ?? "s",
  slug: "s",
  name: "S",
  tier: "verified",
  city: "Hà Nội",
  rating: 4.5,
  ordersCount: 0,
  disputeRate: 0,
  since: 2020,
  about: { en: "", vi: "" },
  racketCount: 0,
  offerCount: 0,
  brandCount: 0,
  ...patch,
});

const SELLERS = [
  seller({ slug: "a", name: "Alpha", city: "Hà Nội", tier: "authorised", rating: 4.9, racketCount: 12, brandCount: 3, since: 2018 }),
  seller({ slug: "b", name: "Beta", city: "TP. Hồ Chí Minh", rating: 4.8, racketCount: 1066, brandCount: 9, since: 2023 }),
  seller({ slug: "c", name: "Gamma", city: "Hải Phòng", tier: "new", rating: 0, racketCount: 10, brandCount: 2, since: 2026 }),
  seller({ slug: "d", name: "Delta", city: "TP. Hồ Chí Minh", rating: 4.8, racketCount: 1066, brandCount: 4, since: 2021 }),
];
const CITIES = sellerCities(SELLERS);
const slugs = (list: SellerDirectoryEntry[]) => list.map((s) => s.slug);

test("the default ranking is rackets in stock, ties broken by rating then name", () => {
  const ranked = rankSellers(SELLERS, parseSellerQuery({}, CITIES));
  assert.deepEqual(slugs(ranked), ["b", "d", "a", "c"]);
});

test("rating ranks an unrated seller last, not as a zero", () => {
  const ranked = rankSellers(SELLERS, parseSellerQuery({ sort: "rating" }, CITIES));
  assert.deepEqual(slugs(ranked), ["a", "b", "d", "c"]);
});

test("brands and tenure rank on their own numbers", () => {
  assert.deepEqual(slugs(rankSellers(SELLERS, parseSellerQuery({ sort: "brands" }, CITIES))), ["b", "d", "a", "c"]);
  assert.deepEqual(slugs(rankSellers(SELLERS, parseSellerQuery({ sort: "tenure" }, CITIES))), ["a", "d", "b", "c"]);
});

test("city and tier filter before ranking", () => {
  assert.deepEqual(
    slugs(rankSellers(SELLERS, parseSellerQuery({ city: "TP. Hồ Chí Minh" }, CITIES))),
    ["b", "d"],
  );
  assert.deepEqual(slugs(rankSellers(SELLERS, parseSellerQuery({ tier: "new" }, CITIES))), ["c"]);
  assert.deepEqual(
    rankSellers(SELLERS, parseSellerQuery({ city: "Hà Nội", tier: "new" }, CITIES)),
    [],
  );
});

test("an unknown sort, city or tier falls back to the default instead of erroring", () => {
  assert.deepEqual(parseSellerQuery({ sort: "orders", city: "Paris", tier: "gold" }, CITIES), {
    sort: "rackets",
    city: null,
    tier: null,
  });
});

test("the query string omits defaults, so the plain URL is the default view", () => {
  assert.deepEqual(sellerQueryString(parseSellerQuery({}, CITIES)), {});
  assert.deepEqual(
    sellerQueryString(parseSellerQuery({ sort: "rating", city: "Hà Nội", tier: "authorised" }, CITIES)),
    { sort: "rating", city: "Hà Nội", tier: "authorised" },
  );
});

test("orders are not a sort key", () => {
  // The directory no longer shows order counts, so it must not rank on them.
  assert.equal(parseSellerQuery({ sort: "orders" }, CITIES).sort, "rackets");
});
