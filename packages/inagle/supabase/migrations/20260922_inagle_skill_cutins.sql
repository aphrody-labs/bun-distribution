create table if not exists public.inagle_skill_cutins (
  skill_id text primary key,
  event_id_name text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists inagle_skill_cutins_event_idx
  on public.inagle_skill_cutins (event_id_name);

create table if not exists public.inagle_skill_cutin_assets (
  event_id_name text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.inagle_skill_cutins enable row level security;
alter table public.inagle_skill_cutin_assets enable row level security;

drop policy if exists "inagle_skill_cutins_public_read" on public.inagle_skill_cutins;
create policy "inagle_skill_cutins_public_read"
  on public.inagle_skill_cutins for select using (true);

drop policy if exists "inagle_skill_cutin_assets_public_read" on public.inagle_skill_cutin_assets;
create policy "inagle_skill_cutin_assets_public_read"
  on public.inagle_skill_cutin_assets for select using (true);
