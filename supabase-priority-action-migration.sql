alter table public.ideas
  add column if not exists priority text
    check (priority is null or priority in ('do_now', 'schedule', 'delegate', 'release')),
  add column if not exists action_completed boolean not null default false,
  add column if not exists blueprint jsonb;

alter table public.ideas
  drop constraint if exists ideas_action_completed_requires_next_step;

alter table public.ideas
  add constraint ideas_action_completed_requires_next_step
  check (not action_completed or char_length(btrim(next_step)) > 0);

alter table public.ideas
  drop constraint if exists ideas_blueprint_must_be_object;

alter table public.ideas
  add constraint ideas_blueprint_must_be_object
  check (blueprint is null or jsonb_typeof(blueprint) = 'object');
