---
name: catalogue-dedupe
description: Find and merge catalogue rows that are one racket written twice — `nanoflare-700` beside `yonex-nanoflare-700`, `ARS 9` beside `Auraspeed 9`, `ProaceTGR F` beside `TGR-F`. Use when a racket appears twice in the catalogue, when a product page shows an empty gallery or the wrong seller count, when `images:reconcile` reports a folder whose bytes another row owns, or when asked to deduplicate, merge or clean up duplicate rackets.
argument-hint: "[slug or brand] [--apply]"
---

# Deduplicating the racket catalogue

`scripts/duplicate-rackets.ts` (`npm run catalogue:dupes`) is the only thing that
merges catalogue rows. It reports by default and writes nothing without `--apply`.

**Never merge rows by hand-written SQL or by a one-off script.** A racket has
variants, offers, reviews, price history and a gallery hanging off it, and the
image ownership trigger rejects a gallery moved to a row whose slug the objects
are not filed under. The script is where the order of those moves is worked out.

## The run order

```bash
npm run backup                              # 1. always, before any --apply
npm run catalogue:dupes                     # 2. read the whole report
npm run catalogue:dupes -- --slug=<slug>    # 3. narrow to one frame to review it
npm run catalogue:dupes -- --slug=<slug> --apply
npm run market:refresh                      # 4. Court Score for the merged rows
npm run images:audit                        # 5. galleries still resolve
```

Steps 4 and 5 are part of the job, not optional follow-up: `racket_scores` still
holds a row for a racket that no longer exists, and the survivor's offer count
has changed, so the catalogue listing reads stale numbers from `racket_market`
until the refresh runs.

`--apply` needs `SUPABASE_SERVICE_ROLE_KEY`; the report runs on the publishable
key. Both are read from `.env` by `scripts/scraper/env.ts`.

## Flags

| Flag | What it does |
| --- | --- |
| *(none)* | Report only. Nothing is written. |
| `--apply` | Perform the merges. Requires the service-role key. |
| `--brand=victor` | Consider one brand. Filters rows before grouping. |
| `--slug=a,b` | Select the group(s) holding these slugs or ids. Filters *groups* after grouping, so naming either spelling brings its twin. |

## Reviewing a group before applying it

Work in `--slug=` batches rather than merging the whole report in one go. For
each group the report prints the survivor and what is being merged away:

```
yonex/NANOFLARE700
  keep   Nanoflare 700 (r-nanoflare-700) — 0 images, 8 offers, 7 reviews
  merge  Nanoflare 700 (r-yonex-nanoflare-700) — 0 images, 6 offers, 0 reviews
```

Check two things, and only these two:

1. **Are they actually the same frame?** A trailing token is a product, not
   noise — `Astrox 22` and `Astrox 22 RX` are different rackets, and so are
   `Windstorm 78` and `Windstorm 78+`. If a group pairs two real products, the
   matcher has a bug: fix `canonicalName` and add the pair to
   `scripts/duplicate-rackets.test.ts`. Do not merge it and do not special-case it.
2. **Is the survivor the right row?** Ranking is gallery, then reviews, then the
   model-only slug, then offers, then the expanded name, then id. The gallery
   leads because `validate_racket_image_ownership` pins each object's path to its
   owner's slug, so a gallery can only move to the row it is already filed under.

A group marked `⚠ skipped: both rows have a gallery` is left alone on purpose.
Which photographs are the right ones is a judgement about the images, not
something offer counts settle. Resolve it by deciding which row to keep and
removing the other's `racket_images` rows first, then re-run.

## When the report is empty but a page still looks wrong

The matcher requires equality after the brand is stripped, the series code
expanded and separators dropped. It refuses rather than guesses, so a genuine
duplicate spelled differently enough will not appear. Extend the rules rather
than merging around them:

- Two spellings of one series → add to `SERIES_ALIASES`.
- A shop writing the brand into the name → already handled by `stripBrandPrefix`;
  check the brand is at least three characters and that something remains after it.
- Anything else → add a failing test first. Every rule in that file exists
  because a looser version of it offered to merge two real rackets.

## Related

- `npm run images:reconcile` — bucket → catalogue; its report of folders whose
  bytes another row owns is what surfaces duplicates in the first place.
- `npm run catalogue:dupes` covers the catalogue only. It does not touch strings,
  sellers or offers beyond repointing them.
