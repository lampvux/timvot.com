-- The crawler owns discovered manufacturer rows, while the admin editor can
-- make deliberate exceptions. Mark those exceptions so a future --refresh
-- does not replace or prune them. Admin uploads are backfilled because they
-- predate this explicit ownership flag.

alter table racket_images
  add column if not exists admin_managed boolean not null default false;

update racket_images
set admin_managed = true
where provider = 'admin' and not admin_managed;

comment on column racket_images.admin_managed is
  'True after staff upload or edit a record; crawler refreshes must preserve it.';
