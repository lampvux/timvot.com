-- Per-seller numbers for ranking the /sellers directory.
--
-- The directory ranks sellers by how much of the catalogue they actually
-- carry. Counting that from the app would mean reading every offer — 5,000
-- and growing — to produce ten rows, so Postgres counts and returns one row
-- per seller.
--
--   racket_count  distinct rackets with a live offer in stock
--   offer_count   live offers, in stock or not
--   brand_count   distinct brands across those in-stock rackets
--
-- Orders and stock totals are deliberately not here: the directory does not
-- rank on them.

create or replace function public.get_seller_directory_stats()
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'seller_id', s.id,
      'racket_count', coalesce(x.racket_count, 0),
      'offer_count', coalesce(x.offer_count, 0),
      'brand_count', coalesce(x.brand_count, 0)
    ) order by s.id
  ), '[]'::jsonb)
  from public.sellers s
  left join (
    select
      o.seller_id,
      count(distinct o.racket_id) filter (where o.qty_available > 0) as racket_count,
      count(*) as offer_count,
      count(distinct r.brand_id) filter (where o.qty_available > 0) as brand_count
    from public.offers o
    join public.rackets r on r.id = o.racket_id
    where o.status = 'live'
    group by o.seller_id
  ) x on x.seller_id = s.id;
$function$;

revoke all on function public.get_seller_directory_stats() from public;
grant execute on function public.get_seller_directory_stats() to anon, authenticated;

comment on function public.get_seller_directory_stats() is
  'One row per seller: in-stock rackets, live offers and brands carried, for ranking /sellers.';
