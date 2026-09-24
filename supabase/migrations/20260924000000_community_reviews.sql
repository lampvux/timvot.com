-- Community reviews written from the racket page.
--
-- Until now the only way a review reached the table was a staff insert, and
-- the two author policies from the init migration were never exercised by
-- the app. They were also too loose to expose: a signed-in user could insert
-- `tier = 'purchase', status = 'published'` directly through PostgREST, which
-- is a verified 3x-weighted review in the Court Score written by anyone. The
-- score is the product claim, so that door closes before a form opens it.
--
-- Every author write now goes through `submit_review`, which decides the
-- things an author must not: the tier (always `community`, 1x weight), the
-- status, the author name, and whether this account has written too much
-- today. The structural community standards are enforced here so a direct
-- RPC call cannot skip them; `src/lib/review-standards.ts` repeats them for
-- the form's messages and adds the heuristics that are not worth restating in
-- SQL. `src/lib/guardrails/review-limits.test.ts` fails when the numbers in
-- the two files disagree.

drop policy if exists "users write their own reviews" on reviews;
drop policy if exists "users edit their own reviews" on reviews;

-- One review per account per racket. Staff-seeded rows carry no user.
create unique index if not exists reviews_one_per_author_idx
  on reviews (racket_id, user_id)
  where user_id is not null;

-- The rate-limit read: this author's reviews, newest first.
create index if not exists reviews_author_recent_idx
  on reviews (user_id, created_at desc)
  where user_id is not null;

create or replace function public.submit_review(
  p_racket_id text,
  p_skill_level text,
  p_format text,
  p_position text,
  p_string_model text,
  p_tension_lbs integer,
  p_power integer,
  p_speed integer,
  p_control integer,
  p_comfort integer,
  p_body text,
  p_locale text
) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  c_body_min constant int := 40;
  c_body_max constant int := 2000;
  c_string_min constant int := 2;
  c_string_max constant int := 60;
  c_tension_min constant int := 15;
  c_tension_max constant int := 35;
  c_per_day constant int := 5;
  c_cooldown_seconds constant int := 60;

  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_string text := btrim(coalesce(p_string_model, ''));
  v_author text;
  v_id text;
  v_last timestamptz;
begin
  if v_uid is null then
    raise exception 'review_auth';
  end if;

  if not exists (select 1 from public.rackets r where r.id = p_racket_id) then
    raise exception 'review_invalid';
  end if;

  -- coalesce: a null argument makes the whole test null, which `if` reads as
  -- false. A missing field is an invalid review, not a passing one.
  if coalesce(
     char_length(v_body) < c_body_min or char_length(v_body) > c_body_max
     or char_length(v_string) < c_string_min or char_length(v_string) > c_string_max
     or p_tension_lbs < c_tension_min or p_tension_lbs > c_tension_max
     or p_skill_level not in ('beginner', 'intermediate', 'advanced')
     or p_format not in ('singles', 'doubles')
     or p_position not in ('net', 'mid', 'rear')
     or p_locale not in ('en', 'vi')
     or p_power not between 1 and 5 or p_speed not between 1 and 5
     or p_control not between 1 and 5 or p_comfort not between 1 and 5,
     true)
  then
    raise exception 'review_invalid';
  end if;

  -- Links and contact details are how a review becomes an advert.
  if v_body ~* '(https?://|www\.)' or v_string ~* '(https?://|www\.)' then
    raise exception 'review_links';
  end if;

  -- Serialise one author's submissions so two concurrent requests cannot
  -- both read a count under the limit.
  perform pg_advisory_xact_lock(hashtext('submit_review:' || v_uid::text));

  if exists (
    select 1 from public.reviews rv
    where rv.racket_id = p_racket_id and rv.user_id = v_uid
  ) then
    raise exception 'review_duplicate';
  end if;

  select max(rv.created_at) into v_last
  from public.reviews rv
  where rv.user_id = v_uid;

  if v_last is not null
     and v_last > now() - make_interval(secs => c_cooldown_seconds) then
    raise exception 'review_cooldown';
  end if;

  if (
    select count(*) from public.reviews rv
    where rv.user_id = v_uid and rv.created_at > now() - interval '24 hours'
  ) >= c_per_day then
    raise exception 'review_rate_limited';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), '')
  into v_author
  from public.profiles p
  where p.id = v_uid;

  v_id := gen_random_uuid()::text;

  insert into public.reviews (
    id, racket_id, user_id, author_name, tier,
    skill_level, format, position, string_model, tension_lbs,
    power, speed, control, comfort,
    body_en, body_vi, status
  ) values (
    v_id, p_racket_id, v_uid, coalesce(v_author, ''), 'community',
    p_skill_level::public.skill_level,
    p_format::public.match_format,
    p_position::public.court_position,
    v_string, p_tension_lbs,
    p_power, p_speed, p_control, p_comfort,
    case when p_locale = 'en' then v_body end,
    case when p_locale = 'vi' then v_body end,
    -- Published on arrival: the checks above are the gate, and staff reject
    -- through the "staff manage reviews" policy. A pending queue nobody
    -- works is a review that never appears.
    'published'
  );

  return v_id;
end;
$function$;

revoke all on function public.submit_review(
  text, text, text, text, text, integer, integer, integer, integer, integer, text, text
) from public, anon;
grant execute on function public.submit_review(
  text, text, text, text, text, integer, integer, integer, integer, integer, text, text
) to authenticated;

comment on function public.submit_review(
  text, text, text, text, text, integer, integer, integer, integer, integer, text, text
) is
  'The only author write path for reviews: forces community tier, one per racket, 5 per day, 60 s apart, no links.';
