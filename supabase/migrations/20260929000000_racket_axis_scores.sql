-- Shuttlecraft — sort the catalogue by one axis of the spec profile.
--
-- `/rackets?sort=power` (and speed, control, comfort) ranks rackets by one of
-- the four axes Court Score is built from. Those axes come from
-- `specProfile()` in src/lib/court-score.ts — the published methodology — so,
-- exactly like `court_score` and `spec_score`, they are computed there by
-- `scripts/refresh-market.ts` and only the result is stored here. Restating
-- the coefficients in SQL would give the product two definitions of "comfort"
-- that could disagree.
--
-- The spec profile rather than a spec/player blend: it exists for every
-- racket, it is deterministic, and it is the same number on every racket's
-- detail page. A blend would rank a racket with five reviews on a different
-- scale from the 3.000 with none.
--
-- Nullable, and null sorts last: until `refresh-market` has run against this
-- migration, the columns are empty and the axis sorts fall back to Court Score
-- order through their tie-breakers rather than failing.

alter table racket_scores
  add column if not exists spec_power   numeric(3, 1),
  add column if not exists spec_speed   numeric(3, 1),
  add column if not exists spec_control numeric(3, 1),
  add column if not exists spec_comfort numeric(3, 1);

comment on column racket_scores.spec_power is
  'Spec-profile power axis, 0–10. Written by scripts/refresh-market.ts from specProfile() in src/lib/court-score.ts.';
comment on column racket_scores.spec_speed is
  'Spec-profile speed axis, 0–10. Written by scripts/refresh-market.ts from specProfile() in src/lib/court-score.ts.';
comment on column racket_scores.spec_control is
  'Spec-profile control axis, 0–10. Written by scripts/refresh-market.ts from specProfile() in src/lib/court-score.ts.';
comment on column racket_scores.spec_comfort is
  'Spec-profile comfort axis, 0–10. Written by scripts/refresh-market.ts from specProfile() in src/lib/court-score.ts.';

-- `create or replace` rather than drop-and-create: the four columns are
-- appended after every existing one, which Postgres allows in place, and
-- `get_similar_rackets` keeps reading the view without being recreated.
create or replace view racket_market
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

  coalesce(v.weight_classes, '{}') as weight_classes,

  lower(b.name || ' ' || r.name) as search_text,

  o.lowest_price,
  coalesce(o.seller_count, 0) as seller_count,
  coalesce(o.offer_count, 0) as offer_count,

  coalesce(o.lowest_price, r.msrp) as effective_price,

  s.court_score,
  coalesce(s.spec_score, 0) as spec_score,
  coalesce(s.review_count, 0) as review_count,
  coalesce(s.popular_rank, 1) as popular_rank,

  s.spec_power,
  s.spec_speed,
  s.spec_control,
  s.spec_comfort

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

grant select on racket_market to anon, authenticated;
