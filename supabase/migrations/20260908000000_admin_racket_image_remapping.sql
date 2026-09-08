-- Let staff repair a manufacturer gallery as one operation. A source page owns
-- a whole gallery, so changing one image at a time would be rejected by the
-- ownership trigger while sibling rows still point at the previous racket.

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
  perform pg_advisory_xact_lock(hashtextextended(new.source_page_url, 0));

  if coalesce(current_setting('shuttlecraft.gallery_remap', true), '') <> 'on'
     and exists (
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
    return new;
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

create or replace function remap_racket_image_gallery(
  p_image_id text,
  p_target_racket_id text,
  p_paths jsonb,
  p_position integer,
  p_colourway text,
  p_source_page_url text,
  p_use_as_hero boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_image racket_images%rowtype;
  previous_hero_id text;
  desired_hero_id text;
  fallback_hero racket_images%rowtype;
  expected_count integer;
  updated_count integer;
  old_pointer_owned boolean;
begin
  if not can_manage_content() then
    raise exception using errcode = '42501', message = 'staff access required';
  end if;

  if p_position < 0 then
    raise exception using errcode = '22023', message = 'gallery position must be zero or greater';
  end if;

  select * into current_image
  from racket_images
  where id = p_image_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'racket image not found';
  end if;

  if not exists (select 1 from rackets where id = p_target_racket_id) then
    raise exception using errcode = '23503', message = 'target racket not found';
  end if;

  select count(*) into expected_count
  from racket_images
  where racket_id = current_image.racket_id
    and source_page_url = current_image.source_page_url;

  if jsonb_typeof(p_paths) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'remap paths must be a JSON array';
  end if;

  if jsonb_array_length(p_paths) <> expected_count
     or exists (
       select 1
       from racket_images image
       where image.racket_id = current_image.racket_id
         and image.source_page_url = current_image.source_page_url
         and not exists (
           select 1
           from jsonb_to_recordset(p_paths) as path(id text)
           where path.id = image.id
         )
     ) then
    raise exception using
      errcode = '22023',
      message = 'remap paths must cover every image from the source gallery';
  end if;

  if exists (
    select 1
    from racket_images target
    where target.racket_id = p_target_racket_id
      and target.checksum in (
        select source.checksum
        from racket_images source
        where source.racket_id = current_image.racket_id
          and source.source_page_url = current_image.source_page_url
      )
      and not exists (
        select 1
        from jsonb_to_recordset(p_paths) as path(id text)
        where path.id = target.id
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'the target racket already contains one of these images';
  end if;

  if exists (
    select 1
    from racket_images other
    where other.source_page_url = p_source_page_url
      and other.racket_id <> p_target_racket_id
      and not exists (
        select 1
        from jsonb_to_recordset(p_paths) as path(id text)
        where path.id = other.id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'the requested source page is owned by another racket';
  end if;

  select image.id into previous_hero_id
  from racket_images image
  where image.racket_id = current_image.racket_id
    and image.source_page_url = current_image.source_page_url
    and image.is_hero
  limit 1;

  select exists (
    select 1
    from rackets racket
    join racket_images image on image.public_url = racket.hero_image_url
    where racket.id = current_image.racket_id
      and image.racket_id = current_image.racket_id
      and image.source_page_url = current_image.source_page_url
  ) into old_pointer_owned;

  desired_hero_id := case
    when p_use_as_hero then p_image_id
    when previous_hero_id = p_image_id then null
    else previous_hero_id
  end;

  perform set_config('shuttlecraft.gallery_remap', 'on', true);

  with paths as (
    select *
    from jsonb_to_recordset(p_paths) as path(
      id text,
      storage_path text,
      public_url text,
      thumb_path text,
      thumb_url text,
      source_url text
    )
  )
  update racket_images image
  set
    racket_id = p_target_racket_id,
    storage_path = path.storage_path,
    public_url = path.public_url,
    thumb_path = path.thumb_path,
    thumb_url = path.thumb_url,
    source_url = path.source_url,
    position = case when image.id = p_image_id then p_position else image.position end,
    colourway = case when image.id = p_image_id then p_colourway else image.colourway end,
    source_page_url = case
      when image.id = p_image_id then p_source_page_url
      else image.source_page_url
    end,
    is_hero = case
      when current_image.racket_id <> p_target_racket_id then false
      when image.id = p_image_id and not p_use_as_hero then false
      else image.is_hero
    end
  from paths path
  where image.id = path.id
    and image.racket_id = current_image.racket_id
    and image.source_page_url = current_image.source_page_url;

  get diagnostics updated_count = row_count;
  if updated_count <> expected_count then
    raise exception using
      errcode = '40001',
      message = 'the gallery changed while it was being remapped; try again';
  end if;

  if current_image.racket_id <> p_target_racket_id
     and (previous_hero_id is not null or old_pointer_owned) then
    update racket_images set is_hero = false
    where racket_id = current_image.racket_id;

    select * into fallback_hero
    from racket_images
    where racket_id = current_image.racket_id
      and public_url is not null
    order by position, id
    limit 1;

    if found then
      update racket_images set is_hero = true where id = fallback_hero.id;
      update rackets
      set hero_image_url = fallback_hero.public_url,
          hero_thumb_url = fallback_hero.thumb_url
      where id = current_image.racket_id;
    else
      update rackets
      set hero_image_url = null, hero_thumb_url = null
      where id = current_image.racket_id;
    end if;
  end if;

  if desired_hero_id is not null then
    update racket_images set is_hero = false
    where racket_id = p_target_racket_id
      and id <> desired_hero_id;
    update racket_images set is_hero = true
    where id = desired_hero_id and racket_id = p_target_racket_id;
    update rackets racket
    set hero_image_url = image.public_url,
        hero_thumb_url = image.thumb_url
    from racket_images image
    where racket.id = p_target_racket_id
      and image.id = desired_hero_id;
  elsif current_image.racket_id = p_target_racket_id
        and previous_hero_id = p_image_id then
    update rackets
    set hero_image_url = null, hero_thumb_url = null
    where id = p_target_racket_id;
  end if;

  return updated_count;
end;
$$;

revoke all on function remap_racket_image_gallery(
  text, text, jsonb, integer, text, text, boolean
) from public;
grant execute on function remap_racket_image_gallery(
  text, text, jsonb, integer, text, text, boolean
) to authenticated;

comment on function remap_racket_image_gallery(
  text, text, jsonb, integer, text, text, boolean
) is 'Atomically remaps a source-page gallery and keeps both rackets hero pointers consistent.';
