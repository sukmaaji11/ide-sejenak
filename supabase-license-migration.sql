create table if not exists public.sela_licenses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  product_id text not null default 'sela_plus_lifetime'
    check (product_id = 'sela_plus_lifetime'),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  source text not null default 'license_code',
  purchase_reference text,
  activated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.sela_licenses
  add column if not exists purchase_reference text;

alter table public.sela_licenses enable row level security;

drop policy if exists "Users can read their own license" on public.sela_licenses;
create policy "Users can read their own license"
  on public.sela_licenses for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.sela_licenses from anon, authenticated;
grant select on public.sela_licenses to authenticated;

create table if not exists public.sela_license_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  purchase_reference text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null
);

alter table public.sela_license_codes enable row level security;
revoke all on public.sela_license_codes from anon, authenticated;
grant insert on public.sela_license_codes to service_role;

create or replace function public.has_sela_plus_lifetime()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sela_licenses as license
    where license.user_id = (select auth.uid())
      and license.product_id = 'sela_plus_lifetime'
      and license.status = 'active'
  );
$$;

revoke all on function public.has_sela_plus_lifetime() from public;
grant execute on function public.has_sela_plus_lifetime() to authenticated;

create or replace function public.redeem_sela_plus_code(p_code_hash text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_user uuid;
  redeemed_code public.sela_license_codes%rowtype;
begin
  select users.id
  into locked_user
  from auth.users as users
  where users.id = p_user_id
  for update;

  if locked_user is null then
    raise exception 'User account not found.';
  end if;

  if exists (
    select 1
    from public.sela_licenses as license
    where license.user_id = p_user_id
      and license.product_id = 'sela_plus_lifetime'
      and license.status = 'active'
  ) then
    raise exception 'This account already has an active Sela Plus Lifetime license.';
  end if;

  update public.sela_license_codes as code
  set redeemed_at = now(),
      redeemed_by = p_user_id
  where code.code_hash = p_code_hash
    and code.redeemed_at is null
    and (code.expires_at is null or code.expires_at > now())
  returning code.* into redeemed_code;

  if not found then
    raise exception 'License code is invalid, expired, or already used.';
  end if;

  insert into public.sela_licenses (
    user_id,
    product_id,
    status,
    source,
    purchase_reference,
    activated_at
  )
  values (
    p_user_id,
    'sela_plus_lifetime',
    'active',
    'license_code',
    redeemed_code.purchase_reference,
    now()
  )
  on conflict (user_id) do update
  set product_id = excluded.product_id,
      status = excluded.status,
      source = excluded.source,
      purchase_reference = excluded.purchase_reference,
      activated_at = excluded.activated_at;

  return true;
end;
$$;

revoke all on function public.redeem_sela_plus_code(text, uuid) from public;
revoke all on function public.redeem_sela_plus_code(text, uuid) from anon, authenticated;
grant execute on function public.redeem_sela_plus_code(text, uuid) to service_role;

drop policy if exists "Sela Plus Lifetime required for ideas" on public.ideas;
create policy "Sela Plus Lifetime required for ideas"
  on public.ideas
  as restrictive
  for all
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_sela_plus_lifetime())
  )
  with check (
    (select auth.uid()) = user_id
    and (select public.has_sela_plus_lifetime())
  );

drop policy if exists "Users can read their own ideas" on public.ideas;
create policy "Users can read their own ideas"
  on public.ideas for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_sela_plus_lifetime())
  );

drop policy if exists "Users can create their own ideas" on public.ideas;
create policy "Users can create their own ideas"
  on public.ideas for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (select public.has_sela_plus_lifetime())
  );

drop policy if exists "Users can update their own ideas" on public.ideas;
create policy "Users can update their own ideas"
  on public.ideas for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_sela_plus_lifetime())
  )
  with check (
    (select auth.uid()) = user_id
    and (select public.has_sela_plus_lifetime())
  );

drop policy if exists "Users can delete their own ideas" on public.ideas;
create policy "Users can delete their own ideas"
  on public.ideas for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_sela_plus_lifetime())
  );
