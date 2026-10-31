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
