create table if not exists public.inagle_basara (
  character_id varchar(50) primary key,
  name_romaji varchar(255),
  name_localised varchar(255),
  gender varchar(50),
  "position" varchar(50),
  alt_position varchar(50),
  element varchar(50),
  moveset text,
  alt_moveset text,
  passive text,
  kick integer,
  control integer,
  technique integer,
  pressure integer,
  physical integer,
  agility integer,
  intelligence integer
);
alter table public.inagle_basara enable row level security;
do $$ begin
  create policy "Public Read" on public.inagle_basara for select using (true);
exception when duplicate_object then null; end $$;
