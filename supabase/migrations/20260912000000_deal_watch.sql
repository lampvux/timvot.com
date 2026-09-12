-- Price drops, materialised.
--
-- `getDeals()` answers "which variants are below their own recent median and
-- still falling" — and to answer it, it read every price point there is. The
-- price table grows by ~3.265 rows on every scrape, so at ninety days that is
-- 3,3 MB across 35 paged round trips, and it is 4,2 s of the homepage's read
-- before the function has left the database's region. The homepage renders
-- three of those rows. `/deals` renders a page of them.
--
-- The arithmetic cannot move into this file. `median30` is the median of the
-- last third of a variant's observed series and `delta30` is measured from the
-- start of that same window — a definition that lives in `variantPriceFromPoints`
-- in src/lib/data/repository.ts, and putting a second copy of it in SQL is how
-- the two start to disagree. So this follows `racket_scores`: the formula stays
-- in TypeScript, `scripts/refresh-market.ts` runs it, and the answer is stored
-- here.
--
-- Nothing here is required for the app to boot. `getDeals()` falls back to
-- reading the snapshot when this table is absent, so it can be applied after
-- the code ships rather than in lockstep with it.

create table if not exists deal_watch (
  variant_id   text primary key references racket_variants on delete cascade,
  racket_id    text not null references rackets on delete cascade,

  -- The most recent observation, and the movement the card reports.
  latest       bigint not null,
  -- Negative. A deal is a variant whose latest price is below its own recent
  -- median *and* still falling, so a non-negative delta is not a row here.
  delta_30     bigint not null,
  median_30    bigint not null,
  delta_90     bigint not null,

  -- The trailing window the sparkline draws, oldest first, as
  -- [{ "d": "2026-09-01", "p": 3290000 }, …]. Bounded on purpose: the chart
  -- reads the last eight and this keeps a little headroom, so no caller can
  -- quietly come to depend on the full series arriving from a projection that
  -- was never going to carry it. A caller that needs the whole series reads
  -- price_points, which is what getVariantPrice still does.
  recent_points jsonb not null default '[]'::jsonb,

  computed_at  timestamptz not null default now()
);

comment on table deal_watch is
  'Materialised price drops. Written by scripts/refresh-market.ts using variantPriceFromPoints() in src/lib/data/repository.ts, which stays the only definition. recent_points is a bounded trailing window, not the full series.';

-- `/deals` and the homepage both order by the size of the drop, steepest
-- first, and both stop after a page.
create index if not exists deal_watch_delta_idx
  on deal_watch (delta_30 asc, variant_id asc);

create index if not exists deal_watch_racket_idx on deal_watch (racket_id);

alter table deal_watch enable row level security;

-- Derived from the catalogue, so it is public and read-only on the same terms
-- as the tables it comes from.
drop policy if exists "deal watch is public" on deal_watch;
create policy "deal watch is public" on deal_watch
  for select using (true);

drop policy if exists "admins write deal watch" on deal_watch;
create policy "admins write deal watch" on deal_watch
  for all using (is_admin()) with check (is_admin());

drop policy if exists "staff write deal watch" on deal_watch;
create policy "staff write deal watch" on deal_watch
  for all using (can_manage_content()) with check (can_manage_content());
