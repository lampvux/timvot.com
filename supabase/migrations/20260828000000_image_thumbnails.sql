-- Catalogue thumbnails, so the grid stops going through a metered optimizer.
--
-- The card renders a ~400px box; the stored originals are manufacturer
-- photography, routinely 1500–2500px. Serving those through `next/image` meant
-- one billed transformation per distinct (src, width, quality), and Vercel
-- Hobby allows 5.000 a month against 3.010 hero images — past the allowance
-- the optimizer answers 402 and the card renders its alt text. That is a
-- visible product failure, not a slow page.
--
-- The image crawler already downloads every file, so the resize happens once,
-- there, and the app serves the result directly. These columns are where it
-- records what it wrote.
--
-- Nullable on purpose, and read as `thumb ?? original`: a racket crawled before
-- this migration keeps working, and a re-crawl fills it in. There is no
-- backfill step to forget.

alter table racket_images
  -- Object key of the resized copy, in the same bucket as `storage_path`.
  add column if not exists thumb_path text,
  -- Public URL of that object. Denormalised the same way `public_url` is, so
  -- reading a card costs no extra round trip.
  add column if not exists thumb_url  text;

alter table rackets
  -- The hero's thumbnail, mirroring `hero_image_url`. The card reads this one
  -- column rather than joining to racket_images and filtering for the hero.
  add column if not exists hero_thumb_url text;

comment on column racket_images.thumb_url is
  'Public URL of the ~400px webp derived from this image. Served unoptimized by the catalogue grid; null means fall back to public_url.';

comment on column rackets.hero_thumb_url is
  'Public URL of the hero image''s thumbnail. Null means fall back to hero_image_url.';
