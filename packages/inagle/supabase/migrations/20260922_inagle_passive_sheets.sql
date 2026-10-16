create table if not exists public.inagle_passive_sheets (
  id text not null,
  kind text not null check (kind in ('player', 'custom', 'coordinator')),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);

create index if not exists inagle_passive_sheets_kind_idx
  on public.inagle_passive_sheets (kind);

alter table public.inagle_passive_sheets enable row level security;
drop policy if exists "inagle passive sheets are publicly readable" on public.inagle_passive_sheets;
create policy "inagle passive sheets are publicly readable"
  on public.inagle_passive_sheets for select using (true);
