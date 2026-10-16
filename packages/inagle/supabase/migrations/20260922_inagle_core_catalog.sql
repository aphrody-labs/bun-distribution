-- Canonical SQL ownership for the two core Inagle catalogue projections.
-- The tables already exist in deployed databases; IF NOT EXISTS keeps this
-- migration safe for both fresh and existing PostgreSQL installations.

create table if not exists public.inagle_characters (
  id text primary key,
  chara_id text,
  internal_code text,
  name_fr text,
  name_en text,
  name_ja text,
  description_fr text,
  description_en text,
  description_ja text,
  rarity text,
  rarity_code integer,
  rarity_label text,
  element_id integer,
  element text,
  position_id integer,
  "position" text,
  gender text,
  image_url text,
  sheet_data jsonb,
  stats jsonb,
  skills jsonb,
  teams jsonb,
  series text,
  slug text,
  team_id text,
  stat_frappe integer default 0,
  stat_controle integer default 0,
  stat_technique integer default 0,
  stat_pression integer default 0,
  stat_physique integer default 0,
  stat_agilite integer default 0,
  stat_intelligence integer default 0,
  stat_total integer default 0,
  constellation text,
  constellation_index integer,
  zukan_hash text,
  created_at timestamptz default now(),
  zukan_order integer,
  base_slug text,
  control_type text,
  data jsonb,
  is_controllable boolean default false,
  game_appearances text[],
  model_id text,
  stat_lv1_frappe integer default 0,
  stat_lv1_controle integer default 0,
  stat_lv1_technique integer default 0,
  stat_lv1_pression integer default 0,
  stat_lv1_physique integer default 0,
  stat_lv1_agilite integer default 0,
  stat_lv1_intelligence integer default 0,
  updated_at timestamptz default now(),
  hero_type text
);

create table if not exists public.inagle_skills (
  id text primary key,
  internal_code text,
  name_fr text,
  name_en text,
  name_ja text,
  description_fr text,
  description_en text,
  description_ja text,
  category_id integer,
  element_id integer,
  power_min integer,
  power_max integer,
  tension_cost integer,
  image_url text,
  video_url text,
  poster_url text,
  is_hyper boolean default false,
  sheet_data jsonb,
  created_at timestamptz default now(),
  category text,
  data jsonb,
  element text,
  evolution_type text,
  foul_rate integer default 0,
  growth_type text,
  hash_id text,
  is_eldorado boolean default false,
  partner_count integer default 0,
  recast_time integer default 0,
  tp_cost integer default 0,
  skill_effect_bit_flag integer default 0,
  tags text[],
  updated_at timestamptz default now()
);

create index if not exists idx_inagle_characters_names on public.inagle_characters (name_fr, name_en, name_ja);
create index if not exists idx_inagle_characters_internal_code on public.inagle_characters (internal_code);
create index if not exists idx_inagle_skills_names on public.inagle_skills (name_fr, name_en, name_ja);
create index if not exists idx_inagle_skills_internal_code on public.inagle_skills (internal_code);

alter table public.inagle_characters enable row level security;
alter table public.inagle_skills enable row level security;

do $$ begin
  create policy "Public Read" on public.inagle_characters for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Public Read" on public.inagle_skills for select using (true);
exception when duplicate_object then null; end $$;
