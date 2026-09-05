-- Shuttlecraft Admin — staff roles, content-manager policies, and audit trail.
--
-- Authentication remains in Supabase Auth. `profiles.role` is the authorization
-- source used by both the public site and the standalone admin application.

alter type app_role add value if not exists 'manager';

create or replace function can_manage_content() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role::text in ('admin', 'manager')
  );
$$;

comment on function can_manage_content() is
  'True for authenticated admin and manager profiles. Used for catalogue/content RLS.';

-- Staff policies are additive to the existing admin policies, so this migration
-- is safe to apply to databases that already serve the public application.
create policy "staff manage brands" on brands for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage rackets" on rackets for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage variants" on racket_variants for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage sellers" on sellers for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage offers" on offers for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage prices" on price_points for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage reviews" on reviews for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage guides" on guides for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage racket images" on racket_images for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage string catalogue" on strings for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage string offers" on string_offers for all
  using (can_manage_content()) with check (can_manage_content());
create policy "staff manage string history" on string_price_points for all
  using (can_manage_content()) with check (can_manage_content());

-- A public bucket still evaluates storage.objects RLS. Managers need the same
-- controlled image write path as admins.
create policy "staff manage racket image objects" on storage.objects for all
  using (bucket_id like 'racket-images%' and public.can_manage_content())
  with check (bucket_id like 'racket-images%' and public.can_manage_content());

-- The original row policy intentionally permits a user to update their own
-- profile, but column grants must prevent role escalation through PostgREST.
revoke update on table public.profiles from authenticated;
grant update (display_name, skill_level, locale) on table public.profiles to authenticated;

create table admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references auth.users on delete restrict,
  actor_role  app_role not null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index admin_audit_log_actor_idx on admin_audit_log (actor_id, created_at desc);

alter table admin_audit_log enable row level security;

create policy "staff record own audit events" on admin_audit_log for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and can_manage_content()
    and actor_role::text = (
      select p.role::text from public.profiles p where p.id = auth.uid()
    )
  );

create policy "admins read all audit events" on admin_audit_log for select
  to authenticated using (is_admin());

create policy "managers read own audit events" on admin_audit_log for select
  to authenticated using (actor_id = auth.uid() and can_manage_content());

grant select, insert on table public.admin_audit_log to authenticated;

comment on table admin_audit_log is
  'Append-only record of mutations performed through the standalone admin application.';

