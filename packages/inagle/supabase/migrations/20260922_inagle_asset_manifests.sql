create table if not exists public.inagle_asset_manifests (
  name text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.inagle_asset_manifests enable row level security;
drop policy if exists "inagle_asset_manifests_public_read" on public.inagle_asset_manifests;
create policy "inagle_asset_manifests_public_read"
  on public.inagle_asset_manifests for select using (true);
