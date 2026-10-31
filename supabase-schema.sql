create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  note text not null default '' check (char_length(note) <= 1000),
  category text not null default 'Personal'
    check (category in ('Personal', 'Kerja', 'Kreatif', 'Belajar', 'Lainnya')),
  status text not null default 'inbox'
    check (status in ('inbox', 'thinking', 'saved')),
  problem text not null default '' check (char_length(problem) <= 500),
  audience text not null default '' check (char_length(audience) <= 200),
  next_step text not null default '' check (char_length(next_step) <= 500),
  priority text check (priority is null or priority in ('do_now', 'schedule', 'delegate', 'release')),
  action_completed boolean not null default false
    constraint ideas_action_completed_requires_next_step
    check (not action_completed or char_length(btrim(next_step)) > 0),
  blueprint jsonb
    constraint ideas_blueprint_must_be_object
    check (blueprint is null or jsonb_typeof(blueprint) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ideas_user_created_at_idx
  on public.ideas (user_id, created_at desc);

alter table public.ideas enable row level security;

grant select, insert, update, delete on public.ideas to authenticated;

create or replace function public.set_ideas_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ideas_updated_at on public.ideas;
create trigger set_ideas_updated_at
  before update on public.ideas
  for each row execute function public.set_ideas_updated_at();

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

create table if not exists public.sela_ai_beta_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  request_count integer not null check (request_count between 1 and 10),
  primary key (user_id, usage_date)
);

alter table public.sela_ai_beta_usage enable row level security;
revoke all on public.sela_ai_beta_usage from anon, authenticated;
grant select, insert, update on public.sela_ai_beta_usage to service_role;

create or replace function public.reserve_sela_ai_beta_request(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_count integer;
begin
  if not exists (
    select 1
    from public.sela_licenses as license
    where license.user_id = p_user_id
      and license.product_id = 'sela_plus_lifetime'
      and license.status = 'active'
  ) then
    raise exception 'An active Sela Plus Lifetime license is required.';
  end if;

  insert into public.sela_ai_beta_usage (user_id, usage_date, request_count)
  values (p_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, usage_date) do update
  set request_count = public.sela_ai_beta_usage.request_count + 1
  where public.sela_ai_beta_usage.request_count < 10
  returning request_count into reserved_count;

  if not found then
    return -1;
  end if;

  return 10 - reserved_count;
end;
$$;

revoke all on function public.reserve_sela_ai_beta_request(uuid) from public;
revoke all on function public.reserve_sela_ai_beta_request(uuid) from anon, authenticated;
grant execute on function public.reserve_sela_ai_beta_request(uuid) to service_role;

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
