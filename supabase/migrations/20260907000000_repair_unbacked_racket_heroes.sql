-- A failed gallery ownership repair can leave the denormalised card pointer
-- behind after its racket_images row is removed. Retailer-hosted hero images
-- legitimately have no gallery row; only URLs inside our racket-image Storage
-- buckets are required to be backed by one.
--
-- Compare by public URL instead of racket_id because a handful of equivalent
-- editorial/retailer catalogue rows deliberately share one stored gallery.
-- Their hero is still backed and must remain available on both rows.

update rackets racket
set
  hero_image_url = null,
  hero_thumb_url = null
where racket.hero_image_url ~ '/storage/v1/object/public/racket-images[^/]*/'
  and not exists (
    select 1
    from racket_images image
    where image.public_url = racket.hero_image_url
  );
