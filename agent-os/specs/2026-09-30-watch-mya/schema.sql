-- Watch Mya — PROPOSED Supabase schema. NOT APPLIED.
-- Apply only with the owner's approval (Supabase SQL editor, Preview/branch
-- database first). Until these tables exist, every ?type=computer* call
-- answers 503 not_configured and the Command Center says so.
--
-- Access: only the Command Center API touches these tables, with the
-- service-role key it already uses. RLS is enabled with NO policies, so
-- the anon key (and any browser) can't read or write them directly.

create table if not exists public.mya_computer_sessions (
  device_id           text primary key,                 -- 'windows' (one agent today)
  device_name         text,
  task_id             text,
  task                text,
  app                 text,                             -- current application / site
  step                text,                             -- current step
  status              text not null default 'idle'
                      check (status in ('idle','working','waiting','approval','completed','blocked','stopped')),
  control             text not null default 'paused'
                      check (control in ('mya','user','paused')),
  control_changed_at  timestamptz,
  control_changed_by  text check (control_changed_by in ('owner','agent')),
  approval_id         text,                             -- mya_approvals row a task waits on
  heartbeat_at        timestamptz,
  frame               text,                             -- latest downscaled JPEG/PNG/WebP data URL (≤ ~700 KB)
  frame_at            timestamptz,
  started_at          timestamptz,
  updated_at          timestamptz not null default now()
);

create table if not exists public.mya_computer_events (
  id         bigint generated always as identity primary key,
  device_id  text not null references public.mya_computer_sessions(device_id) on delete cascade,
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('step','action','control','approval','note')),
  text       text not null,
  app        text,
  by         text not null check (by in ('mya','owner','agent'))
);
create index if not exists mya_computer_events_device_at on public.mya_computer_events (device_id, at desc);

alter table public.mya_computer_sessions enable row level security;
alter table public.mya_computer_events enable row level security;

-- Keep updated_at honest.
create or replace function public.mya_computer_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists mya_computer_touch on public.mya_computer_sessions;
create trigger mya_computer_touch before update on public.mya_computer_sessions
  for each row execute function public.mya_computer_touch();
