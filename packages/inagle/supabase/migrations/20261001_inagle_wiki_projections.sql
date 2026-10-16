-- Canonical SQL schema for Inagle / Azalée / NIE Wiki projections.
-- Safe to replay idempotently on existing and fresh PostgreSQL databases.

-- 1. inagle_teams
create table if not exists public.inagle_teams (
  id text primary key,
  internal_code text,
  name_fr text,
  name_en text,
  name_ja text,
  emblems jsonb,
  kits jsonb,
  members jsonb,
  seasons jsonb,
  data jsonb,
  sheet_data jsonb,
  country_code text,
  emblem_url text,
  series text,
  region text,
  description_fr text,
  description_en text,
  description_ja text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_inagle_teams_internal_code on public.inagle_teams (internal_code);
create index if not exists idx_inagle_teams_names on public.inagle_teams (name_fr, name_en, name_ja);

-- 2. inagle_uniforms
create table if not exists public.inagle_uniforms (
  name_id text primary key,
  model_count integer default 0,
  model_start integer default 0,
  type_id integer default 0,
  models jsonb,
  data jsonb,
  updated_at timestamptz default now()
);

-- 3. inagle_items
create table if not exists public.inagle_items (
  id text primary key,
  item_db_id text,
  internal_code text,
  name_fr text,
  name_en text,
  name_ja text,
  description_fr text,
  description_en text,
  description_ja text,
  category text,
  category_id integer,
  rarity integer,
  price integer,
  buy_price integer,
  sell_price integer,
  image_url text,
  icon text,
  shops jsonb,
  shop_names text[],
  effect jsonb,
  sheet_data jsonb,
  data jsonb,
  stat_boost_1 text,
  stat_boost_2 text,
  boost_type text,
  effect_value integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_inagle_items_category on public.inagle_items (category);
create index if not exists idx_inagle_items_internal_code on public.inagle_items (internal_code);

-- 4. inagle_passives
create table if not exists public.inagle_passives (
  id text primary key,
  internal_code text,
  name_fr text,
  name_en text,
  name_ja text,
  description_fr text,
  description_en text,
  description_ja text,
  type text,
  category text,
  boost_type text,
  stat_boost text,
  effect_value text,
  image_url text,
  data jsonb,
  sheet_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5. inagle_manager_passives & inagle_custom_passives
create table if not exists public.inagle_manager_passives (
  id text primary key,
  coord_common text,
  coord_legendary text,
  manager_common text,
  manager_legendary text,
  requirements text,
  stat text,
  name_fr text,
  name_en text,
  data jsonb
);

create table if not exists public.inagle_custom_passives (
  id text primary key,
  name_fr text,
  name_en text,
  data jsonb
);

create table if not exists public.inagle_passive_scaling (
  id text primary key,
  requirement text,
  stat_affected text,
  legendary_low integer,
  legendary_high integer,
  top_low integer,
  top_high integer,
  advanced_low integer,
  advanced_high integer,
  growing_low integer,
  growing_high integer,
  common_low integer,
  common_high integer
);

create table if not exists public.inagle_passive_generation (
  id bigint generated always as identity primary key,
  passive_id text not null,
  no integer not null,
  requirement text,
  stat text
);

-- 6. inagle_shops
create table if not exists public.inagle_shops (
  id text primary key,
  shop_id integer,
  name_fr text,
  name_en text,
  name_ja text,
  category text,
  image_url text,
  internal_code text,
  slot_index integer,
  items jsonb,
  data jsonb
);
create index if not exists idx_inagle_shops_shop_id on public.inagle_shops (shop_id);

-- 7. inagle_stadiums
create table if not exists public.inagle_stadiums (
  id text primary key,
  field_index integer,
  image_path text,
  condition text,
  name_fr text,
  name_en text,
  name_ja text,
  data jsonb
);

-- 8. inagle_trophies
create table if not exists public.inagle_trophies (
  id text primary key,
  trophy_id text,
  code text,
  category text,
  group_name text,
  name_fr text,
  name_en text,
  name_ja text,
  desc_fr text,
  desc_en text,
  desc_ja text,
  data jsonb
);
create index if not exists idx_inagle_trophies_code on public.inagle_trophies (code);

-- 9. inagle_quests
create table if not exists public.inagle_quests (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  description_fr text,
  description_en text,
  description_ja text,
  type text,
  phase text,
  display_text text,
  image_url text,
  data jsonb,
  updated_at timestamptz default now()
);

-- 10. inagle_formations
create table if not exists public.inagle_formations (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  description_fr text,
  description_en text,
  description_ja text,
  type text,
  image_url text,
  emblem_url text,
  data jsonb,
  updated_at timestamptz default now()
);

-- 11. inagle_tactics & inagle_special_tactics
create table if not exists public.inagle_tactics (
  id text primary key,
  internal_code text,
  name text,
  name_fr text,
  name_ja text,
  effect1 text,
  effect2 text,
  effect3 text,
  duration integer,
  cooldown integer,
  shop text,
  description_fr text,
  description_en text,
  description_ja text,
  element_id integer,
  element text,
  power integer,
  recast_time integer,
  partner_count integer,
  partner_ids text,
  image_url text,
  data jsonb
);

create table if not exists public.inagle_special_tactics (
  id text primary key,
  internal_code text,
  name_en text,
  name_fr text,
  name_ja text,
  description_fr text,
  description_en text,
  description_ja text,
  power integer,
  recast_time integer,
  element_id integer,
  element text,
  partner_count integer,
  partner_ids text,
  data jsonb
);

-- 12. inagle_gallery
create table if not exists public.inagle_gallery (
  id text primary key,
  img_path text,
  thumb_path text,
  need_token_num integer,
  flg_no integer,
  category text,
  name_fr text,
  name_en text,
  name_ja text,
  data jsonb,
  updated_at timestamptz default now()
);
create index if not exists idx_inagle_gallery_flg_no on public.inagle_gallery (flg_no);

-- 13. inagle_capsules & inagle_costumes & inagle_constellations
create table if not exists public.inagle_capsules (
  id text primary key,
  prize_data jsonb,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_costumes (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  category text,
  image_url text,
  data jsonb
);

create table if not exists public.inagle_constellations (
  id text primary key,
  index integer,
  name_fr text,
  name_en text,
  name_ja text,
  characters jsonb,
  rates jsonb,
  data jsonb
);

-- 14. inagle_coordinators
create table if not exists public.inagle_coordinators (
  id text primary key,
  name_en text,
  name_fr text,
  name_ja text,
  name_localised text,
  name_romaji text,
  internal_code text,
  role text,
  gender text,
  element text,
  playstyle text,
  description_fr text,
  description_en text,
  image_url text,
  data jsonb,
  sheet_data jsonb
);

-- 15. Auras, Keshins, Souls, Miximax
create table if not exists public.inagle_auras (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  aura_type text,
  internal_code text,
  element text,
  power integer,
  data jsonb,
  sheet_data jsonb
);

create table if not exists public.inagle_keshins (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  element text,
  position text,
  image_url text,
  model_code text,
  data jsonb,
  sheet_data jsonb
);

create table if not exists public.inagle_souls (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  description_fr text,
  description_en text,
  description_ja text,
  type text,
  image_url text,
  data jsonb,
  sheet_data jsonb,
  asset_code text,
  sub_type text,
  element_id integer,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_miximax (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  data jsonb
);

create table if not exists public.inagle_override_skills (
  id text primary key,
  chara_param_id text,
  skill_id text,
  slot_index integer,
  conditions jsonb,
  data jsonb
);

-- 16. Drops tables
create table if not exists public.inagle_drops_tables (
  table_id text primary key,
  entries jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_drops_battles (
  battle_group_id integer primary key,
  item_table_id integer,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_drops_treasures (
  id text primary key,
  map_id text,
  pos jsonb,
  items jsonb,
  data jsonb,
  updated_at timestamptz default now()
);

-- 17. Additional projections (emblems, missions, super_tactics, tricks, etc.)
create table if not exists public.inagle_emblems (
  emblem_id text primary key,
  emblem_name text,
  small_file_path text,
  small_tex_name text,
  large_file_path text,
  large_tex_name text,
  base_path text,
  is_template boolean default false,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_missions (
  mission_id text primary key,
  code text,
  name_id text,
  name_en text,
  name_fr text,
  name_ja text,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_super_tactics (
  id text primary key,
  kind text,
  idx integer,
  crc_id text,
  conditions jsonb,
  data jsonb,
  updated_at timestamptz default now()
);
create index if not exists idx_inagle_super_tactics_crc on public.inagle_super_tactics (crc_id);

create table if not exists public.inagle_tricks (
  id text primary key,
  trick_id_name text,
  event_id text,
  event_id_name text,
  fail_event_id text,
  fail_event_id_name text,
  name_ja text,
  trick_category text,
  trick_category_name text,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_opponent_teams (
  id text primary key,
  team_id text,
  name_fr text,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_telop_waza (
  skill_id text primary key,
  blank_left_index integer,
  blank_right_index integer,
  eldorado_id text,
  left_blanks jsonb,
  right_blanks jsonb,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_video_waza (
  id text primary key,
  event_id text,
  menu_id text,
  caption_id text,
  movie_path text,
  bgm_name text,
  fede_in_time integer,
  fede_out_time integer,
  staffroll_data_name text,
  caption_name text,
  caption_start_frame integer,
  caption_end_frame integer,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_skill_technic (
  id text primary key,
  win_sub_motion_name_crc text,
  lose_sub_motion_name_crc text,
  lose_type integer,
  formation_type integer,
  formation_chara_len integer,
  shoot_curve_mid_rate integer,
  shoot_curve_height_rate integer,
  shoot_curve_angle integer,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_team_build (
  id text primary key,
  section text,
  idx integer,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_boost_groups (
  id text primary key,
  config_index integer,
  duration integer,
  spirit_indices jsonb,
  resolved_spirit_ids jsonb,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_star_signs (
  chara_param_id text primary key,
  sign_id integer,
  sign_name_ja text,
  chara_rarity integer,
  rate_default integer,
  rate_boost_a integer,
  rate_boost_b integer,
  rate_boost_c integer,
  rate_boost_d integer,
  is_remarkable boolean default false,
  enable_cond text,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_awakenings (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  type text,
  sub_type text,
  description_fr text,
  description_en text,
  description_ja text,
  image_url text,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_mode_changes (
  id text primary key,
  name_fr text,
  name_en text,
  name_ja text,
  type text,
  sub_type text,
  description_fr text,
  description_en text,
  description_ja text,
  image_url text,
  data jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.inagle_skill_videos (
  skill_id text not null,
  position text not null,
  video_url text,
  poster_url text,
  label text,
  data jsonb,
  updated_at timestamptz default now(),
  primary key (skill_id, position)
);

create table if not exists public.inagle_lua_scripts (
  id text primary key,
  name text,
  version text,
  category text,
  functions jsonb,
  calls jsonb,
  strings jsonb,
  crc32_numbers jsonb,
  hash text,
  updated_at timestamptz default now()
);

-- Row Level Security (RLS) & Public Read Policies
do $$
declare
  t text;
  tables text[] := array[
    'inagle_teams', 'inagle_uniforms', 'inagle_items', 'inagle_passives',
    'inagle_manager_passives', 'inagle_custom_passives', 'inagle_passive_scaling',
    'inagle_passive_generation', 'inagle_shops', 'inagle_stadiums', 'inagle_trophies',
    'inagle_quests', 'inagle_formations', 'inagle_tactics', 'inagle_special_tactics',
    'inagle_gallery', 'inagle_capsules', 'inagle_costumes', 'inagle_constellations',
    'inagle_coordinators', 'inagle_auras', 'inagle_keshins', 'inagle_souls',
    'inagle_miximax', 'inagle_override_skills', 'inagle_drops_tables',
    'inagle_drops_battles', 'inagle_drops_treasures', 'inagle_emblems',
    'inagle_missions', 'inagle_super_tactics', 'inagle_tricks', 'inagle_opponent_teams',
    'inagle_telop_waza', 'inagle_video_waza', 'inagle_skill_technic', 'inagle_team_build',
    'inagle_boost_groups', 'inagle_star_signs', 'inagle_awakenings', 'inagle_mode_changes',
    'inagle_skill_videos', 'inagle_lua_scripts'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_public_read', t);
  end loop;
end
$$;
