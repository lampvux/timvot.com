-- Repair gallery ownership for the small set of rackets that exist under both
-- the original model-only seed id and the retailer crawler's brand-prefixed id.
--
-- The public route already carries the brand. As a result,
-- `yonex/nanoflare-800-pro` resolves the seeded row while the image crawler had
-- written the gallery to `yonex/yonex-nanoflare-800-pro`. Move galleries to the
-- model-only record when that record has no gallery of its own. The image id is
-- deliberately left unchanged; it is opaque, while `racket_id` is ownership.

with duplicate_rackets as (
  select
    prefixed.id as source_id,
    canonical.id as target_id
  from rackets prefixed
  join brands brand on brand.id = prefixed.brand_id
  join rackets canonical
    on canonical.brand_id = prefixed.brand_id
   and prefixed.slug = brand.slug || '-' || canonical.slug
  where not exists (
    select 1 from racket_images existing where existing.racket_id = canonical.id
  )
)
update racket_images image
set racket_id = duplicate.target_id
from duplicate_rackets duplicate
where image.racket_id = duplicate.source_id;

-- `scrape:images` persisted the thumbnail URL but, before this repair, omitted
-- the object key. Every successful thumbnail has the same deterministic key as
-- its original with `-thumb.webp` replacing the extension.
update racket_images
set thumb_path = regexp_replace(storage_path, '\.[^./]+$', '-thumb.webp')
where thumb_path is null and thumb_url is not null;

-- Keep the card's denormalised pointers aligned with the repaired gallery.
with ranked_heroes as (
  select
    racket_id,
    public_url,
    thumb_url,
    row_number() over (
      partition by racket_id
      order by is_hero desc, position, id
    ) as rank
  from racket_images
)
update rackets racket
set
  hero_image_url = hero.public_url,
  hero_thumb_url = hero.thumb_url
from ranked_heroes hero
where hero.racket_id = racket.id and hero.rank = 1;
