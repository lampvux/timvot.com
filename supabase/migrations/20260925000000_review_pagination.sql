-- Reviews arrive a page at a time.
--
-- `get_racket_detail_market` used to return every published review for the
-- racket, because the page rendered them all and the Court Score needed them.
-- With community reviews open, a popular racket accumulates thousands, and
-- every one of them rode along with each cold detail render and its cache
-- entry — bodies and all — to show three cards.
--
-- The detail read now returns two things instead:
--   review_tally   per tier: a count and the four raw axis sums. Unweighted;
--                  `court-score.ts` applies the weights and the threshold, so
--                  the methodology still has one definition.
--   first_reviews  the newest three, the only ones the page renders first.
--
-- Everything after page one comes from `get_racket_reviews`, fetched when a
-- reader asks for that page. Both read `reviews_detail_published_idx`.
--
-- Deploy the app before applying this: the app reads either shape, while the
-- previous build reads only `reviews` and would show none until it is replaced.

create or replace function public.get_racket_detail_market(
  p_brand_slug text,
  p_racket_slug text
) returns jsonb
language sql
stable
set search_path = ''
as $function$
  with requested as (
    select r.id
    from public.rackets r
    join public.brands b on b.id = r.brand_id
    where b.slug = p_brand_slug
      and r.slug = p_racket_slug
    limit 1
  )
  select jsonb_build_object(
    'racket_id', r.id,
    'offers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'variant_id', o.variant_id,
          'racket_id', o.racket_id,
          'seller_id', o.seller_id,
          'price', o.price,
          'qty_available', o.qty_available,
          'condition', o.condition,
          'promoted', o.promoted,
          'status', o.status,
          'updated_at', o.updated_at,
          'seller', jsonb_build_object(
            'id', s.id,
            'slug', s.slug,
            'name', s.name,
            'tier', s.tier,
            'city', s.city,
            'rating', s.rating,
            'orders_count', s.orders_count,
            'dispute_rate', s.dispute_rate,
            'since', s.since
          ),
          'variant', jsonb_build_object(
            'id', v.id,
            'racket_id', v.racket_id,
            'weight_class', v.weight_class,
            'weight_grams', v.weight_grams,
            'grip_size', v.grip_size,
            'colourway', v.colourway,
            'sku', v.sku
          )
        ) order by o.price, o.id
      )
      from public.offers o
      join public.sellers s on s.id = o.seller_id
      join public.racket_variants v on v.id = o.variant_id
      where o.racket_id = r.id
        and o.status = 'live'
    ), '[]'::jsonb),
    -- Per-tier count and raw axis sums. No weights: court-score.ts applies
    -- them, so the methodology keeps one definition.
    'review_tally', coalesce((
      select jsonb_object_agg(t.tier, jsonb_build_object(
        'count', t.n, 'power', t.power, 'speed', t.speed,
        'control', t.control, 'comfort', t.comfort
      ))
      from (
        select rv.tier::text as tier, count(*) as n,
               sum(rv.power) as power, sum(rv.speed) as speed,
               sum(rv.control) as control, sum(rv.comfort) as comfort
        from public.reviews rv
        where rv.racket_id = r.id
          and rv.status = 'published'
        group by rv.tier
      ) t
    ), '{}'::jsonb),
    'first_reviews', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rv.id,
          'racket_id', rv.racket_id,
          'author_name', rv.author_name,
          'tier', rv.tier,
          'skill_level', rv.skill_level,
          'format', rv.format,
          'position', rv.position,
          'string_model', rv.string_model,
          'tension_lbs', rv.tension_lbs,
          'power', rv.power,
          'speed', rv.speed,
          'control', rv.control,
          'comfort', rv.comfort,
          'body_en', rv.body_en,
          'body_vi', rv.body_vi,
          'created_at', rv.created_at
        ) order by rv.created_at desc, rv.id
      )
      from (
        select * from public.reviews rv0
        where rv0.racket_id = r.id
          and rv0.status = 'published'
        order by rv0.created_at desc, rv0.id
        limit 3
      ) rv
    ), '[]'::jsonb),
    'price_points', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'variant_id', pp.variant_id,
          'observed_on', pp.observed_on,
          'price', pp.price
        ) order by pp.observed_on, pp.id
      )
      from public.price_points pp
      join public.racket_variants v on v.id = pp.variant_id
      where v.racket_id = r.id
    ), '[]'::jsonb)
  )
  from requested r;
$function$;

create or replace function public.get_racket_reviews(
  p_racket_id text,
  p_offset integer default 0,
  p_limit integer default 3
) returns jsonb
language sql
stable
set search_path = ''
as $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', rv.id,
      'racket_id', rv.racket_id,
      'author_name', rv.author_name,
      'tier', rv.tier,
      'skill_level', rv.skill_level,
      'format', rv.format,
      'position', rv.position,
      'string_model', rv.string_model,
      'tension_lbs', rv.tension_lbs,
      'power', rv.power,
      'speed', rv.speed,
      'control', rv.control,
      'comfort', rv.comfort,
      'body_en', rv.body_en,
      'body_vi', rv.body_vi,
      'created_at', rv.created_at
    ) order by rv.created_at desc, rv.id
  ), '[]'::jsonb)
  from (
    select *
    from public.reviews r
    where r.racket_id = p_racket_id
      and r.status = 'published'
    order by r.created_at desc, r.id
    -- A page is small by construction; nobody pages a racket by 1000.
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 3), 1), 12)
  ) rv;
$function$;

revoke all on function public.get_racket_detail_market(text, text) from public;
grant execute on function public.get_racket_detail_market(text, text) to anon, authenticated;
revoke all on function public.get_racket_reviews(text, integer, integer) from public;
grant execute on function public.get_racket_reviews(text, integer, integer) to anon, authenticated;

comment on function public.get_racket_detail_market(text, text) is
  'Live offers with sellers, a per-tier review tally, the newest three reviews and price history for one detail URL.';
comment on function public.get_racket_reviews(text, integer, integer) is
  'One page of published reviews for a racket, newest first, at most 12.';
