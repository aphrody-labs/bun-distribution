-- Canonical SQL storage for parsed game configs.
-- SQLite cfgbin remains an extraction/development cache only. This migration
-- is additive and deliberately does not delete any existing dump or snapshot.
create table if not exists public.inagle_cfgbin (
  path text primary key,
  cpk text not null,
  size bigint not null default 0,
  parsed smallint not null default 1,
  format text,
  error text,
  data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inagle_cfgbin_cpk_idx on public.inagle_cfgbin (cpk);
create index if not exists inagle_cfgbin_path_parsed_idx
  on public.inagle_cfgbin (path) where parsed = 1;

alter table public.inagle_cfgbin enable row level security;
drop policy if exists inagle_cfgbin_public_read on public.inagle_cfgbin;
create policy inagle_cfgbin_public_read on public.inagle_cfgbin
  for select using (true);
