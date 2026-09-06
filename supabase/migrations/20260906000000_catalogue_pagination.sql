-- Shuttlecraft — server-side catalogue pagination.
--
-- The catalogue page used to answer "show me page 3 of Yonex stiff frames" by
-- reading all seven tables in full, enriching 3.076 rackets, filtering the
-- array and slicing 24 items out of it. Measured against production
-- (`npx tsx scripts/benchmark.ts`) that is ~9.3 seconds and 7.4 MB over the
-- wire to render 24 cards, and it grows every night the scraper runs.
--
-- This migration makes the same question answerable in one query. Two pieces:
--
--   racket_scores   Court Score and its inputs, materialised. This is the only
--                   value that cannot be computed in SQL: `src/lib/court-score.ts`
--                   is the published methodology, and reimplementing it here
--                   would put the product's central claim in two languages that
--                   could disagree. `scripts/refresh-market.ts` computes it with
--                   that module and writes the result here, so there is still
--                   one formula.
--
--   racket_market   A plain view — not materialised — over rackets, brands,
--                   variants, live offers and racket_scores, exposing every
--                   column the catalogue filters or sorts on. Prices move every
--                   night, and a view has no staleness to manage. The aggregate
--                   costs ~4 ms at this catalogue size, which is well inside the
--                   round trip it rides along with.
--
-- Nothing here is required for the app to boot: the repository falls back to
-- reading the snapshot when the view is absent, so this can be applied after
-- the code ships rather than in lockstep with it.

-- ------------------------------------------------------------ racket_scores

create table if not exists racket_scores (
  racket_id    text primary key references rackets on delete cascade,
  -- Null under five verified reviews. The UI shows "spec profile only" for
  -- these, and they sort below every scored racket — a racket with no player
  -- half has not earned a position among the ones that have.
  court_score  int,
  spec_score   int not null default 0,
  review_count int not null default 0,
  -- Editorial brand tier, so the default browse order can be expressed as
  -- ORDER BY. Written from POPULAR_BRAND_SLUGS in src/lib/catalog-ranking.ts;
  -- lower sorts first.
  popular_rank int not null default 1,
  computed_at  timestamptz not null default now()
);

comment on table racket_scores is
  'Materialised Court Score. Written by scripts/refresh-market.ts using src/lib/court-score.ts, which stays the only definition of the formula.';

create index if not exists racket_scores_rank_idx
  on racket_scores (popular_rank, court_score desc nulls last, spec_score desc);

alter table racket_scores enable row level security;

-- The catalogue is public and read-only to everyone, same as the tables it is
-- derived from.
drop policy if exists "racket scores are public" on racket_scores;
create policy "racket scores are public" on racket_scores
  for select using (true);

drop policy if exists "admins write racket scores" on racket_scores;
create policy "admins write racket scores" on racket_scores
  for all using (is_admin()) with check (is_admin());

drop policy if exists "staff write racket scores" on racket_scores;
create policy "staff write racket scores" on racket_scores
  for all using (can_manage_content()) with check (can_manage_content());

-- --------------------------------------------------- supporting indexes

-- The filter facets, as the planner sees them. `offers_racket_idx` already
-- covers (racket_id, status); this adds the stock predicate the lowest-price
-- aggregate uses so it can be answered from the index alone.
create index if not exists offers_live_price_idx
  on offers (racket_id, price)
  where status = 'live' and qty_available > 0;

create index if not exists racket_variants_weight_idx
  on racket_variants (racket_id, weight_class);

create index if not exists rackets_release_year_idx on rackets (release_year desc);
create index if not exists rackets_msrp_idx on rackets (msrp);

-- Free-text search is `ilike '%term%'` over brand and model together, which no
-- b-tree can serve. Trigrams can.
create extension if not exists pg_trgm;
create index if not exists rackets_name_trgm_idx
  on rackets using gin (name gin_trgm_ops);

-- ------------------------------------------------------------ racket_market

-- One row per racket, carrying everything the catalogue can filter or sort on.
-- Dropped and recreated rather than `create or replace`, because the column
-- list changes are the whole point of a future edit here.
drop view if exists racket_market;

create view racket_market
with (security_invoker = true)
as
select
  r.id,
  r.slug,
  r.name,
  r.release_year,
  r.msrp,
  r.currency,
  r.shaft_flex,
  r.skill_level,
  r.play_style_tags,
  r.balance_point_mm,

  b.slug as brand_slug,
  b.name as brand_name,

  -- The same bands as balanceTypeOf() in src/lib/format.ts, which reads
  -- EVEN_BAND_MIN_MM (285) and EVEN_BAND_MAX_MM (295) from types.ts. These two
  -- numbers are the one place SQL restates a TypeScript constant, so
  -- assertBalanceBands() in src/lib/data/catalog-page.ts throws if they drift.
  case
    when r.balance_point_mm < 285 then 'head-light'
    when r.balance_point_mm > 295 then 'head-heavy'
    else 'even'
  end as balance_type,

  -- Filterable with PostgREST's `ov` (overlaps) operator, so the weight facet
  -- does not need a join from the client.
  coalesce(v.weight_classes, '{}') as weight_classes,

  -- Brand and model together, lowercased once here rather than per row per
  -- request in JavaScript.
  lower(b.name || ' ' || r.name) as search_text,

  o.lowest_price,
  coalesce(o.seller_count, 0) as seller_count,
  coalesce(o.offer_count, 0) as offer_count,

  -- What the price filter and both price sorts read. A racket nobody stocks
  -- still has a price to be compared on, which is its MSRP.
  coalesce(o.lowest_price, r.msrp) as effective_price,

  s.court_score,
  coalesce(s.spec_score, 0) as spec_score,
  coalesce(s.review_count, 0) as review_count,
  coalesce(s.popular_rank, 1) as popular_rank

from rackets r
join brands b on b.id = r.brand_id
left join racket_scores s on s.racket_id = r.id
left join lateral (
  select
    min(price) as lowest_price,
    count(distinct seller_id)::int as seller_count,
    count(*)::int as offer_count
  from offers
  where racket_id = r.id and status = 'live' and qty_available > 0
) o on true
left join lateral (
  select array_agg(distinct weight_class::text) as weight_classes
  from racket_variants
  where racket_id = r.id
) v on true;

comment on view racket_market is
  'One row per racket with every catalogue filter and sort key resolved. Read by getCatalogPage() in src/lib/data/repository.ts with .range() for true server-side pagination.';

grant select on racket_market to anon, authenticated;
grant select on racket_scores to anon, authenticated;
