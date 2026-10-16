create table if not exists public.inagle_game_text (
  hash_id text not null,
  locale text not null,
  category text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (hash_id, locale)
);

create index if not exists inagle_game_text_category_locale_idx
  on public.inagle_game_text (category, locale, hash_id);
create index if not exists inagle_game_text_value_idx
  on public.inagle_game_text (lower(value));

alter table public.inagle_game_text enable row level security;
drop policy if exists "inagle_game_text_public_read" on public.inagle_game_text;
create policy "inagle_game_text_public_read"
  on public.inagle_game_text for select using (true);

drop policy if exists "inagle_game_text_migrator_write" on public.inagle_game_text;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'rg') then
    execute 'create policy "inagle_game_text_migrator_write" on public.inagle_game_text for all to rg using (true) with check (true)';
  elsif exists (select 1 from pg_roles where rolname = 'achillea_migrator') then
    execute 'create policy "inagle_game_text_migrator_write" on public.inagle_game_text for all to achillea_migrator using (true) with check (true)';
  end if;
end
$$;
