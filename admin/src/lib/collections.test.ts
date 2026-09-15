import assert from "node:assert/strict";
import test from "node:test";
import { collections } from "./collections";

test("racket media is managed through image records instead of editable URL fields", () => {
  const fieldNames = collections.rackets.fields.map((field) => field.name);

  assert.equal(fieldNames.includes("hero_image_url"), false);
  assert.equal(fieldNames.includes("hero_thumb_url"), false);
  assert.ok(collections["racket-images"]);
});
