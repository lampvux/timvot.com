import assert from "node:assert/strict";
import test from "node:test";
import {
  STRING_IMAGE_BUCKET,
  stringImageFolder,
  stringImageSource,
  stringImageUploadPath,
} from "./string-image-paths";
import { thumbnailPathFor } from "./racket-image-paths";

const target = { brandSlug: "yonex", stringSlug: "bg80-power" };

test("string images live in their own bucket", () => {
  assert.equal(STRING_IMAGE_BUCKET, "string-images");
  assert.notEqual(STRING_IMAGE_BUCKET, "racket-images");
});

test("a packshot is filed under brand and string slug", () => {
  assert.equal(stringImageFolder(target), "yonex/bg80-power");
  const path = stringImageUploadPath({
    target,
    checksum: "0123456789abcdef",
    contentType: "image/png",
    nonce: "a1b2c3d4",
  });
  assert.equal(path, "yonex/bg80-power/01234567-a1b2c3d4.png");
  assert.equal(thumbnailPathFor(path), "yonex/bg80-power/01234567-a1b2c3d4-thumb.webp");
});

test("the same bytes uploaded twice get two keys, so a replacement never overwrites", () => {
  const args = { target, checksum: "0123456789abcdef", contentType: "image/jpeg" };
  assert.notEqual(
    stringImageUploadPath({ ...args, nonce: "aaaaaaaa" }),
    stringImageUploadPath({ ...args, nonce: "bbbbbbbb" }),
  );
});

test("an upload without a source page is recorded as an admin upload", () => {
  assert.equal(stringImageSource("", "up-1"), "admin-upload:up-1");
  assert.equal(stringImageSource("admin-upload", "up-1"), "admin-upload:up-1");
  assert.equal(
    stringImageSource(" https://www.yonex.com/bg80p ", "up-1"),
    "https://www.yonex.com/bg80p",
  );
});
