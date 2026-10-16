create table if not exists public.inagle_cpk_index (
  path text primary key,
  top text not null,
  sub text not null default '',
  dir text not null,
  name text not null,
  ext text not null default '',
  cpk text not null,
  depth integer not null,
  updated_at timestamptz not null default now()
);

create index if not exists inagle_cpk_index_dir_name_idx
  on public.inagle_cpk_index (dir, name);
create index if not exists inagle_cpk_index_top_sub_idx
  on public.inagle_cpk_index (top, sub);
create index if not exists inagle_cpk_index_name_idx
  on public.inagle_cpk_index (lower(name));

alter table public.inagle_cpk_index enable row level security;
drop policy if exists "inagle_cpk_index_public_read" on public.inagle_cpk_index;
create policy "inagle_cpk_index_public_read"
  on public.inagle_cpk_index for select using (true);

drop policy if exists "inagle_cpk_index_migrator_write" on public.inagle_cpk_index;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rg') then
    execute 'create policy "inagle_cpk_index_migrator_write" on public.inagle_cpk_index for all to rg using (true) with check (true)';
  elsif exists (select 1 from pg_roles where rolname = 'achillea_migrator') then
    execute 'create policy "inagle_cpk_index_migrator_write" on public.inagle_cpk_index for all to achillea_migrator using (true) with check (true)';
  end if;
end
$$;
