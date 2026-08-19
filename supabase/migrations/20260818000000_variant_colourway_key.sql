-- Colourway becomes part of a variant's identity.
--
-- `racket_variants` was keyed `unique (racket_id, weight_class, grip_size)`,
-- which says a racket has at most one variant per weight and grip. That is not
-- how these frames are sold: an Astrox Tour 8500 4U G5 exists in red, blue and
-- orange, each a separate SKU that shops stock and price independently.
--
-- Before this change the scraper had nowhere to put the colour, so it leaked
-- into the model name instead — "Astrox Tour 8500 đỏ", "Astrox Tour 8500 xanh"
-- and "Astrox Tour 8500 cam" became three rackets, splitting the spec page, the
-- Court Score and the price history three ways for one frame. Folding colour
-- into the variant collapses 3.406 scraped "models" to 3.011 real ones, and 246
-- racket/weight/grip groups turn out to hold more than one colour.
--
-- `colourway` stays nullable, because plenty of listings never name a colour.
-- Postgres treats NULLs as distinct in a unique constraint, which would let an
-- unbounded number of null-colour rows pile up on the same racket/weight/grip,
-- so the key is an expression index over coalesce(colourway, '') instead.

-- Drop the old key by the columns it covers rather than by its auto-generated
-- name, which Postgres truncates at 63 characters and which a previous rename
-- could have changed.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  where con.conrelid = 'racket_variants'::regclass
    and con.contype = 'u'
    and (
      select array_agg(att.attname::text order by att.attname)
      from unnest(con.conkey) as k(attnum)
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = k.attnum
    ) = array['grip_size', 'racket_id', 'weight_class'];

  if constraint_name is not null then
    execute format('alter table racket_variants drop constraint %I', constraint_name);
  end if;
end $$;

create unique index if not exists racket_variants_identity_idx
  on racket_variants (racket_id, weight_class, grip_size, coalesce(colourway, ''));

comment on index racket_variants_identity_idx is
  'A variant is one racket in one weight, one grip and one colour. coalesce() is used because colourway is nullable and NULLs would otherwise all compare distinct.';

comment on column racket_variants.colourway is
  'Colour as the retailer names it. Part of the variant identity, not decoration: null means the listing named no colour.';
