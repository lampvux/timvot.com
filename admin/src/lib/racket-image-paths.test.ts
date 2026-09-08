import assert from "node:assert/strict";
import test from "node:test";
import {
  racketImageFolder,
  racketImageUploadPath,
  relocatedRacketImagePath,
  storagePathMatchesRacket,
  thumbnailPathFor,
} from "./racket-image-paths";

const target = {
  brandSlug: "yonex",
  racketSlug: "yonex-astrox-88d-pro",
};

test("uses one brand segment for brand-prefixed racket slugs", () => {
  assert.equal(racketImageFolder(target), "yonex/astrox-88d-pro");
});

test("builds uploaded image and thumbnail paths in the enforced racket folder", () => {
  const path = racketImageUploadPath({
    target,
    position: 2,
    checksum: "1234567890abcdef",
    contentType: "image/png",
    nonce: "upload-1",
  });

  assert.equal(path, "yonex/astrox-88d-pro/02-12345678-upload-1.png");
  assert.equal(thumbnailPathFor(path), "yonex/astrox-88d-pro/02-12345678-upload-1-thumb.webp");
  assert.equal(storagePathMatchesRacket(path, target), true);
});

test("repairs a misplaced object path while keeping a recognizable filename", () => {
  assert.equal(
    relocatedRacketImagePath(
      "admin/r-wrong/00-abcd original.webp",
      target,
      "fallback.webp",
    ),
    "yonex/astrox-88d-pro/00-abcd-original.webp",
  );
});
