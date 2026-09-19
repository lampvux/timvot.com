import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  RACKET_SELECT,
  RACKET_SELECT_NO_THUMBS,
  isMissingColumnError,
  mapBrand,
  mapGuide,
  mapOffer,
  mapPricePoint,
  mapRacket,
  mapRacketImage,
  mapReview,
  mapSeller,
  mapVariant,
  mergeEquivalentRacketGalleries,
} from "./mappers";
import type { Racket } from "@/lib/types";

/**
 * The one file that knows the database dialect.
 *
 * Postgres speaks snake_case and splits localised text into `_en`/`_vi` column
 * pairs; the domain objects speak camelCase and carry `{ en, vi }` together.
 * Two failures live here, and neither is loud:
 *
 *   - A column added to the schema and to a mapper but not to `RACKET_SELECT`
 *     arrives as `undefined` on every row, which reads as "the data is
 *     missing" rather than "the query did not ask for it".
 *   - A column named in `RACKET_SELECT` that the schema does not have makes
 *     PostgREST reject the *whole* query, and the repository answers any query
 *     error by falling back to the seeded catalogue — eighteen rackets instead
 *     of three thousand, with no error anywhere.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "mappers.ts"), "utf8");

/* ------------------------------------------------------------ round trips */

test("a brand row becomes a Brand", () => {
  assert.deepEqual(
    mapBrand({ id: "b1", slug: "yonex", name: "Yonex", country: "JP" }),
    { id: "b1", slug: "yonex", name: "Yonex", country: "JP" },
  );
});

test("a missing country is an empty string, never undefined", () => {
  // `undefined` renders as nothing but breaks `.includes()` and sorting.
  assert.equal(mapBrand({ id: "b1", slug: "x", name: "X" }).country, "");
});

test("a variant row is renamed, not reshaped", () => {
  assert.deepEqual(
    mapVariant({
      id: "v1",
      racket_id: "r1",
      weight_class: "4U",
      weight_grams: 83,
      grip_size: "G5",
      colourway: "black",
      sku: "SKU-1",
    }),
    {
      id: "v1",
      racketId: "r1",
      weightClass: "4U",
      weightGrams: 83,
      gripSize: "G5",
      colourway: "black",
      sku: "SKU-1",
    },
  );
});

test("localised columns fold into one object", () => {
  const racket = mapRacket({
    id: "r1",
    slug: "astrox-99",
    name: "Astrox 99",
    brand: { slug: "yonex", name: "Yonex" },
    summary_en: "Heavy head.",
    summary_vi: "Đầu nặng.",
    max_tension_min_lbs: 20,
    max_tension_max_lbs: 28,
  });

  assert.deepEqual(racket.summary, { en: "Heavy head.", vi: "Đầu nặng." });
});

test("a missing translation is an empty string on both sides", () => {
  const racket = mapRacket({ id: "r1", brand: { slug: "y", name: "Y" } });
  assert.deepEqual(racket.summary, { en: "", vi: "" });

  const guide = mapGuide({ slug: "g" });
  assert.deepEqual(guide.title, { en: "", vi: "" });
  assert.deepEqual(guide.excerpt, { en: "", vi: "" });
});

test("the tension pair becomes a tuple in the stored unit", () => {
  const racket = mapRacket({
    id: "r1",
    brand: { slug: "y", name: "Y" },
    max_tension_min_lbs: 20,
    max_tension_max_lbs: 28,
  });

  assert.deepEqual(racket.maxTensionLbs, [20, 28]);
});

test("PostgREST's embedded brand is accepted as an object or a one-element array", () => {
  // The shape depends on whether the relationship resolves to one row or many,
  // and it has changed between PostgREST versions.
  const asObject = mapRacket({ id: "r", brand: { slug: "yonex", name: "Yonex" } });
  const asArray = mapRacket({ id: "r", brand: [{ slug: "yonex", name: "Yonex" }] });

  assert.equal(asObject.brandSlug, "yonex");
  assert.equal(asArray.brandSlug, "yonex");
  assert.equal(asArray.brandName, "Yonex");
});

test("a racket with no brand join does not crash the page", () => {
  const racket = mapRacket({ id: "r" });
  assert.equal(racket.brandSlug, "");
  assert.equal(racket.brandName, "");
});

test("numeric columns arrive as numbers even when Postgres sends strings", () => {
  // numeric/decimal columns come back as strings over PostgREST. A price that
  // is a string sorts lexically: "900000" above "1000000".
  const offer = mapOffer({ id: "o", price: "3290000", status: "live" });
  assert.equal(offer.price, 3_290_000);
  assert.equal(typeof offer.price, "number");

  const point = mapPricePoint({ variant_id: "v", observed_on: "2026-01-01", price: "12000" });
  assert.equal(point.price, 12_000);

  const review = mapReview({ id: "r", power: "4", speed: "3", control: "5", comfort: "2" });
  assert.deepEqual(
    [review.power, review.speed, review.control, review.comfort],
    [4, 3, 5, 2],
  );

  const seller = mapSeller({ id: "s", rating: "4.7", dispute_rate: "0.02" });
  assert.equal(seller.rating, 4.7);
  assert.equal(seller.disputeRate, 0.02);
});

test("booleans arrive as booleans, not as the strings Postgres sends", () => {
  const offer = mapOffer({ id: "o", includes_stringing: "t", promoted: 0 });
  assert.equal(offer.includesStringing, true);
  assert.equal(offer.promoted, false);
});

test("array columns default to an empty array, never null", () => {
  const racket = mapRacket({ id: "r" });
  assert.deepEqual(racket.frameMaterial, []);
  assert.deepEqual(racket.playStyleTags, []);
  assert.deepEqual(racket.variants, []);
});

/* -------------------------------------------------------------- galleries */

test("images are ordered by position and the hero is the flagged one", () => {
  const racket = mapRacket({
    id: "r",
    brand: { slug: "y", name: "Y" },
    hero_image_url: "https://stale.example/old.jpg",
    images: [
      { id: "i2", position: 2, public_url: "b.jpg", checksum: "bbb" },
      { id: "i1", position: 1, public_url: "a.jpg", checksum: "aaa", is_hero: true },
      { id: "i3", position: 3, public_url: "c.jpg", checksum: "ccc" },
    ],
  });

  assert.deepEqual(racket.images?.map((image) => image.id), ["i1", "i2", "i3"]);
  assert.equal(racket.heroImageUrl, "a.jpg");
});

test("the joined gallery wins over the denormalised hero column", () => {
  // The gallery is the ownership record. The racket's own hero column makes
  // card reads cheap but can lag a recrawl, and letting a stale pointer win is
  // how a correctly-owned gallery still renders another model's photograph.
  const racket = mapRacket({
    id: "r",
    brand: { slug: "y", name: "Y" },
    hero_image_url: "https://stale.example/wrong-racket.jpg",
    hero_thumb_url: "https://stale.example/wrong-racket-thumb.jpg",
    images: [{ id: "i1", position: 1, public_url: "right.jpg", thumb_url: "right-t.jpg", checksum: "a" }],
  });

  assert.equal(racket.heroImageUrl, "right.jpg");
  assert.equal(racket.heroThumbUrl, "right-t.jpg");
});

test("with no gallery the denormalised column is used", () => {
  const racket = mapRacket({
    id: "r",
    brand: { slug: "y", name: "Y" },
    hero_image_url: "only.jpg",
    hero_thumb_url: "only-t.jpg",
    images: [],
  });

  assert.equal(racket.heroImageUrl, "only.jpg");
  assert.equal(racket.heroThumbUrl, "only-t.jpg");
});

test("an unflagged gallery falls back to the first image by position", () => {
  const racket = mapRacket({
    id: "r",
    brand: { slug: "y", name: "Y" },
    images: [
      { id: "i2", position: 5, public_url: "late.jpg", checksum: "b" },
      { id: "i1", position: 1, public_url: "first.jpg", checksum: "a" },
    ],
  });

  assert.equal(racket.heroImageUrl, "first.jpg");
});

test("a thumbnail-less image falls back to its full-size URL, not to null", () => {
  const image = mapRacketImage({ id: "i", public_url: "full.jpg" });
  assert.equal(image.publicUrl, "full.jpg");
  assert.equal(image.thumbUrl, null, "null is the signal to fall back, not a URL.");
});

/* ---------------------------------------------------- equivalent galleries */

const racketWith = (over: Partial<Racket>): Racket =>
  ({
    id: "r",
    slug: "nanoflare-700",
    brandSlug: "yonex",
    brandName: "Yonex",
    name: "Nanoflare 700",
    releaseYear: 2026,
    balancePointMm: 290,
    shaftFlex: "medium",
    shaftDiameterMm: 6.8,
    frameShape: "isometric",
    frameMaterial: [],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22x21",
    msrp: 1_000_000,
    currency: "VND",
    playStyleTags: [],
    skillLevel: "intermediate",
    variants: [],
    heroImageUrl: null,
    heroThumbUrl: null,
    images: [],
    summary: { en: "", vi: "" },
    ...over,
  }) as Racket;

const imageAt = (position: number, checksum: string) => ({
  id: `i-${checksum}`,
  racketId: "r",
  provider: "test",
  sourceUrl: "",
  sourcePageUrl: "",
  storageBucket: "racket-images",
  storagePath: `yonex/nanoflare-700/0${position}-${checksum}.jpg`,
  publicUrl: `${checksum}.jpg`,
  thumbUrl: null,
  position,
  isHero: false,
  contentType: null,
  bytes: null,
  width: null,
  height: null,
  checksum,
  colourway: null,
});

test("a brand-prefixed duplicate shares the canonical row's photography", () => {
  // The same frame exists under an editorial slug and a retailer-generated,
  // brand-prefixed one. Gallery crawls landed on the retailer row while the
  // detail page resolves the editorial one.
  const canonical = racketWith({ id: "r-a", slug: "nanoflare-700", images: [] });
  const prefixed = racketWith({
    id: "r-b",
    slug: "yonex-nanoflare-700",
    images: [imageAt(1, "aaa")],
  });

  const merged = mergeEquivalentRacketGalleries([canonical, prefixed]);

  assert.equal(merged[0].images?.length, 1, "the canonical row got no gallery.");
  assert.equal(merged[0].heroImageUrl, "aaa.jpg");
  assert.equal(merged[1].images?.length, 1);
});

test("merging is by brand and model, never across different frames", () => {
  const a = racketWith({ id: "r-a", slug: "nanoflare-700", images: [imageAt(1, "aaa")] });
  const b = racketWith({
    id: "r-b",
    slug: "nanoflare-800",
    name: "Nanoflare 800",
    images: [],
  });

  const merged = mergeEquivalentRacketGalleries([a, b]);

  assert.equal(
    merged[1].images?.length,
    0,
    "a different model was given another racket's photographs.",
  );
});

test("a duplicated image is kept once, by checksum", () => {
  // Byte-identical copies of one gallery exist under several folders; the hash
  // is what says they are the same photograph.
  const a = racketWith({ id: "r-a", slug: "nanoflare-700", images: [imageAt(1, "same")] });
  const b = racketWith({
    id: "r-b",
    slug: "yonex-nanoflare-700",
    images: [imageAt(1, "same"), imageAt(2, "other")],
  });

  const merged = mergeEquivalentRacketGalleries([a, b]);
  const checksums = merged[0].images?.map((image) => image.checksum);

  assert.deepEqual(checksums, ["same", "other"]);
});

test("exactly one image is the hero after a merge", () => {
  const a = racketWith({
    id: "r-a",
    slug: "nanoflare-700",
    images: [{ ...imageAt(1, "aaa"), isHero: true }],
  });
  const b = racketWith({
    id: "r-b",
    slug: "yonex-nanoflare-700",
    images: [{ ...imageAt(2, "bbb"), isHero: true }],
  });

  for (const racket of mergeEquivalentRacketGalleries([a, b])) {
    const heroes = (racket.images ?? []).filter((image) => image.isHero);
    assert.equal(heroes.length, 1, `${racket.id} has ${heroes.length} heroes.`);
  }
});

test("a racket with no equivalent is returned untouched", () => {
  const only = racketWith({ id: "r-a", images: [imageAt(1, "aaa")] });
  const [merged] = mergeEquivalentRacketGalleries([only]);
  assert.equal(merged, only, "a lone racket was reallocated rather than passed through.");
});

/* ------------------------------------------------- the select/mapper pair */

/** Column names a mapper reads off a row, e.g. `row.weight_class`. */
function columnsRead(functionName: string): string[] {
  const start = source.indexOf(`export function ${functionName}(`);
  assert.ok(start >= 0, `${functionName} is gone from mappers.ts.`);

  const next = source.indexOf("\nexport ", start + 1);
  const body = source.slice(start, next < 0 ? source.length : next);

  return [...new Set([...body.matchAll(/\browe?\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))];
}

test("RACKET_SELECT names every column mapRacket reads", () => {
  // The drift this file is designed to have: a column added to the schema and
  // to the mapper, but not to the select, arrives as undefined on every row.
  const missing = columnsRead("mapRacket").filter(
    (column) =>
      !RACKET_SELECT.includes(column) &&
      // Resolved from the joined gallery rather than selected by name.
      !["images", "brand", "variants"].includes(column),
  );

  assert.deepEqual(
    missing,
    [],
    `mapRacket reads ${missing.join(", ")}, which RACKET_SELECT does not ask ` +
      `for. Every row would carry undefined there, which reads as missing ` +
      `data rather than as a query that forgot a column.`,
  );
});

test("RACKET_SELECT names every column mapVariant and mapRacketImage read", () => {
  for (const [name, select] of [
    ["mapVariant", RACKET_SELECT],
    ["mapRacketImage", RACKET_SELECT],
  ] as const) {
    const missing = columnsRead(name).filter((column) => !select.includes(column));
    assert.deepEqual(missing, [], `${name} reads ${missing.join(", ")}.`);
  }
});

test("the two selects differ only by the thumbnail columns", () => {
  // The fallback exists for a deployment that is ahead of its database. It has
  // to stay a strict subset, or the degraded path degrades something else too.
  const normalise = (select: string) =>
    select.replace(/\s+/g, " ").trim();

  const full = normalise(RACKET_SELECT);
  const reduced = normalise(RACKET_SELECT_NO_THUMBS);

  assert.ok(full.includes("hero_thumb_url"));
  assert.ok(full.includes("thumb_url"));
  assert.ok(!reduced.includes("thumb_url"), "the fallback still asks for thumbnails.");

  const restored = reduced
    .replace("hero_image_url,", "hero_image_url, hero_thumb_url,")
    .replace(/\)\s*$/, "");

  for (const column of restored.split(/[,\s(]+/).filter(Boolean)) {
    assert.ok(
      full.includes(column),
      `the fallback select asks for ${column}, which the full one does not. ` +
        `It has to be a strict subset plus the thumbnails.`,
    );
  }
});

test("the missing-column detector matches what PostgREST actually says", () => {
  // This decides whether a failed query is retried without thumbnails or
  // silently becomes eighteen seeded rackets.
  assert.ok(isMissingColumnError('column rackets.hero_thumb_url does not exist'));
  assert.ok(isMissingColumnError("Could not find the 'thumb_url' column of 'racket_images'"));
  assert.ok(isMissingColumnError("COLUMN X DOES NOT EXIST"));

  assert.ok(!isMissingColumnError("JWT expired"));
  assert.ok(!isMissingColumnError("relation \"rackets\" does not exist"));
  assert.ok(!isMissingColumnError("permission denied for table rackets"));
});
