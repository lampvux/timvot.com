-- A product image per string.
--
-- Strings get one packshot, not a gallery: a reel of string photographed from
-- four angles is still one reel, and the racket gallery's machinery — a row
-- per object, hero election, an ownership trigger pinning paths to slugs —
-- exists for problems strings do not have. So the image lives on the row:
--
--   image_url         the stored original, public
--   thumb_url         a 400px WebP made from it, for lists; null when the
--                     original is already smaller than a thumbnail would be
--   image_path        the object's key in the `string-images` bucket, so a
--                     replacement can remove what it replaces
--   image_source_url  where the photograph came from: a manufacturer page for
--                     an imported image, `admin-upload:<id>` for a staff upload
--
-- The bucket is its own, not a folder in `racket-images`: every object in
-- that bucket is audited as belonging to a racket gallery
-- (`images:reconcile`, the ownership trigger), and a string reel would be
-- reported there as a lost racket photograph.

alter table public.strings
  add column if not exists image_url text,
  add column if not exists thumb_url text,
  add column if not exists image_path text,
  add column if not exists image_source_url text;

comment on column public.strings.image_url is 'Public URL of the stored packshot in the string-images bucket.';
comment on column public.strings.thumb_url is '400px WebP thumbnail of image_url; null when the original is already that small.';
comment on column public.strings.image_path is 'Object key of the packshot in the string-images bucket.';
comment on column public.strings.image_source_url is 'Where the image came from: a manufacturer page, or admin-upload:<id>.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'string-images',
  'string-images',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read, as for racket images: a public bucket without a select policy
-- still refuses object reads through the API.
drop policy if exists "string images are public" on storage.objects;
create policy "string images are public"
on storage.objects
for select
using (bucket_id = 'string-images');

-- The admin app uploads with the signed-in staff member's JWT, never the
-- service-role key. Admins and managers, as for racket images.
drop policy if exists "staff manage string image objects" on storage.objects;
create policy "staff manage string image objects"
on storage.objects
for all
to authenticated
using (bucket_id = 'string-images' and public.can_manage_content())
with check (bucket_id = 'string-images' and public.can_manage_content());

comment on policy "staff manage string image objects" on storage.objects is
  'Allows authenticated admin and manager profiles to upload, replace and delete string packshots.';
