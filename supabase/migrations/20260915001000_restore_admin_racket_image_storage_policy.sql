-- Earlier migrations contain this policy, but the live project recorded those
-- migration filenames before the Storage policy was added to them. Migrations
-- are immutable once applied, so restore the missing policy in a new migration.
--
-- The admin app uploads with the signed-in staff user's JWT. Keep that path
-- staff-only; do not switch the editor to the service-role key just to bypass
-- Storage RLS.

drop policy if exists "staff manage racket image objects" on storage.objects;

create policy "staff manage racket image objects"
on storage.objects
for all
to authenticated
using (
  bucket_id like 'racket-images%'
  and public.can_manage_content()
)
with check (
  bucket_id like 'racket-images%'
  and public.can_manage_content()
);

comment on policy "staff manage racket image objects" on storage.objects is
  'Allows authenticated admin and manager profiles to upload, update, and delete racket gallery objects.';
