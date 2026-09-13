import { strict as assert } from "node:assert";
import { test } from "node:test";

import { folderFor, hashOf, isThumbnail, reconcile, type GalleryRow, type RacketRef } from "./reconcile";

const victor = (id: string, slug: string, name: string): RacketRef => ({
  id,
  slug,
  name,
  brandSlug: "victor",
});

function row(overrides: Partial<GalleryRow> & Pick<GalleryRow, "racketId" | "storagePath">): GalleryRow {
  return {
    bucket: "racket-images",
    thumbPath: overrides.storagePath.replace(/\.[^./]+$/, "-thumb.webp"),
    sourceUrl: "https://cdn.example.com/a.jpg",
    sourcePageUrl: "https://www.victorsport.com/product/a",
    provider: "victor",
    colourway: null,
    ...overrides,
  };
}

const object = (path: string) => ({ bucket: "racket-images", path });

test("a folder is the brand slug plus the racket slug without its brand prefix", () => {
  assert.equal(folderFor(victor("r-1", "victor-thruster-f", "Thruster F")), "victor/thruster-f");
  assert.equal(folderFor(victor("r-2", "thruster-f", "Thruster F")), "victor/thruster-f");
});

test("the content hash is read from the key, for originals and thumbnails alike", () => {
  assert.equal(hashOf("victor/tk-f/00-e67ffedb.webp"), "e67ffedb");
  assert.equal(hashOf("victor/tk-f/00-e67ffedb-thumb.webp"), "e67ffedb");
  assert.equal(hashOf("victor/tk-f/logo.png"), null);
  assert.equal(isThumbnail("victor/tk-f/00-e67ffedb-thumb.webp"), true);
  assert.equal(isThumbnail("victor/tk-f/00-e67ffedb.webp"), false);
});

test("bytes another racket's gallery owns are that racket's, whatever folder they sit in", () => {
  // The shape the September ownership repair left behind: the losing racket's
  // folder still holds a byte-identical copy of the winner's gallery.
  const findings = reconcile({
    rackets: [
      victor("r-victor-tk-f", "victor-tk-f", "TK-F"),
      victor("r-victor-thruster-f", "victor-thruster-f", "Thruster F"),
    ],
    rows: [row({ racketId: "r-victor-thruster-f", storagePath: "victor/thruster-f/00-aabbccdd.webp" })],
    objects: [object("victor/tk-f/00-aabbccdd.webp"), object("victor/tk-f/00-aabbccdd-thumb.webp")],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "owned-elsewhere");
  assert.equal(findings[0].owner?.id, "r-victor-thruster-f");
  // Named so the two records can be compared, but never linked.
  assert.equal(findings[0].target?.id, "r-victor-tk-f");
});

test("a gallery nobody owns, for a racket that has none, is the one linkable case", () => {
  const findings = reconcile({
    rackets: [victor("r-victor-tk-f", "victor-tk-f", "TK-F")],
    rows: [],
    objects: [
      object("victor/tk-f/00-aabbccdd.webp"),
      object("victor/tk-f/00-aabbccdd-thumb.webp"),
      object("victor/tk-f/01-11223344.webp"),
    ],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "linkable");
  assert.equal(findings[0].target?.id, "r-victor-tk-f");
  assert.deepEqual(findings[0].objects, [
    "victor/tk-f/00-aabbccdd.webp",
    "victor/tk-f/01-11223344.webp",
  ]);
});

test("nothing is reported when every object is already accounted for", () => {
  const findings = reconcile({
    rackets: [victor("r-victor-tk-f", "victor-tk-f", "TK-F")],
    rows: [row({ racketId: "r-victor-tk-f", storagePath: "victor/tk-f/00-aabbccdd.webp" })],
    objects: [
      object("victor/tk-f/00-aabbccdd.webp"),
      object("victor/tk-f/00-aabbccdd-thumb.webp"),
    ],
  });

  assert.deepEqual(findings, []);
});

test("a folder two gallery-less rackets answer to is ambiguous, not a coin toss", () => {
  const findings = reconcile({
    rackets: [
      victor("r-thruster-ryuga-ii", "thruster-ryuga-ii", "Thruster Ryuga II"),
      victor("r-victor-thruster-ryuga-ii", "victor-thruster-ryuga-ii", "Thruster Ryuga II"),
    ],
    rows: [],
    objects: [object("victor/thruster-ryuga-ii/00-aabbccdd.webp")],
  });

  assert.equal(findings[0].verdict, "ambiguous");
  assert.deepEqual(findings[0].candidates?.map((racket) => racket.id).sort(), [
    "r-thruster-ryuga-ii",
    "r-victor-thruster-ryuga-ii",
  ]);
});

test("residue beside a gallery that has moved on is superseded, and no racket is left out", () => {
  const findings = reconcile({
    rackets: [victor("r-victor-tk-f", "victor-tk-f", "TK-F")],
    rows: [row({ racketId: "r-victor-tk-f", storagePath: "victor/tk-f/00-99887766.webp" })],
    objects: [
      object("victor/tk-f/00-99887766.webp"),
      object("victor/tk-f/00-aabbccdd.webp"), // an older crawl's copy
      object("victor/unknown-model/00-deadbeef.webp"),
    ],
  });

  const byFolder = new Map(findings.map((finding) => [finding.folder, finding]));
  assert.equal(byFolder.get("victor/tk-f")?.verdict, "superseded");
  assert.equal(byFolder.get("victor/unknown-model")?.verdict, "unclaimed");
});

test("a stray beside one racket's gallery is not handed to the duplicate row beside it", () => {
  // `astrox-88s-pro` and `yonex-astrox-88s-pro` are two rows for one frame and
  // answer to the same folder. A photograph the first one's crawl left behind
  // is the first one's, not a gallery for the second.
  const canonical: RacketRef = {
    id: "r-astrox-88s-pro",
    slug: "astrox-88s-pro",
    name: "Astrox 88S Pro",
    brandSlug: "yonex",
  };
  const duplicate: RacketRef = {
    id: "r-yonex-astrox-88s-pro",
    slug: "yonex-astrox-88s-pro",
    name: "Astrox 88S Pro",
    brandSlug: "yonex",
  };

  const findings = reconcile({
    rackets: [canonical, duplicate],
    rows: [row({ racketId: canonical.id, storagePath: "yonex/astrox-88s-pro/00-99887766.webp" })],
    objects: [
      object("yonex/astrox-88s-pro/00-99887766.webp"),
      object("yonex/astrox-88s-pro/06-aabbccdd.webp"),
    ],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].verdict, "superseded");
  assert.equal(findings[0].owner?.id, canonical.id);
  // Still named, because the empty page is the thing worth looking at.
  assert.equal(findings[0].target?.id, duplicate.id);
});

test("thumbnails never produce a finding of their own", () => {
  const findings = reconcile({
    rackets: [victor("r-victor-tk-f", "victor-tk-f", "TK-F")],
    rows: [
      row({
        racketId: "r-victor-tk-f",
        storagePath: "victor/tk-f/00-aabbccdd.webp",
        thumbPath: null, // the thumbnail exists but was never recorded
      }),
    ],
    objects: [
      object("victor/tk-f/00-aabbccdd.webp"),
      object("victor/tk-f/00-aabbccdd-thumb.webp"),
    ],
  });

  assert.deepEqual(findings, []);
});
