-- Make the worker-only intent explicit. Supabase grants table privileges to
-- API roles by default, so this policy preserves a visible, testable deny-all
-- boundary while the service role continues to bypass RLS.
create policy "guide generation runs are worker-only"
  on public.guide_generation_runs
  for all
  to anon, authenticated
  using (false)
  with check (false);
