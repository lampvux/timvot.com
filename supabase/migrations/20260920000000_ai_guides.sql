-- Local guide publishing. Existing guide bodies remain readable as legacy text.
alter table public.guides
  add column if not exists content_format text not null default 'text',
  add column if not exists category text not null default 'buying',
  add column if not exists topic_key text,
  add column if not exists subjects jsonb not null default '[]',
  add column if not exists intent text,
  add column if not exists sources jsonb not null default '[]',
  add column if not exists content_hash text,
  add column if not exists generation_model text,
  add column if not exists has_content boolean generated always as (coalesce(length(btrim(body_en)), 0) > 0 and coalesce(length(btrim(body_vi)), 0) > 0) stored,
  add column if not exists published_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
alter table public.guides alter column published set default false;
create unique index if not exists guides_topic_key_unique on public.guides(topic_key) where topic_key is not null;
create unique index if not exists guides_content_hash_unique on public.guides(content_hash) where content_hash is not null;
create index if not exists guides_published_date on public.guides(published_at desc, slug) where published;

create table if not exists public.guide_generation_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  state text not null check (state in ('running', 'published', 'failed')),
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  attempts int not null default 1,
  guide_slug text references public.guides(slug),
  error text
);
alter table public.guide_generation_runs enable row level security;
-- No public policies: only the service role used by the local worker can read/write.

create or replace function public.claim_guide_run(p_run_key text)
returns setof public.guide_generation_runs
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(9202026, 1);
  if exists(select 1 from guide_generation_runs where state = 'running' and lease_expires_at > now()) then return; end if;
  update guide_generation_runs set state = 'failed', error = 'Lease expired', completed_at = now()
    where state = 'running' and lease_expires_at <= now();
  return query insert into guide_generation_runs(run_key, state, lease_expires_at)
    values(p_run_key, 'running', now() + interval '5 minutes')
    on conflict(run_key) do update set state = 'running', lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes', started_at = now(), completed_at = null,
      error = null, attempts = guide_generation_runs.attempts + 1
    where guide_generation_runs.state = 'failed'
    returning *;
end $$;

create or replace function public.publish_generated_guide(p_run_id uuid, p_lease_token uuid, p_guide jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  perform pg_advisory_xact_lock(9202026, 1);
  if not exists(select 1 from guide_generation_runs where id = p_run_id and lease_token = p_lease_token
    and state = 'running' and lease_expires_at > now() for update) then
    raise exception 'Guide run lease is no longer owned';
  end if;
  if coalesce(p_guide->>'body_en', '') = '' or coalesce(p_guide->>'body_vi', '') = ''
    or coalesce(p_guide->>'topic_key', '') = '' or coalesce(p_guide->>'content_hash', '') = '' then
    raise exception 'Incomplete bilingual guide';
  end if;
  insert into guides(slug, title_en, title_vi, excerpt_en, excerpt_vi, body_en, body_vi,
    read_minutes, tone, published, content_format, category, topic_key, subjects, intent,
    sources, content_hash, generation_model, published_at, updated_at)
  values(p_guide->>'slug', p_guide->>'title_en', p_guide->>'title_vi', p_guide->>'excerpt_en',
    p_guide->>'excerpt_vi', p_guide->>'body_en', p_guide->>'body_vi',
    (p_guide->>'read_minutes')::int, 'default', true, 'guide-json-v1', p_guide->>'category',
    p_guide->>'topic_key', p_guide->'subjects', p_guide->>'intent', p_guide->'sources',
    p_guide->>'content_hash', p_guide->>'generation_model', now(), now()) returning slug into v_slug;
  update guide_generation_runs set state = 'published', guide_slug = v_slug, completed_at = now(), error = null
    where id = p_run_id;
  return v_slug;
end $$;

revoke all on function public.claim_guide_run(text) from public, anon, authenticated;
revoke all on function public.publish_generated_guide(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_guide_run(text) to service_role;
grant execute on function public.publish_generated_guide(uuid, uuid, jsonb) to service_role;
