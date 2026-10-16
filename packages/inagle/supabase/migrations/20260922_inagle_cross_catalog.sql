create table if not exists public.inagle_cross_catalog (
  guid text primary key,
  key text not null,
  type text not null,
  bundle text not null default '',
  size bigint not null default 0,
  n_deps integer not null default 0,
  deps jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists inagle_cross_catalog_key_idx
  on public.inagle_cross_catalog (lower(key));
create index if not exists inagle_cross_catalog_type_idx
  on public.inagle_cross_catalog (type);

alter table public.inagle_cross_catalog enable row level security;
drop policy if exists "inagle_cross_catalog_public_read" on public.inagle_cross_catalog;
create policy "inagle_cross_catalog_public_read"
  on public.inagle_cross_catalog for select using (true);

drop policy if exists "inagle_cross_catalog_migrator_write" on public.inagle_cross_catalog;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rg') then
    execute 'create policy "inagle_cross_catalog_migrator_write" on public.inagle_cross_catalog for all to rg using (true) with check (true)';
  elsif exists (select 1 from pg_roles where rolname = 'achillea_migrator') then
    execute 'create policy "inagle_cross_catalog_migrator_write" on public.inagle_cross_catalog for all to achillea_migrator using (true) with check (true)';
  end if;
end
$$;
