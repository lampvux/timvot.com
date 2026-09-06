-- Account persistence and seller application review.

create type seller_business_type as enum ('individual', 'business');
create type seller_application_status as enum ('pending', 'approved', 'rejected');

create table seller_applications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users on delete cascade,
  business_type     seller_business_type not null,
  business_name     text not null check (char_length(business_name) between 2 and 120),
  contact_name      text not null check (char_length(contact_name) between 2 and 100),
  phone             text not null check (char_length(phone) between 7 and 24),
  city              text not null check (char_length(city) between 2 and 80),
  address           text not null check (char_length(address) between 5 and 240),
  tax_id            text check (tax_id is null or char_length(tax_id) <= 40),
  website_url       text check (
    website_url is null
    or (char_length(website_url) <= 300 and website_url ~* '^https?://')
  ),
  years_in_business int not null default 0 check (years_in_business between 0 and 100),
  inventory_summary text not null check (char_length(inventory_summary) between 20 and 1200),
  status            seller_application_status not null default 'pending',
  reviewer_id       uuid references auth.users on delete set null,
  review_notes      text,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index seller_applications_status_idx
  on seller_applications (status, created_at);

create unique index sellers_owner_unique_idx
  on sellers (owner_id) where owner_id is not null;

alter table seller_applications enable row level security;

create policy "users read their own seller application"
  on seller_applications for select to authenticated
  using (user_id = auth.uid());

create policy "users create their own seller application"
  on seller_applications for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

create policy "users resubmit editable seller applications"
  on seller_applications for update to authenticated
  using (user_id = auth.uid() and status in ('pending', 'rejected'))
  with check (user_id = auth.uid() and status = 'pending');

create policy "staff review seller applications"
  on seller_applications for all to authenticated
  using (can_manage_content()) with check (can_manage_content());

revoke insert, update on table seller_applications from authenticated;
grant select on table seller_applications to authenticated;
grant insert (
  user_id,
  business_type,
  business_name,
  contact_name,
  phone,
  city,
  address,
  tax_id,
  website_url,
  years_in_business,
  inventory_summary
) on table seller_applications to authenticated;
grant update (
  business_type,
  business_name,
  contact_name,
  phone,
  city,
  address,
  tax_id,
  website_url,
  years_in_business,
  inventory_summary,
  status,
  updated_at
) on table seller_applications to authenticated;

-- Approval is one database operation: the application, seller ownership and
-- account role cannot drift apart if one of the writes fails.
create function review_seller_application(
  application_id uuid,
  decision seller_application_status,
  notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  application seller_applications%rowtype;
  seller_key text;
begin
  if not can_manage_content() then
    raise exception 'Only active staff can review seller applications';
  end if;

  if decision not in ('approved', 'rejected') then
    raise exception 'Review decision must be approved or rejected';
  end if;

  select * into application
  from seller_applications
  where id = application_id
  for update;

  if not found then
    raise exception 'Seller application not found';
  end if;

  if application.status <> 'pending' then
    raise exception 'Only pending seller applications can be reviewed';
  end if;

  if decision = 'approved' then
    seller_key := 'seller-' || left(replace(application.user_id::text, '-', ''), 16);

    insert into sellers (
      id,
      slug,
      name,
      tier,
      city,
      rating,
      orders_count,
      dispute_rate,
      since,
      owner_id
    ) values (
      seller_key,
      seller_key,
      application.business_name,
      'new',
      application.city,
      0,
      0,
      0,
      extract(year from now())::int,
      application.user_id
    )
    on conflict (owner_id) where owner_id is not null do update
      set name = excluded.name,
          city = excluded.city;

    update profiles
    set role = 'seller'
    where id = application.user_id;
  end if;

  update seller_applications
  set status = decision,
      reviewer_id = auth.uid(),
      review_notes = nullif(trim(notes), ''),
      reviewed_at = now(),
      updated_at = now()
  where id = application_id;
end;
$$;

revoke all on function review_seller_application(uuid, seller_application_status, text)
  from public;
grant execute on function review_seller_application(uuid, seller_application_status, text)
  to authenticated;

-- Listing privileges require the role set by the approval function, in
-- addition to ownership of the seller row.
drop policy "sellers manage their own offers" on offers;
create policy "approved sellers manage their own offers" on offers for all
  using (
    exists (
      select 1
      from sellers s
      join profiles p on p.id = s.owner_id
      where s.id = offers.seller_id
        and s.owner_id = auth.uid()
        and p.role = 'seller'
    )
  )
  with check (
    exists (
      select 1
      from sellers s
      join profiles p on p.id = s.owner_id
      where s.id = offers.seller_id
        and s.owner_id = auth.uid()
        and p.role = 'seller'
    )
  );

drop policy "sellers manage their own string offers" on string_offers;
create policy "approved sellers manage their own string offers"
  on string_offers for all
  using (
    exists (
      select 1
      from sellers s
      join profiles p on p.id = s.owner_id
      where s.id = string_offers.seller_id
        and s.owner_id = auth.uid()
        and p.role = 'seller'
    ) or is_admin()
  )
  with check (
    exists (
      select 1
      from sellers s
      join profiles p on p.id = s.owner_id
      where s.id = string_offers.seller_id
        and s.owner_id = auth.uid()
        and p.role = 'seller'
    ) or is_admin()
  );

drop policy "sellers update their own storefront" on sellers;
create policy "approved sellers update their own storefront" on sellers for update
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'seller'
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'seller'
    )
  );

-- A seller can prepare a new offer for staff review and edit commercial data
-- later, but cannot publish/promote it by writing privileged columns directly.
create function enforce_seller_offer_review() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and not can_manage_content() then
    if tg_op = 'INSERT' and (new.status <> 'review' or new.promoted) then
      raise exception 'Seller offers must start in review and cannot self-promote';
    end if;

    if tg_op = 'UPDATE'
      and (new.status is distinct from old.status or new.promoted is distinct from old.promoted)
    then
      raise exception 'Only staff can change offer publication or promotion state';
    end if;
  end if;
  return new;
end;
$$;

create trigger seller_offer_review_guard
  before insert or update on offers
  for each row execute function enforce_seller_offer_review();

create function enforce_seller_string_offer_review() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and not can_manage_content() then
    if tg_op = 'INSERT' and new.status <> 'review' then
      raise exception 'Seller offers must start in review';
    end if;

    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'Only staff can change offer publication state';
    end if;
  end if;
  return new;
end;
$$;

create trigger seller_string_offer_review_guard
  before insert or update on string_offers
  for each row execute function enforce_seller_string_offer_review();

-- Store owners edit public copy only. Trust tier, reputation, ownership and
-- URL identity remain staff-controlled even though they share one table.
create function protect_seller_trust_fields() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and not can_manage_content()
    and (
      new.id is distinct from old.id
      or new.slug is distinct from old.slug
      or new.tier is distinct from old.tier
      or new.rating is distinct from old.rating
      or new.orders_count is distinct from old.orders_count
      or new.dispute_rate is distinct from old.dispute_rate
      or new.since is distinct from old.since
      or new.owner_id is distinct from old.owner_id
    )
  then
    raise exception 'Only staff can change seller trust and ownership fields';
  end if;
  return new;
end;
$$;

create trigger seller_trust_fields_guard
  before update on sellers
  for each row execute function protect_seller_trust_fields();
