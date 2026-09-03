-- Repair product pages that were independently matched to both a generic
-- racket and a more specific variant. The manufacturer title is authoritative:
-- for example, ASTROX 22 RX belongs to `astrox-22-rx`, not `astrox-22`.
--
-- This migration removes only the losing database references. Storage objects
-- are deliberately retained so the repair is reversible from a DB snapshot.

create temporary table corrected_racket_image_owners (
  source_page_url text primary key,
  racket_id text not null
) on commit drop;

insert into corrected_racket_image_owners (source_page_url, racket_id)
values
  ('https://www.victorsport.com/product/ars-100x-td', 'r-victor-auraspeed-100x-td'),
  ('https://www.victorsport.com/product/auraspeed-100x-ultra-c', 'r-victor-auraspeed-100x-ultra-g'),
  ('https://www.victorsport.com/product/auraspeed-30h-d', 'r-victor-auraspeed-30h'),
  ('https://www.victorsport.com/product/auraspeed-9-r', 'r-victor-auraspeed-9'),
  ('https://www.victorsport.com/product/auraspeed-9-t', 'r-victor-auraspeed-9'),
  ('https://www.victorsport.com/product/auraspeed-90k-ii-td', 'r-victor-auraspeed-90k-ii-td'),
  ('https://www.victorsport.com/product/auraspeed-90k-metallic-r', 'r-victor-auraspeed-90k-metallic'),
  ('https://www.victorsport.com/product/auraspeedljhe', 'r-victor-auraspeed-ljh-e'),
  ('https://www.victorsport.com/product/auraspeed99j', 'r-victor-auraspeed-99-j'),
  ('https://www.victorsport.com/product/brave-sword-1800-d', 'r-victor-brave-sword-1800d'),
  ('https://www.victorsport.com/product/cl-vi-e', 'r-victor-columbia-vi'),
  ('https://www.victorsport.com/product/drivex-09-i', 'r-victor-drivex-09'),
  ('https://www.victorsport.com/product/drivex-09-m', 'r-victor-drivex-09'),
  ('https://www.victorsport.com/product/drivex-1-a', 'r-victor-dx-1-a'),
  ('https://www.victorsport.com/product/drivex-10metallic', 'r-victor-dx-10metallic-b'),
  ('https://www.victorsport.com/product/drivex-3h-r', 'r-victor-drivex-3h'),
  ('https://www.victorsport.com/product/drivex-3h-v', 'r-victor-drivex-3h'),
  ('https://www.victorsport.com/product/drivex-5h-d', 'r-victor-drivex-5h-d'),
  ('https://www.victorsport.com/product/jetspeed-s-12-ii-r', 'r-victor-jetspeed-s-12-ii-r'),
  ('https://www.victorsport.com/product/jetspeed-s-12-m', 'r-victor-jetspeed-s-12m'),
  ('https://www.victorsport.com/product/jetspeed-s-2sp-c', 'r-victor-jetspeed-s-2sp'),
  ('https://www.victorsport.com/product/thruster-f', 'r-victor-thruster-f'),
  ('https://www.victorsport.com/product/thruster-f--ultra-c', 'r-victor-thruster-f-ultra'),
  ('https://www.victorsport.com/product/thruster-k-11', 'r-victor-thruster-k-100'),
  ('https://www.victorsport.com/product/thruster-k-13', 'r-victor-thruster-k-110'),
  ('https://www.victorsport.com/product/thruster-k-18', 'r-victor-thruster-k-30'),
  ('https://www.victorsport.com/product/thruster-ryuga-cls', 'r-victor-thruster-ryuga-cls-c'),
  ('https://www.victorsport.com/product/thruster-ryuga-ii-td-j', 'r-victor-thruster-ryuga-ii-td'),
  ('https://www.victorsport.com/product/thruster-ryuga-metallic', 'r-victor-thruster-ryuga-metallic'),
  ('https://www.victorsport.com/product/thruster-ryuga-muse-f', 'r-victor-thruster-ryuga-muse-f'),
  ('https://www.yonex.com/badminton/racquets/astrox-22-rx', 'r-yonex-astrox-22-rx'),
  ('https://www.yonex.com/badminton/racquets/ax3dg-hf', 'r-yonex-astrox-3-dg-hf'),
  ('https://www.yonex.com/badminton/racquets/ax3dg-st', 'r-yonex-astrox-3-dg-st'),
  ('https://www.yonex.com/badminton/racquets/astrox-7-dg', 'r-yonex-astrox-7-dg');

create temporary table affected_racket_image_owners on commit drop as
select distinct image.racket_id
from racket_images image
join corrected_racket_image_owners corrected
  on corrected.source_page_url = image.source_page_url
where image.racket_id <> corrected.racket_id;

delete from racket_images image
using corrected_racket_image_owners corrected
where image.source_page_url = corrected.source_page_url
  and image.racket_id <> corrected.racket_id;

-- Re-elect one hero for every gallery that lost a wrongly-owned row, then keep
-- the denormalised card pointers in sync. A racket with no correctly-owned
-- gallery left gets no gallery hero rather than another model's photograph.
update racket_images image
set is_hero = false
where image.racket_id in (select racket_id from affected_racket_image_owners);

with ranked as (
  select
    id,
    row_number() over (partition by racket_id order by position, id) as rank
  from racket_images
  where racket_id in (select racket_id from affected_racket_image_owners)
)
update racket_images image
set is_hero = true
from ranked
where ranked.id = image.id and ranked.rank = 1;

with heroes as (
  select racket_id, public_url, thumb_url
  from racket_images
  where is_hero
    and racket_id in (select racket_id from affected_racket_image_owners)
)
update rackets racket
set
  hero_image_url = hero.public_url,
  hero_thumb_url = hero.thumb_url
from heroes hero
where hero.racket_id = racket.id;

update rackets racket
set
  hero_image_url = null,
  hero_thumb_url = null
where racket.id in (select racket_id from affected_racket_image_owners)
  and not exists (
    select 1 from racket_images image where image.racket_id = racket.id
  );

-- The same photograph from the same manufacturer page can never be attached
-- to two catalogue records again. The trigger below strengthens this to the
-- whole source page, including different photos from that page.
create unique index if not exists racket_images_source_page_checksum_idx
  on racket_images (source_page_url, checksum);

create or replace function validate_racket_image_ownership()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  brand_slug text;
  racket_slug text;
  expected_model_slug text;
  expected_prefix text;
  expected_public_suffix text;
begin
  -- Serialize claims on one page so concurrent crawls cannot race this check.
  perform pg_advisory_xact_lock(hashtextextended(new.source_page_url, 0));

  if exists (
    select 1
    from racket_images other
    where other.source_page_url = new.source_page_url
      and other.racket_id <> new.racket_id
      and other.id <> new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'manufacturer source page is already owned by another racket';
  end if;

  select brand.slug, racket.slug
  into brand_slug, racket_slug
  from rackets racket
  join brands brand on brand.id = racket.brand_id
  where racket.id = new.racket_id;

  if brand_slug is null then
    return new; -- the foreign key reports the missing racket more precisely
  end if;

  expected_model_slug := case
    when racket_slug like brand_slug || '-%'
      then substring(racket_slug from char_length(brand_slug) + 2)
    else racket_slug
  end;
  expected_prefix := brand_slug || '/' || expected_model_slug || '/';

  if left(new.storage_path, char_length(expected_prefix)) <> expected_prefix then
    raise exception using
      errcode = '23514',
      message = format(
        'storage path %s does not match racket slug; expected prefix %s',
        new.storage_path,
        expected_prefix
      );
  end if;

  if new.thumb_path is not null
     and left(new.thumb_path, char_length(expected_prefix)) <> expected_prefix then
    raise exception using
      errcode = '23514',
      message = format(
        'thumbnail path %s does not match racket slug; expected prefix %s',
        new.thumb_path,
        expected_prefix
      );
  end if;

  expected_public_suffix :=
    '/storage/v1/object/public/' || new.storage_bucket || '/' || new.storage_path;
  if new.public_url is not null
     and right(new.public_url, char_length(expected_public_suffix)) <> expected_public_suffix then
    raise exception using
      errcode = '23514',
      message = 'public URL does not match storage bucket/path';
  end if;

  if new.thumb_path is not null and new.thumb_url is not null then
    expected_public_suffix :=
      '/storage/v1/object/public/' || new.storage_bucket || '/' || new.thumb_path;
    if right(new.thumb_url, char_length(expected_public_suffix)) <> expected_public_suffix then
      raise exception using
        errcode = '23514',
        message = 'thumbnail URL does not match storage bucket/path';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_racket_image_ownership on racket_images;
create trigger validate_racket_image_ownership
before insert or update of
  racket_id,
  source_page_url,
  storage_bucket,
  storage_path,
  public_url,
  thumb_path,
  thumb_url
on racket_images
for each row execute function validate_racket_image_ownership();

comment on function validate_racket_image_ownership() is
  'Prevents one manufacturer page from owning multiple rackets and keeps Storage paths/URLs aligned with database slugs.';
