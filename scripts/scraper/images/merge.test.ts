import assert from "node:assert/strict";
import test from "node:test";
import { planGalleryMerge, type ExistingGalleryMergeRow, type GalleryMergeRow } from "./merge";

function row(overrides: Partial<ExistingGalleryMergeRow> = {}): ExistingGalleryMergeRow {
  return {
    id: "existing",
    racket_id: "r-one",
    provider: "yonex",
    checksum: "old",
    public_url: "https://storage/old.jpg",
    thumb_url: "https://storage/old-thumb.webp",
    storage_bucket: "racket-images",
    storage_path: "yonex/one/old.jpg",
    thumb_path: "yonex/one/old-thumb.webp",
    position: 0,
    is_hero: false,
    admin_managed: false,
    ...overrides,
  };
}

function incoming(overrides: Partial<GalleryMergeRow> = {}): GalleryMergeRow {
  return {
    id: "incoming",
    racket_id: "r-one",
    provider: "yonex",
    checksum: "new",
    public_url: "https://storage/new.jpg",
    thumb_url: "https://storage/new-thumb.webp",
    storage_bucket: "racket-images",
    storage_path: "yonex/one/new.jpg",
    thumb_path: "yonex/one/new-thumb.webp",
    position: 0,
    is_hero: true,
    ...overrides,
  };
}

test("crawler refresh preserves admin uploads and their hero mapping", () => {
  const adminHero = row({
    id: "admin-hero",
    provider: "admin",
    checksum: "manual",
    is_hero: true,
    admin_managed: true,
  });
  const oldCrawlerImage = row({ id: "old-crawl", checksum: "superseded" });
  const next = incoming();

  const plan = planGalleryMerge([adminHero, oldCrawlerImage], [next]);

  assert.deepEqual(plan.stale.map((image) => image.id), ["old-crawl"]);
  assert.deepEqual(plan.protectedRows.map((image) => image.id), ["admin-hero"]);
  assert.equal(plan.hero?.id, "admin-hero");
  assert.equal(plan.incomingToWrite[0].is_hero, false);
});

test("crawler refresh preserves a manually edited crawler record", () => {
  const curated = row({
    id: "curated",
    checksum: "same",
    position: 7,
    admin_managed: true,
  });
  const replacement = incoming({ checksum: "same", position: 0 });

  const plan = planGalleryMerge([curated], [replacement]);

  assert.deepEqual(plan.stale, []);
  assert.deepEqual(plan.incomingToWrite, []);
  assert.deepEqual(plan.discardedIncoming.map((image) => image.id), ["incoming"]);
  assert.equal(plan.protectedRows[0].position, 7);
});

test("crawler refresh retains a valid selected crawler hero", () => {
  const selected = row({ id: "selected", checksum: "keep", position: 4, is_hero: true });
  const refreshedSelected = incoming({ id: "refreshed", checksum: "keep", position: 1 });
  const crawlerDefault = incoming({ id: "default", checksum: "first", position: 0 });

  const plan = planGalleryMerge([selected], [crawlerDefault, refreshedSelected]);

  assert.equal(plan.hero?.id, "refreshed");
  assert.equal(plan.incomingToWrite.every((image) => !image.is_hero), true);
});
