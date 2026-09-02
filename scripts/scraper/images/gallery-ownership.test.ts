import assert from "node:assert/strict";
import test from "node:test";
import { mergeEquivalentRacketGalleries } from "../../../src/lib/data/mappers";
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
