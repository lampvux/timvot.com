-- Compact, public market facts for catalogue cards.
--
-- The application previously downloaded every live offer, price point,
-- seller and published review before it could render a 24-card catalogue
-- page. This view keeps the exact score inputs and market counts but leaves
-- offer rows, review bodies and the ever-growing price history in Postgres.

create or replace view public.racket_market_summary
with (security_invoker = true)
as
with live_market as (
  select
    racket_id,
    min(price) filter (where qty_available > 0) as lowest_price,
    count(distinct seller_id) filter (where qty_available > 0) as seller_count
  from public.offers
  where status = 'live'
  group by racket_id
),
published_reviews as (
  select
    racket_id,
    count(*) as review_count,
    sum(case tier when 'purchase' then 3 when 'owner' then 2 else 1 end)
      as review_weight,
    sum(power * (case tier when 'purchase' then 3 when 'owner' then 2 else 1 end))
      as power_weighted_sum,
    sum(speed * (case tier when 'purchase' then 3 when 'owner' then 2 else 1 end))
      as speed_weighted_sum,
    sum(control * (case tier when 'purchase' then 3 when 'owner' then 2 else 1 end))
      as control_weighted_sum,
    sum(comfort * (case tier when 'purchase' then 3 when 'owner' then 2 else 1 end))
      as comfort_weighted_sum
  from public.reviews
  where status = 'published'
  group by racket_id
)
select
  r.id as racket_id,
  m.lowest_price,
  coalesce(m.seller_count, 0)::integer as seller_count,
  coalesce(v.review_count, 0)::integer as review_count,
  coalesce(v.review_weight, 0)::double precision as review_weight,
  coalesce(v.power_weighted_sum, 0)::double precision as power_weighted_sum,
  coalesce(v.speed_weighted_sum, 0)::double precision as speed_weighted_sum,
  coalesce(v.control_weighted_sum, 0)::double precision as control_weighted_sum,
  coalesce(v.comfort_weighted_sum, 0)::double precision as comfort_weighted_sum
from public.rackets r
left join live_market m on m.racket_id = r.id
left join published_reviews v on v.racket_id = r.id;

comment on view public.racket_market_summary is
  'One compact row per racket for catalogue pricing and Court Score inputs.';

grant select on public.racket_market_summary to anon, authenticated;
