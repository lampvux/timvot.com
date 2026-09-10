-- Bounded reads for the racket detail route.
--
-- The old application path first looked up the brand, then the racket, then
-- issued three market reads. It also rebuilt the complete catalogue index to
-- render offers, reviews, the headline price and three related cards. These
-- functions keep the same public data behind RLS while moving the joins and
-- aggregation into Postgres, where the work measured below one millisecond.
--
-- Core and market are deliberately separate. Specifications and every gallery
-- image use the long catalogue cache; offers, reviews and price points use the
-- short market cache. The application starts both RPCs together on a true cold
-- page load, so the separation does not introduce a network waterfall.

-- The existing unique indexes on brands.slug and rackets.slug, plus
-- racket_variants_racket_idx, racket_images_racket_idx and
-- price_points_variant_idx, already cover the core and history lookups.
-- These partial indexes match the two status-filtered, ordered detail reads.
create index if not exists offers_detail_live_idx
  on public.offers (racket_id, price, id)
  where status = 'live';

create index if not exists reviews_detail_published_idx
  on public.reviews (racket_id, created_at desc, id)
  where status = 'published';

-- Stable catalogue data for one URL. `rackets` is an array because a small
-- legacy subset has both bare and brand-prefixed rows; the application merges
-- every image from those equivalent rows while keeping the requested row's
-- specifications. Every image row is returned, but only display/merge fields
-- cross the wire--crawl provenance and byte metadata are not rendered.
create or replace function public.get_racket_detail_core(
  p_brand_slug text,
  p_racket_slug text
) returns jsonb
language sql
stable
set search_path = ''
as $function$
  with requested as (
    select
      r.id,
      r.brand_id,
      case
        when left(p_racket_slug, length(p_brand_slug) + 1) = p_brand_slug || '-'
          then substr(p_racket_slug, length(p_brand_slug) + 2)
        else p_racket_slug
      end as model_slug
    from public.rackets r
    join public.brands b on b.id = r.brand_id
    where b.slug = p_brand_slug
      and r.slug = p_racket_slug
    limit 1
  ),
  equivalent as (
    select r.*
    from public.rackets r
    cross join requested q
    where r.brand_id = q.brand_id
      and r.slug in (
        p_racket_slug,
        q.model_slug,
        p_brand_slug || '-' || q.model_slug
      )
  )
  select case
    -- Preserve the repository's seeded first-run fallback when Supabase is
    -- configured but the catalogue has not been provisioned yet.
    when not exists (
      select 1 from public.brands b where b.slug = p_brand_slug
    ) then jsonb_build_object('status', 'unavailable', 'rackets', '[]'::jsonb)
    when not exists (select 1 from requested)
      then jsonb_build_object('status', 'missing', 'rackets', '[]'::jsonb)
    else jsonb_build_object(
    'status', 'found',
    'rackets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'slug', e.slug,
          'name', e.name,
          'release_year', e.release_year,
          'balance_point_mm', e.balance_point_mm,
          'shaft_flex', e.shaft_flex,
          'shaft_diameter_mm', e.shaft_diameter_mm,
          'frame_shape', e.frame_shape,
          'frame_material', e.frame_material,
          'max_tension_min_lbs', e.max_tension_min_lbs,
          'max_tension_max_lbs', e.max_tension_max_lbs,
          'length_mm', e.length_mm,
          'string_pattern', e.string_pattern,
          'msrp', e.msrp,
          'currency', e.currency,
          'play_style_tags', e.play_style_tags,
          'skill_level', e.skill_level,
          'hero_image_url', e.hero_image_url,
          'hero_thumb_url', e.hero_thumb_url,
          'summary_en', e.summary_en,
          'summary_vi', e.summary_vi,
          'brand', jsonb_build_object(
            'slug', b.slug,
            'name', b.name
          ),
          'variants', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', v.id,
                'racket_id', v.racket_id,
                'weight_class', v.weight_class,
                'weight_grams', v.weight_grams,
                'grip_size', v.grip_size,
                'colourway', v.colourway,
                'sku', v.sku
              ) order by v.weight_grams, v.id
            )
            from public.racket_variants v
            where v.racket_id = e.id
          ), '[]'::jsonb),
          'images', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'racket_id', i.racket_id,
                'provider', i.provider,
                'storage_bucket', i.storage_bucket,
                'storage_path', i.storage_path,
                'public_url', i.public_url,
                'thumb_url', i.thumb_url,
                'position', i.position,
                'is_hero', i.is_hero,
                'checksum', i.checksum,
                'colourway', i.colourway
              ) order by i.position, i.storage_path
            )
            from public.racket_images i
            where i.racket_id = e.id
          ), '[]'::jsonb)
        ) order by (e.slug = p_racket_slug) desc, e.slug
      )
      from equivalent e
      join public.brands b on b.id = e.brand_id
    ), '[]'::jsonb)
  ) end;
$function$;

-- Volatile market data for the same URL. Offers carry the seller fields the
-- page renders, reviews omit ownership/moderation columns, and history keeps
-- only the three chart fields. The racket id is resolved inside this RPC so it
-- can run concurrently with get_racket_detail_core.
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
    'reviews', coalesce((
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
      from public.reviews rv
      where rv.racket_id = r.id
        and rv.status = 'published'
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

-- Three card-shaped rows, fetched only after the similar section approaches
-- the viewport. `racket_market` already owns the live-price aggregation, so
-- this RPC ranks in SQL and returns only the fields RacketCard renders.
create or replace function public.get_similar_rackets(
  p_racket_id text,
  p_limit integer default 3
) returns jsonb
language sql
stable
set search_path = ''
as $function$
  with target as (
    select m.id, m.balance_point_mm, m.effective_price
    from public.racket_market m
    where m.id = p_racket_id
  ),
  ranked as (
    select
      m.*,
      abs(m.balance_point_mm - t.balance_point_mm)
        + abs(m.effective_price - t.effective_price)::numeric / 200000 as distance
    from public.racket_market m
    cross join target t
    where m.id <> t.id
    order by distance, m.id
    limit least(greatest(coalesce(p_limit, 3), 1), 12)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'slug', r.slug,
      'name', r.name,
      'release_year', r.release_year,
      'balance_point_mm', r.balance_point_mm,
      'shaft_flex', r.shaft_flex,
      'msrp', r.msrp,
      'play_style_tags', r.play_style_tags,
      'hero_image_url', r.hero_image_url,
      'hero_thumb_url', r.hero_thumb_url,
      'brand_slug', k.brand_slug,
      'brand_name', k.brand_name,
      'balance_type', k.balance_type,
      'lowest_price', k.lowest_price,
      'seller_count', k.seller_count,
      'variants', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'weight_class', v.weight_class,
            'weight_grams', v.weight_grams
          ) order by v.weight_grams, v.id
        )
        from public.racket_variants v
        where v.racket_id = r.id
      ), '[]'::jsonb)
    ) order by k.distance, k.id
  ), '[]'::jsonb)
  from ranked k
  join public.rackets r on r.id = k.id;
$function$;

revoke all on function public.get_racket_detail_core(text, text) from public;
revoke all on function public.get_racket_detail_market(text, text) from public;
revoke all on function public.get_similar_rackets(text, integer) from public;

grant execute on function public.get_racket_detail_core(text, text) to anon, authenticated;
grant execute on function public.get_racket_detail_market(text, text) to anon, authenticated;
grant execute on function public.get_similar_rackets(text, integer) to anon, authenticated;

comment on function public.get_racket_detail_core(text, text) is
  'Stable racket specifications, variants and every gallery image for one detail URL.';
comment on function public.get_racket_detail_market(text, text) is
  'Live offers with sellers, published reviews and price history for one detail URL.';
comment on function public.get_similar_rackets(text, integer) is
  'A bounded, card-shaped similar-racket result ranked by balance and effective price.';
