import { strict as assert } from "node:assert";
import { test } from "node:test";

import { canonicalName, groupDuplicates, rank } from "./duplicate-rackets";

type Racket = Parameters<typeof rank>[0][number];
type Counts = Parameters<typeof rank>[1];

const racket = (id: string, name: string, slug = id.replace(/^r-/, "")): Racket => ({
  id,
  slug,
  name,
  brandId: "b-victor",
  brandSlug: "victor",
  brandName: "Victor",
  heroImageUrl: null,
  heroThumbUrl: null,
});

const counts = (
  images: Record<string, number> = {},
  offers: Record<string, number> = {},
  reviews: Record<string, number> = {},
): Counts => ({
  images: new Map(Object.entries(images)),
  offers: new Map(Object.entries(offers)),
  reviews: new Map(Object.entries(reviews)),
});

test("the series code and the marketing name reduce to one key", () => {
  assert.equal(canonicalName("ARS 9"), canonicalName("Auraspeed 9"));
  assert.equal(canonicalName("TK-F"), canonicalName("Thruster F"));
  assert.equal(canonicalName("TK-Ryuga Metallic"), canonicalName("Thruster Ryuga Metallic"));
  assert.equal(canonicalName("DX 09"), canonicalName("DriveX 09"));
  assert.equal(canonicalName("JS-2SP"), canonicalName("Jetspeed S 2SP"));
  assert.equal(canonicalName("brs 1800 d"), canonicalName("Brave Sword 1800D"));
  assert.equal(canonicalName("Thruster K100"), canonicalName("Thruster K 100"));
  assert.equal(canonicalName("ARC 001 Pro"), canonicalName("Arcsaber 001 Pro"));
});

test("a suffix is a product, not noise", () => {
  // Every one of these pairs is two different frames.
  const distinct: [string, string][] = [
    ["Astrox 22", "Astrox 22 RX"],
    ["Astrox 7", "Astrox 7 DG"],
    ["Thruster Ryuga II", "Thruster Ryuga II TD"],
    ["Auraspeed 90k II", "Auraspeed 90k II TD"],
    ["Auraspeed 99", "Auraspeed 99 J"],
    ["Columbia", "Columbia VI"],
    ["DriveX 5H", "DriveX 5H D"],
  ];
  for (const [a, b] of distinct) {
    assert.notEqual(canonicalName(a), canonicalName(b), `${a} vs ${b}`);
  }
});

test("only separators are dropped; a symbol that names a model is kept", () => {
  assert.notEqual(canonicalName("Windstorm 78"), canonicalName("Windstorm 78+"));
  assert.notEqual(canonicalName("Ryuga TDC"), canonicalName("Ryuga TD/C"));
  // A Vietnamese colourway written into the name is a difference, not an
  // accent to normalise away.
  assert.notEqual(
    canonicalName("Axforce 90 Tiger Max"),
    canonicalName("Axforce 90 Đỏ Tiger Max"),
  );
});

test("the series alias is anchored to the start of the name", () => {
  // `DX` here is part of the model, not the DriveX series.
  assert.equal(canonicalName("Nanoray 70 DX"), "NANORAY70DX");
  assert.equal(canonicalName("Arcsaber 009 DX"), "ARCSABER009DX");
});

test("the row holding the gallery survives, because its path is pinned to its slug", () => {
  // `validate_racket_image_ownership` checks storage_path against the owner's
  // brand/model slug, so the gallery cannot move the other way.
  const ordered = rank(
    [racket("r-victor-ars-9", "ARS 9"), racket("r-victor-auraspeed-9", "Auraspeed 9")],
    counts({ "r-victor-auraspeed-9": 10 }, { "r-victor-ars-9": 99 }),
  );
  assert.equal(ordered[0].id, "r-victor-auraspeed-9");
});

test("with no gallery either way, reviews then the canonical route decide", () => {
  const seeded = racket("r-astrox-88s-pro", "Astrox 88S Pro", "astrox-88s-pro");
  const crawled = racket("r-yonex-astrox-88s-pro", "Astrox 88S Pro", "yonex-astrox-88s-pro");
  crawled.brandSlug = seeded.brandSlug = "yonex";

  assert.equal(
    rank([crawled, seeded], counts({}, { "r-yonex-astrox-88s-pro": 6 }, { "r-astrox-88s-pro": 7 }))[0]
      .id,
    "r-astrox-88s-pro",
  );
  // No reviews either: the model-only slug is the canonical public route.
  assert.equal(
    rank([crawled, seeded], counts({}, { "r-yonex-astrox-88s-pro": 6 }))[0].id,
    "r-astrox-88s-pro",
  );
});

test("two galleries in one group block the merge rather than losing one", () => {
  const groups = groupDuplicates(
    [racket("r-vs-po-fang", "Po Fang"), racket("r-vs-pofang", "Pofang")],
    counts({ "r-vs-po-fang": 9, "r-vs-pofang": 6 }),
  );

  assert.equal(groups.length, 1);
  assert.match(groups[0].blocked ?? "", /both rows have a gallery/);
  assert.equal(groups[0].survivor.id, "r-vs-po-fang");
});

test("a row with no twin is not a group", () => {
  assert.deepEqual(
    groupDuplicates([racket("r-victor-ars-9", "ARS 9"), racket("r-victor-tk-f", "TK-F")], counts()),
    [],
  );
});

test("three spellings of one racket collapse into one group", () => {
  const groups = groupDuplicates(
    [
      racket("r-victor-brave-sword-12", "Brave Sword 12"),
      racket("r-brave-sword-12", "Brave Sword 12", "brave-sword-12"),
      racket("r-victor-bs-12", "BS-12"),
    ],
    counts({}, {}, { "r-brave-sword-12": 2 }),
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].survivor.id, "r-brave-sword-12");
  assert.deepEqual(groups[0].losers.map((loser) => loser.id).sort(), [
    "r-victor-brave-sword-12",
    "r-victor-bs-12",
  ]);
});

test("a brand written into the model name is not a different racket", () => {
  // proace.vn titles one page `ProaceTGR F` and another `TGR-F`; the brand is
  // already in `brand_id`, so repeating it in the name says nothing about the frame.
  assert.equal(canonicalName("ProaceTGR F", "Proace"), canonicalName("TGR-F", "Proace"));
  assert.equal(canonicalName("Yonex Nanoflare 700", "Yonex"), canonicalName("Nanoflare 700", "Yonex"));
  // The strip runs before the series alias, which is anchored to the start of
  // the name and would otherwise be hidden behind the brand.
  assert.equal(canonicalName("Yonex AX 100 ZZ", "Yonex"), canonicalName("Astrox 100 ZZ", "Yonex"));
  // However the brand is punctuated.
  assert.equal(canonicalName("Li-Ning Axforce 90", "Li-Ning"), canonicalName("Axforce 90", "Li-Ning"));
  assert.equal(canonicalName("LiNing Axforce 90", "Li-Ning"), canonicalName("Axforce 90", "Li-Ning"));
});

test("the brand strip refuses the cases where it would destroy a name", () => {
  // Under three characters: `VS` is also how a model is written.
  assert.equal(canonicalName("VS 100", "VS"), "VS100");
  // Nothing would remain: a row named after nothing but its brand keeps its
  // name rather than reducing to "" and matching every other such row.
  assert.equal(canonicalName("Proace", "Proace"), "PROACE");
  assert.notEqual(canonicalName("Proace", "Proace"), canonicalName("Kamito", "Kamito"));
  // Only a prefix, never the middle of a name.
  assert.equal(canonicalName("Super Proace 9", "Proace"), "SUPERPROACE9");
  // And it is only ever applied within one brand, so it cannot merge across them.
  assert.notEqual(canonicalName("Yonex 100", "Yonex"), canonicalName("Yonex 100", "Victor"));
});

test("the brand strip leaves a suffix alone, like every other rule here", () => {
  assert.notEqual(
    canonicalName("Yonex Astrox 22", "Yonex"),
    canonicalName("Astrox 22 RX", "Yonex"),
  );
});

test("the row whose name does not repeat the brand is the one kept", () => {
  const noisy = { ...racket("r-proace-proacetgr-f", "ProaceTGR F"), brandName: "Proace" };
  const clean = { ...racket("r-proace-tgr-f", "TGR-F"), brandName: "Proace" };
  assert.equal(rank([noisy, clean], counts())[0].id, "r-proace-tgr-f");
});
