import assert from "node:assert/strict";
import test from "node:test";
import {
  mapRacket,
  mergeEquivalentRacketGalleries,
} from "../../../src/lib/data/mappers";
import type { Racket, RacketImage } from "../../../src/lib/types";

function racket(id: string, slug: string, images: RacketImage[] = []): Racket {
  return {
    id,
    slug,
    brandSlug: "yonex",
    brandName: "Yonex",
    name: "Nanoflare 800 Pro",
    releaseYear: 2023,
    balancePointMm: 288,
    shaftFlex: "stiff",
    shaftDiameterMm: 6.6,
    frameShape: "aero-box",
    frameMaterial: ["Graphite"],
    maxTensionLbs: [20, 28],
    lengthMm: 675,
    stringPattern: "22×21",
    msrp: 2_590_000,
    currency: "VND",
    playStyleTags: ["speed"],
    skillLevel: "advanced",
    variants: [],
    heroImageUrl: null,
    heroThumbUrl: null,
    images,
    summary: { en: "", vi: "" },
  };
}

const image: RacketImage = {
  id: "img-1",
  racketId: "r-yonex-nanoflare-800-pro",
  provider: "yonex-uk",
  sourceUrl: "https://manufacturer.test/nanoflare.webp",
  sourcePageUrl: "https://manufacturer.test/nanoflare-800-pro",
  storageBucket: "racket-images",
  storagePath: "yonex/nanoflare-800-pro/00-abc.webp",
  publicUrl: "https://storage.test/00-abc.webp",
  thumbUrl: "https://storage.test/00-abc-thumb.webp",
  position: 0,
  isHero: true,
  contentType: "image/webp",
  bytes: 100,
  width: 800,
  height: 800,
  checksum: "abc",
  colourway: null,
};

test("shares a prefixed record gallery with its model-only detail page", () => {
  const merged = mergeEquivalentRacketGalleries([
    racket("r-nanoflare-800-pro", "nanoflare-800-pro"),
    racket("r-yonex-nanoflare-800-pro", "yonex-nanoflare-800-pro", [image]),
  ]);

  assert.equal(merged[0].images?.length, 1);
  assert.equal(merged[0].heroImageUrl, image.publicUrl);
  assert.equal(merged[0].heroThumbUrl, image.thumbUrl);
  assert.equal(merged[1].images?.length, 1);
});

test("does not share galleries between different model identities", () => {
  const merged = mergeEquivalentRacketGalleries([
    racket("r-nanoflare-800-pro", "nanoflare-800-pro"),
    racket("r-yonex-nanoflare-700", "yonex-nanoflare-700", [image]),
  ]);

  assert.deepEqual(merged[0].images, []);
});

test("a joined gallery hero overrides a stale denormalised racket pointer", () => {
  const mapped = mapRacket({
    id: "r-nanoflare-800-pro",
    slug: "nanoflare-800-pro",
    name: "Nanoflare 800 Pro",
    release_year: 2023,
    balance_point_mm: 288,
    shaft_flex: "stiff",
    shaft_diameter_mm: 6.6,
    frame_shape: "aero-box",
    frame_material: ["Graphite"],
    max_tension_min_lbs: 20,
    max_tension_max_lbs: 28,
    length_mm: 675,
    string_pattern: "22×21",
    msrp: 2_590_000,
    play_style_tags: ["speed"],
    skill_level: "advanced",
    hero_image_url: "https://storage.test/wrong-racket.webp",
    hero_thumb_url: "https://storage.test/wrong-racket-thumb.webp",
    summary_en: "",
    summary_vi: "",
    brand: { slug: "yonex", name: "Yonex" },
    variants: [],
    images: [
      {
        id: image.id,
        racket_id: image.racketId,
        provider: image.provider,
        source_url: image.sourceUrl,
        source_page_url: image.sourcePageUrl,
        storage_bucket: image.storageBucket,
        storage_path: image.storagePath,
        public_url: image.publicUrl,
        thumb_url: image.thumbUrl,
        position: image.position,
        is_hero: image.isHero,
        content_type: image.contentType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        checksum: image.checksum,
        colourway: image.colourway,
      },
    ],
  });

  assert.equal(mapped.heroImageUrl, image.publicUrl);
  assert.equal(mapped.heroThumbUrl, image.thumbUrl);
});
