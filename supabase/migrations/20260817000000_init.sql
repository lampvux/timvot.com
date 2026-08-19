-- ============================================================
-- Shuttlecraft — catalogue, marketplace, reviews
--
-- Catalogue entities use human-readable text primary keys ("r-astrox-88d-pro").
-- They are stable, they make seed files diffable, and a racket id is a thing
-- people paste into a support ticket. User-owned rows use uuid and reference
-- auth.users.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------ enums

create type shaft_flex as enum ('extra-stiff', 'stiff', 'medium', 'flexible');
create type frame_shape as enum ('isometric', 'conventional', 'aero-box');
create type weight_class as enum ('2U', '3U', '4U', '5U');
create type grip_size as enum ('G4', 'G5', 'G6');
create type skill_level as enum ('beginner', 'intermediate', 'advanced');
create type play_style as enum ('attack', 'all-round', 'speed', 'defence', 'control');
create type offer_condition as enum ('new', 'open-box', 'used-excellent', 'used-good', 'used-fair');
create type offer_status as enum ('live', 'paused', 'review');
create type seller_tier as enum ('authorised', 'verified', 'new');
create type review_tier as enum ('purchase', 'owner', 'community');
create type review_status as enum ('pending', 'published', 'rejected');
create type match_format as enum ('singles', 'doubles');
create type court_position as enum ('net', 'mid', 'rear');
create type app_role as enum ('user', 'seller', 'admin');

-- ------------------------------------------------------------ profiles

create table profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  skill_level  skill_level,
  locale       text not null default 'vi',
  role         app_role not null default 'user',
  created_at   timestamptz not null default now()
);

-- Every new auth user gets a profile. Without this, RBAC has nothing to read.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ------------------------------------------------------------ catalogue

create table brands (
  id      text primary key,
  slug    text not null unique,
  name    text not null,
  country text
);

create table rackets (
  id                   text primary key,
  slug                 text not null unique,
  brand_id             text not null references brands on delete restrict,
  name                 text not null,
  release_year         int  not null,

  balance_point_mm     int  not null check (balance_point_mm between 260 and 320),
  shaft_flex           shaft_flex not null,
  shaft_diameter_mm    numeric(3,1) not null,
  frame_shape          frame_shape not null,
  frame_material       text[] not null default '{}',
  max_tension_min_lbs  int not null,
  max_tension_max_lbs  int not null,
  length_mm            int not null default 675,
  string_pattern       text not null,
  msrp                 bigint not null check (msrp >= 0),
  currency             text not null default 'VND',
  play_style_tags      play_style[] not null default '{}',
  skill_level          skill_level not null,
  hero_image_url       text,

  summary_en           text,
  summary_vi           text,

  created_at           timestamptz not null default now(),
  check (max_tension_max_lbs >= max_tension_min_lbs)
);

create index rackets_brand_idx on rackets (brand_id);
create index rackets_balance_idx on rackets (balance_point_mm);
create index rackets_flex_idx on rackets (shaft_flex);

-- Postgres full-text search for v1; swap for Typesense only if facets slow down.
create index rackets_search_idx on rackets
  using gin (to_tsvector('simple', name));

create table racket_variants (
  id           text primary key,
  racket_id    text not null references rackets on delete cascade,
  weight_class weight_class not null,
  weight_grams int not null,
  grip_size    grip_size not null,
  colourway    text,
  sku          text not null,
  unique (racket_id, weight_class, grip_size)
);

create index racket_variants_racket_idx on racket_variants (racket_id);

-- ------------------------------------------------------------ sellers

create table sellers (
  id           text primary key,
  slug         text not null unique,
  name         text not null,
  tier         seller_tier not null default 'new',
  city         text not null,
  rating       numeric(2,1) not null default 0,
  orders_count int not null default 0,
  dispute_rate numeric(5,4) not null default 0,
  since        int not null,
  about_en     text,
  about_vi     text,
  owner_id     uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

create index sellers_owner_idx on sellers (owner_id);

-- ------------------------------------------------------------ offers

-- Sellers do not create products. They attach an offer to a catalogued
-- variant. This is the decision that keeps the catalogue clean.
create table offers (
  id                 text primary key,
  variant_id         text not null references racket_variants on delete cascade,
  racket_id          text not null references rackets on delete cascade,
  seller_id          text not null references sellers on delete cascade,
  price              bigint not null check (price >= 0),
  currency           text not null default 'VND',
  qty_available      int not null default 0 check (qty_available >= 0),
  condition          offer_condition not null default 'new',
  warranty_months    int not null default 0,
  includes_stringing boolean not null default false,
  ships_from         text,
  lead_time_days     int not null default 1,
  promoted           boolean not null default false,
  status             offer_status not null default 'review',
  updated_at         timestamptz not null default now()
);

create index offers_racket_idx on offers (racket_id, status);
create index offers_seller_idx on offers (seller_id);
create index offers_variant_price_idx on offers (variant_id, price);

-- ------------------------------------------------------------ price history

create table price_points (
  id          bigserial primary key,
  variant_id  text not null references racket_variants on delete cascade,
  observed_on date not null,
  price       bigint not null check (price >= 0),
  unique (variant_id, observed_on)
);

create index price_points_variant_idx on price_points (variant_id, observed_on);

-- ------------------------------------------------------------ reviews

create table reviews (
  id           text primary key default gen_random_uuid()::text,
  racket_id    text not null references rackets on delete cascade,
  user_id      uuid references auth.users on delete set null,
  author_name  text not null,
  tier         review_tier not null default 'community',

  -- Reviewer context is mandatory. "Great racket, 5 stars" is worthless.
  skill_level  skill_level not null,
  format       match_format not null,
  position     court_position not null,
  string_model text not null,
  tension_lbs  int not null check (tension_lbs between 15 and 35),

  power        numeric(2,1) not null check (power between 1 and 5),
  speed        numeric(2,1) not null check (speed between 1 and 5),
  control      numeric(2,1) not null check (control between 1 and 5),
  comfort      numeric(2,1) not null check (comfort between 1 and 5),

  body_en      text,
  body_vi      text,
  status       review_status not null default 'pending',
  created_at   timestamptz not null default now()
);

create index reviews_racket_idx on reviews (racket_id, status);

-- ------------------------------------------------------------ guides

create table guides (
  slug         text primary key,
  title_en     text not null,
  title_vi     text not null,
  excerpt_en   text,
  excerpt_vi   text,
  body_en      text,
  body_vi      text,
  read_minutes int not null default 5,
  tone         text not null default 'default',
  published    boolean not null default true
);

-- ------------------------------------------------------------ watchlist

create table watchlist (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  variant_id   text not null references racket_variants on delete cascade,
  target_price bigint,
  created_at   timestamptz not null default now(),
  unique (user_id, variant_id)
);

create index watchlist_user_idx on watchlist (user_id);

-- ============================================================
-- ROW LEVEL SECURITY
--
-- The catalogue is public and read-only to everyone. Everything a seller or
-- a buyer owns is writable only by them. Nothing grants a seller write access
-- to a racket record — that is the architectural line the marketplace rests on.
-- ============================================================

alter table brands           enable row level security;
alter table rackets          enable row level security;
alter table racket_variants  enable row level security;
alter table sellers          enable row level security;
alter table offers           enable row level security;
alter table price_points     enable row level security;
alter table reviews          enable row level security;
alter table guides           enable row level security;
alter table watchlist        enable row level security;
alter table profiles         enable row level security;

-- Public catalogue reads
create policy "catalogue is public" on brands          for select using (true);
create policy "catalogue is public" on rackets         for select using (true);
create policy "catalogue is public" on racket_variants for select using (true);
create policy "catalogue is public" on sellers         for select using (true);
create policy "catalogue is public" on price_points    for select using (true);
create policy "published guides are public" on guides  for select using (published);

-- Only live offers are visible to the public; a seller sees all of their own.
create policy "live offers are public" on offers for select
  using (
    status = 'live'
    or exists (
      select 1 from sellers s
      where s.id = offers.seller_id and s.owner_id = auth.uid()
    )
    or is_admin()
  );

create policy "sellers manage their own offers" on offers for all
  using (
    exists (
      select 1 from sellers s
      where s.id = offers.seller_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from sellers s
      where s.id = offers.seller_id and s.owner_id = auth.uid()
    )
  );

create policy "admins manage offers" on offers for all
  using (is_admin()) with check (is_admin());

-- A seller edits their own storefront copy, never their own tier.
create policy "sellers update their own storefront" on sellers for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "admins manage sellers" on sellers for all
  using (is_admin()) with check (is_admin());

-- Catalogue writes are admin-only. Sellers attach offers, they do not add rackets.
create policy "admins manage brands"   on brands          for all using (is_admin()) with check (is_admin());
create policy "admins manage rackets"  on rackets         for all using (is_admin()) with check (is_admin());
create policy "admins manage variants" on racket_variants for all using (is_admin()) with check (is_admin());
create policy "admins manage prices"   on price_points    for all using (is_admin()) with check (is_admin());
create policy "admins manage guides"   on guides          for all using (is_admin()) with check (is_admin());

-- Reviews: published ones are public, authors see and edit their own drafts.
create policy "published reviews are public" on reviews for select
  using (status = 'published' or user_id = auth.uid() or is_admin());

create policy "users write their own reviews" on reviews for insert
  to authenticated with check (user_id = auth.uid());

create policy "users edit their own reviews" on reviews for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "admins moderate reviews" on reviews for all
  using (is_admin()) with check (is_admin());

-- Watchlist and price alerts are private, full stop.
create policy "watchlist is private" on watchlist for all
  to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Profiles
create policy "profiles are self-readable" on profiles for select
  using (id = auth.uid() or is_admin());

create policy "profiles are self-writable" on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
