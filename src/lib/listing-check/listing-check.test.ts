import assert from "node:assert/strict";
import test from "node:test";
import {
  checkQuery,
  parseCheckInput,
  parsePriceVnd,
  shareQuery,
} from "./input";
import { modelMatch, normalizeQuery, searchTokens, matchesTokens, type RacketCandidate } from "./match";
import { fitFor, questionsForSeller, tradeoffsFor, type FitRacket } from "./advice";

/* ------------------------------------------------------------------ price */

test("asking prices are read the way Facebook listings write them", () => {
  assert.equal(parsePriceVnd("2.500.000"), 2_500_000);
  assert.equal(parsePriceVnd("2,500,000"), 2_500_000);
  assert.equal(parsePriceVnd("2500000"), 2_500_000);
  assert.equal(parsePriceVnd("₫2.500.000đ"), 2_500_000);
  assert.equal(parsePriceVnd("2tr5"), 2_500_000);
  assert.equal(parsePriceVnd("2,5tr"), 2_500_000);
  assert.equal(parsePriceVnd("2 triệu"), 2_000_000);
  assert.equal(parsePriceVnd("2500k"), 2_500_000);
  assert.equal(parsePriceVnd("1.8m"), 1_800_000);
  assert.equal(parsePriceVnd("3.290.000 vnđ"), 3_290_000);
});

test("malformed, negative and implausible prices are rejected", () => {
  for (const bad of ["", "-2500000", "abc", "2.5.0", "12", "999999999", "1e9", "2tr5tr"])
    assert.equal(parsePriceVnd(bad), null, bad);
});

/* ------------------------------------------------------------------- URL */

test("the check URL keeps only known, bounded keys", () => {
  const input = parseCheckInput({
    model: "Yonex/astrox-77-pro",
    variant: "r-astrox-77-pro-4u-g5",
    price: "2tr5",
    condition: "used",
    exp: "1to3",
    injury: "ongoing",
    fb: "https://facebook.com/groups/x/posts/1",
  });
  assert.deepEqual(input.model, { brandSlug: "yonex", slug: "astrox-77-pro" });
  assert.equal(input.priceVnd, 2_500_000);
  assert.equal(input.condition, "used");
  assert.equal(input.profile.experience, "1to3");
  const query = checkQuery(input);
  assert.ok(!("injury" in query) && !("fb" in query));
  assert.equal(query.price, "2500000");
});

test("a malformed model or variant is dropped, not trusted", () => {
  assert.equal(parseCheckInput({ model: "../etc/passwd" }).model, null);
  assert.equal(parseCheckInput({ model: "a/b/c" }).model, null);
  assert.equal(parseCheckInput({ model: "yonex/x", variant: "<script>" }).variantId, null);
  // A variant with no model has nothing to belong to.
  assert.equal(parseCheckInput({ variant: "v1" }).variantId, null);
  assert.equal(parseCheckInput({ condition: "mint" }).condition, "unknown");
});

test("free text is bounded and only kept when no model was confirmed", () => {
  assert.equal(parseCheckInput({ q: "x".repeat(200) }).query.length, 60);
  assert.equal(parseCheckInput({ q: "astrox", model: "yonex/astrox-77-pro" }).query, "");
});

test("a share link carries no profile and no free text", () => {
  const input = parseCheckInput({
    model: "yonex/astrox-77-pro",
    variant: "v4u",
    price: "2500000",
    condition: "new",
    exp: "under1",
    pos: "net",
    fmt: "doubles",
  });
  assert.deepEqual(shareQuery(input), {
    model: "yonex/astrox-77-pro",
    variant: "v4u",
    price: "2500000",
    condition: "new",
  });
  assert.deepEqual(shareQuery(parseCheckInput({ q: "my friend's racket" })), {});
});

/* ----------------------------------------------------------------- match */

const candidate = (name: string): RacketCandidate => ({
  id: name,
  brandSlug: "yonex",
  brandName: "Yonex",
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  releaseYear: 2024,
  thumbUrl: null,
  variants: [],
});

test("spellings of one model normalise to the same tokens", () => {
  assert.equal(normalizeQuery("ASTROX-77"), "astrox 77");
  assert.equal(normalizeQuery("astrox77"), "astrox 77");
  assert.equal(normalizeQuery("Vợt Astrox 77"), "vot astrox 77");
  assert.equal(searchTokens("a"), null);
  assert.equal(searchTokens("x".repeat(61)), null);
  assert.ok(matchesTokens(["astrox", "77"], "Yonex", "Astrox 77 Pro"));
  assert.ok(!matchesTokens(["astrox", "88"], "Yonex", "Astrox 77 Pro"));
});

test("Astrox 77 stays ambiguous until Play, Tour or Pro is chosen", () => {
  const family = ["Astrox 77 Pro", "Astrox 77 Play", "Astrox 77 Tour"].map(candidate);
  assert.equal(modelMatch("Astrox 77", family), "ambiguous");
  // Even the exact name is not exact while its siblings are on the list.
  assert.equal(modelMatch("Astrox 77 Pro", family), "ambiguous");
  assert.equal(modelMatch("Yonex Astrox 77 Pro", [candidate("Astrox 77 Pro")]), "exact");
  assert.equal(modelMatch("astrox 77", [candidate("Astrox 77 Pro")]), "ambiguous");
  assert.equal(modelMatch("nothing", []), "missing");
});

/* ------------------------------------------------------------------ fit */

const racket = (overrides: Partial<FitRacket> = {}): FitRacket => ({
  balancePointMm: 300,
  balanceType: "head-heavy",
  shaftFlex: "stiff",
  skillLevel: "advanced",
  spec: { power: 8, speed: 5, control: 6, comfort: 4 },
  ...overrides,
});

const noProfile = { experience: null, format: null, position: null };

test("without a profile, fit asks for more but still names a tradeoff", () => {
  const fit = fitFor(racket(), noProfile);
  assert.equal(fit.status, "needs_profile");
  assert.ok(fit.tradeoffs.length >= 1);
});

test("every racket has at least one tradeoff", () => {
  for (const balanceType of ["head-light", "even", "head-heavy"] as const)
    assert.ok(tradeoffsFor(racket({ balanceType, shaftFlex: "medium" })).length >= 1);
});

test("a head-heavy frame supports a rear-court singles player", () => {
  const fit = fitFor(racket(), { experience: "over3", format: "singles", position: "rear" });
  assert.equal(fit.status, "supported");
  assert.equal(fit.reasons[0].key, "reasonRear");
});

test("an advanced stiff frame is a concern for a beginner, whatever else fits", () => {
  const fit = fitFor(racket(), { experience: "under1", format: "singles", position: "rear" });
  assert.equal(fit.status, "uncertain");
  assert.equal(fit.reasons[0].key, "concernSkill");
});

test("a head-heavy frame is a concern at the net", () => {
  const fit = fitFor(racket(), { experience: "over3", format: null, position: "net" });
  assert.equal(fit.status, "uncertain");
  assert.equal(fit.reasons[0].key, "concernNet");
});

/* ------------------------------------------------------------ questions */

test("three questions, variant first when it is unknown", () => {
  const used = questionsForSeller("used", false);
  assert.equal(used.length, 3);
  assert.equal(used[0].key, "askVariant");
  assert.equal(questionsForSeller("used", true)[0].key, "askPhotos");
  assert.equal(questionsForSeller("new", true)[0].key, "askAuthenticity");
  assert.equal(questionsForSeller("unknown", true)[0].key, "askPhotos");
});
