create type string_feel as enum ('soft', 'medium', 'hard');

create table strings (
  id text primary key,
  slug text not null,
  brand_id text not null references brands on delete restrict,
  name text not null,
  gauge_mm numeric(3,2) not null check (gauge_mm between 0.50 and 0.90),
  cross_gauge_mm numeric(3,2) check (cross_gauge_mm between 0.50 and 0.90),
  feel string_feel not null,
  durability int not null check (durability between 1 and 5),
  repulsion int not null check (repulsion between 1 and 5),
  control int not null check (control between 1 and 5),
  play_style_tags play_style[] not null default '{}',
  skill_levels skill_level[] not null default '{}',
  summary_en text,
  summary_vi text,
  created_at timestamptz not null default now(),
  unique (brand_id, slug)
);

create table string_offers (
  id text primary key,
  string_id text not null references strings on delete cascade,
  seller_id text not null references sellers on delete cascade,
  price bigint not null check (price >= 0),
  currency text not null default 'VND',
  qty_available int not null default 0 check (qty_available >= 0),
  status offer_status not null default 'review',
  updated_at timestamptz not null default now(),
  unique (string_id, seller_id)
);

create table string_price_points (
  id bigserial primary key,
  string_id text not null references strings on delete cascade,
  observed_on date not null,
  price bigint not null check (price >= 0),
  unique (string_id, observed_on)
);

create index strings_brand_idx on strings (brand_id);
create index string_offers_product_price_idx on string_offers (string_id, price);
create index string_price_points_product_date_idx on string_price_points (string_id, observed_on);

alter table strings enable row level security;
alter table string_offers enable row level security;
alter table string_price_points enable row level security;

create policy "string catalogue is public" on strings for select using (true);
create policy "live string offers are public" on string_offers for select using (status = 'live' or is_admin());
create policy "string price history is public" on string_price_points for select using (true);

create policy "sellers manage their own string offers" on string_offers for all
  using (exists (select 1 from sellers s where s.id = string_offers.seller_id and s.owner_id = auth.uid()) or is_admin())
  with check (exists (select 1 from sellers s where s.id = string_offers.seller_id and s.owner_id = auth.uid()) or is_admin());

create policy "admins manage string catalogue" on strings for all using (is_admin()) with check (is_admin());
create policy "admins manage string history" on string_price_points for all using (is_admin()) with check (is_admin());
