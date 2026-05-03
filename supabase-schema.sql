create table if not exists public.checkin_events (
  id uuid primary key default gen_random_uuid(),
  experience_id text not null,
  event_name text not null,
  event_date date,
  status text not null default 'open',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (experience_id, event_date)
);

create table if not exists public.checkin_reservations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.checkin_events(id) on delete cascade,
  dws_id text,
  section text not null default 'bookings',
  payload jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, dws_id)
);

create index if not exists checkin_reservations_event_id_idx on public.checkin_reservations(event_id);
create index if not exists checkin_reservations_dws_id_idx on public.checkin_reservations(dws_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_checkin_events_updated_at on public.checkin_events;
create trigger set_checkin_events_updated_at
before update on public.checkin_events
for each row execute function public.set_updated_at();

drop trigger if exists set_checkin_reservations_updated_at on public.checkin_reservations;
create trigger set_checkin_reservations_updated_at
before update on public.checkin_reservations
for each row execute function public.set_updated_at();
