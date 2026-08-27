-- Gallery images crawled from the manufacturers' own sites.
--
-- The retailer scrape gives us one thumbnail per listing, cropped to whatever
-- box that shop's theme uses (shopvnb serves 300×300 webp). That is enough for
-- a card and nowhere near enough for a spec page, and it is also the *shop's*
-- photography, re-shot per shop, so the same frame looks different on every
-- listing. The manufacturers publish the real product galleries — six to ten
-- studio shots of one frame, at full resolution, consistent across the model.
--
-- Those images are hotlink-hostile (Magento signs its resize parameters, Victor
-- serves from a CloudFront distribution that can rotate) and they are not ours
-- to depend on staying up, so the crawler copies the bytes into Supabase
-- Storage and this table records where each one came from and where it landed.
--
-- Two things this table deliberately does NOT do:
--
--   * It does not replace `rackets.hero_image_url`. That column stays the one
--     denormalised pointer a card render needs without a join; the crawler
--     writes the chosen hero into it. This table is the gallery behind it.
--
--   * It does not key on `racket_variants`. A manufacturer's colour swatch
--     ("High Orange") and a Vietnamese retailer's ("cam") are the same paint in
--     two vocabularies, and matching them is a guess we should not bake into a
--     foreign key. The colour is recorded as the manufacturer names it and the
--     join, when someone wants it, stays a decision at read time.

-- ------------------------------------------------------------ table

create table racket_images (
  id              text primary key,
  racket_id       text not null references rackets on delete cascade,

  -- Which manufacturer site the image was crawled from ('yonex', 'yonex-uk',
  -- 'mizuno-asia', …). Not the same thing as the racket's brand: a brand can be
  -- crawled from more than one official property, and this is where that fact
  -- is recorded. The storage layout is partitioned by brand, not by this —
  -- provenance is a column to query, not a folder to look in.
  provider        text not null,

  -- Where it came from, so the crawl is auditable and re-runnable.
  source_url      text not null,
  source_page_url text not null,

  -- Where it landed. Bucket is stored per row because the crawler can be told
  -- to shard providers across buckets rather than folders.
  storage_bucket  text not null,
  storage_path    text not null,
  public_url      text,

  position        int  not null default 0,
  is_hero         boolean not null default false,

  content_type    text,
  bytes           int,
  width           int,
  height          int,

  -- sha256 of the downloaded bytes. This is the dedupe key: manufacturers reuse
  -- one photograph across a model's colourways and across regional sites, and
  -- URL comparison does not catch that because the query string differs.
  checksum        text not null,

  -- Colour as the manufacturer names it, when the gallery is per-colourway.
  colourway       text,

  crawled_at      timestamptz not null default now(),

  unique (racket_id, checksum)
);

create index racket_images_racket_idx   on racket_images (racket_id, position);
create index racket_images_provider_idx on racket_images (provider);
create unique index racket_images_hero_idx
  on racket_images (racket_id) where is_hero;

comment on table racket_images is
  'Gallery images crawled from manufacturer sites and copied into Supabase Storage. One row per stored object.';
comment on column racket_images.checksum is
  'sha256 of the stored bytes. Dedupe key — manufacturers reuse one photograph across colourways and regional sites under different URLs.';
comment on index racket_images_hero_idx is
  'At most one hero per racket. The hero is also denormalised into rackets.hero_image_url.';

-- ------------------------------------------------------------ RLS

alter table racket_images enable row level security;

-- Same shape as the rest of the catalogue: public reads, admin-only writes.
-- The crawler writes with the service-role key, which bypasses RLS.
create policy "catalogue is public" on racket_images for select using (true);
create policy "admins manage racket images" on racket_images for all
  using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------ storage

-- The default bucket. `npm run scrape:images -- --bucket-strategy=per-provider`
-- creates `racket-images-yonex`, `racket-images-victor`, … at runtime through
-- the Storage API instead; the policies below are written against the prefix so
-- both layouts are covered without a second migration.
--
-- Public, because these are product photographs on a public catalogue page and
-- signing every URL would mean the catalogue could not be statically rendered.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'racket-images',
  'racket-images',
  true,
  15728640,  -- 15 MB; the largest manufacturer original seen is under 4 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do nothing;

-- Anyone may read; only the service role (which bypasses RLS entirely) and
-- admins may write. Without the read policy a "public" bucket still 400s on
-- every object, because `public` only controls whether the URL form exists.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'racket images are public'
  ) then
    create policy "racket images are public" on storage.objects for select
      using (bucket_id like 'racket-images%');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'admins manage racket images'
  ) then
    create policy "admins manage racket images" on storage.objects for all
      using (bucket_id like 'racket-images%' and public.is_admin())
      with check (bucket_id like 'racket-images%' and public.is_admin());
  end if;
end $$;
