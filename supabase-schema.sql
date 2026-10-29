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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ideas_user_created_at_idx
  on public.ideas (user_id, created_at desc);

alter table public.ideas enable row level security;

drop policy if exists "Users can read their own ideas" on public.ideas;
create policy "Users can read their own ideas"
  on public.ideas for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own ideas" on public.ideas;
create policy "Users can create their own ideas"
  on public.ideas for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own ideas" on public.ideas;
create policy "Users can update their own ideas"
  on public.ideas for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own ideas" on public.ideas;
create policy "Users can delete their own ideas"
  on public.ideas for delete
  to authenticated
  using ((select auth.uid()) = user_id);

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
