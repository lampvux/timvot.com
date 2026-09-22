-- Supabase may restore broad table grants when project defaults or dashboard
-- settings change. Keep profile self-service limited to non-privileged fields
-- even when RLS allows a user to update their own row.
revoke update on table public.profiles from authenticated;
grant update (display_name, skill_level, locale)
  on table public.profiles
  to authenticated;

-- The custom migration runner creates this table before applying migrations,
-- while the isolated CI harness applies migration files directly and therefore
-- does not have it. When present, keep migration history private to the
-- database owner that runs migrations.
do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    execute 'alter table public.schema_migrations enable row level security';
    execute 'revoke all on table public.schema_migrations from anon, authenticated';
    execute 'drop policy if exists "schema migrations are infrastructure-only" on public.schema_migrations';
    execute 'create policy "schema migrations are infrastructure-only" on public.schema_migrations for all to anon, authenticated using (false) with check (false)';
  end if;
end
$$;
