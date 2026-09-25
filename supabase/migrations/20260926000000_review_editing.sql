-- Authors can edit their review for three days, then it is fixed.
--
-- One review per account per racket is already the rule
-- (`reviews_one_per_author_idx`, and `submit_review` refuses a second). What
-- an author could not do was correct the one they wrote. `update_review` is
-- the only edit path, for the same reason `submit_review` is the only write
-- path: there is no update policy for authors, so the tier, the status and
-- the window are decided here and not by the caller.
--
-- Three days is long enough to fix a tension typed wrong or add a week of
-- play, and short enough that a review cannot be quietly rewritten months
-- later — after a price change, say — while keeping its original date and
-- its place in the Court Score. The window runs from `created_at`, which an
-- edit never moves.
--
-- A review staff rejected stays rejected: editing it is refused rather than
-- letting an edit republish it. The structural limits repeat `submit_review`'s;
-- `src/lib/guardrails/review-limits.test.ts` compares both functions with
-- `src/lib/review-standards.ts`.

alter table public.reviews add column if not exists updated_at timestamptz;

comment on column public.reviews.updated_at is
  'Last author edit through update_review; null when never edited. created_at never moves.';

create or replace function public.update_review(
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
  c_cooldown_seconds constant int := 60;
  c_edit_window_days constant int := 3;

  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_string text := btrim(coalesce(p_string_model, ''));
  v_review public.reviews%rowtype;
begin
  if v_uid is null then
    raise exception 'review_auth';
  end if;

  -- Lock the row: two concurrent edits cannot both pass the cooldown.
  select * into v_review
  from public.reviews rv
  where rv.racket_id = p_racket_id and rv.user_id = v_uid
  for update;

  if not found then
    raise exception 'review_not_found';
  end if;

  if v_review.status = 'rejected' then
    raise exception 'review_rejected';
  end if;

  if v_review.created_at <= now() - make_interval(days => c_edit_window_days) then
    raise exception 'review_edit_closed';
  end if;

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

  if v_body ~* '(https?://|www\.)' or v_string ~* '(https?://|www\.)' then
    raise exception 'review_links';
  end if;

  if coalesce(v_review.updated_at, v_review.created_at)
     > now() - make_interval(secs => c_cooldown_seconds) then
    raise exception 'review_cooldown';
  end if;

  update public.reviews set
    skill_level = p_skill_level::public.skill_level,
    format = p_format::public.match_format,
    position = p_position::public.court_position,
    string_model = v_string,
    tension_lbs = p_tension_lbs,
    power = p_power,
    speed = p_speed,
    control = p_control,
    comfort = p_comfort,
    -- A community review is written in one language; an edit may move it.
    body_en = case when p_locale = 'en' then v_body end,
    body_vi = case when p_locale = 'vi' then v_body end,
    updated_at = now()
    -- tier, status, user_id, author_name and created_at are never touched.
  where id = v_review.id;

  return v_review.id;
end;
$function$;

revoke all on function public.update_review(
  text, text, text, text, text, integer, integer, integer, integer, integer, text, text
) from public, anon;
grant execute on function public.update_review(
  text, text, text, text, text, integer, integer, integer, integer, integer, text, text
) to authenticated;

comment on function public.update_review(
  text, text, text, text, text, integer, integer, integer, integer, integer, text, text
) is
  'The only author edit path for reviews: own review only, within 3 days of posting, same rules as submit_review, never after rejection.';
