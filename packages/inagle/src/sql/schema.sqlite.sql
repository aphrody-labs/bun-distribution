-- ============================================================================
-- Canonical SQLite Mirror Schema for IECODE / Inagle / Azalée / NIE
-- Byte-exact and query-compatible with the production PostgreSQL projections.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. inagle_characters
CREATE TABLE IF NOT EXISTS inagle_characters (
  id TEXT PRIMARY KEY,
  chara_id TEXT,
  internal_code TEXT,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  rarity TEXT,
  rarity_code INTEGER,
  rarity_label TEXT,
  element_id INTEGER,
  element TEXT,
  position_id INTEGER,
  position TEXT,
  gender TEXT,
  image_url TEXT,
  sheet_data TEXT,
  stats TEXT,
  skills TEXT,
  teams TEXT,
  series TEXT,
  slug TEXT,
  team_id TEXT,
  stat_frappe INTEGER DEFAULT 0,
  stat_controle INTEGER DEFAULT 0,
  stat_technique INTEGER DEFAULT 0,
  stat_pression INTEGER DEFAULT 0,
  stat_physique INTEGER DEFAULT 0,
  stat_agilite INTEGER DEFAULT 0,
  stat_intelligence INTEGER DEFAULT 0,
  stat_total INTEGER DEFAULT 0,
  constellation TEXT,
  constellation_index INTEGER,
  zukan_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  zukan_order INTEGER,
  base_slug TEXT,
  control_type TEXT,
  data TEXT,
  is_controllable INTEGER DEFAULT 0,
  game_appearances TEXT,
  model_id TEXT,
  stat_lv1_frappe INTEGER DEFAULT 0,
  stat_lv1_controle INTEGER DEFAULT 0,
  stat_lv1_technique INTEGER DEFAULT 0,
  stat_lv1_pression INTEGER DEFAULT 0,
  stat_lv1_physique INTEGER DEFAULT 0,
  stat_lv1_agilite INTEGER DEFAULT 0,
  stat_lv1_intelligence INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  hero_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_inagle_characters_names ON inagle_characters (name_fr, name_en, name_ja);
CREATE INDEX IF NOT EXISTS idx_inagle_characters_internal_code ON inagle_characters (internal_code);
CREATE INDEX IF NOT EXISTS idx_inagle_characters_team_id ON inagle_characters (team_id);
CREATE INDEX IF NOT EXISTS idx_inagle_characters_slug ON inagle_characters (slug);
CREATE INDEX IF NOT EXISTS idx_inagle_characters_base_slug ON inagle_characters (base_slug);

-- 2. inagle_skills
CREATE TABLE IF NOT EXISTS inagle_skills (
  id TEXT PRIMARY KEY,
  internal_code TEXT,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  category_id INTEGER,
  element_id INTEGER,
  power_min INTEGER,
  power_max INTEGER,
  tension_cost INTEGER,
  image_url TEXT,
  video_url TEXT,
  poster_url TEXT,
  is_hyper INTEGER DEFAULT 0,
  sheet_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  category TEXT,
  data TEXT,
  element TEXT,
  evolution_type TEXT,
  foul_rate INTEGER DEFAULT 0,
  growth_type TEXT,
  hash_id TEXT,
  is_eldorado INTEGER DEFAULT 0,
  partner_count INTEGER DEFAULT 0,
  recast_time INTEGER DEFAULT 0,
  tp_cost INTEGER DEFAULT 0,
  skill_effect_bit_flag INTEGER DEFAULT 0,
  tags TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inagle_skills_names ON inagle_skills (name_fr, name_en, name_ja);
CREATE INDEX IF NOT EXISTS idx_inagle_skills_internal_code ON inagle_skills (internal_code);
CREATE INDEX IF NOT EXISTS idx_inagle_skills_category ON inagle_skills (category);

-- 3. inagle_teams
CREATE TABLE IF NOT EXISTS inagle_teams (
  id TEXT PRIMARY KEY,
  internal_code TEXT,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  emblems TEXT,
  kits TEXT,
  members TEXT,
  seasons TEXT,
  data TEXT,
  sheet_data TEXT,
  country_code TEXT,
  emblem_url TEXT,
  series TEXT,
  region TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inagle_teams_internal_code ON inagle_teams (internal_code);
CREATE INDEX IF NOT EXISTS idx_inagle_teams_names ON inagle_teams (name_fr, name_en, name_ja);

-- 4. inagle_uniforms
CREATE TABLE IF NOT EXISTS inagle_uniforms (
  name_id TEXT PRIMARY KEY,
  model_count INTEGER DEFAULT 0,
  model_start INTEGER DEFAULT 0,
  type_id INTEGER DEFAULT 0,
  models TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 5. inagle_items
CREATE TABLE IF NOT EXISTS inagle_items (
  id TEXT PRIMARY KEY,
  item_db_id TEXT,
  internal_code TEXT,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  category TEXT,
  category_id INTEGER,
  rarity INTEGER,
  price INTEGER,
  buy_price INTEGER,
  sell_price INTEGER,
  image_url TEXT,
  icon TEXT,
  shops TEXT,
  shop_names TEXT,
  effect TEXT,
  sheet_data TEXT,
  data TEXT,
  stat_boost_1 TEXT,
  stat_boost_2 TEXT,
  boost_type TEXT,
  effect_value INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inagle_items_category ON inagle_items (category);
CREATE INDEX IF NOT EXISTS idx_inagle_items_internal_code ON inagle_items (internal_code);

-- 6. inagle_passives
CREATE TABLE IF NOT EXISTS inagle_passives (
  id TEXT PRIMARY KEY,
  internal_code TEXT,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  type TEXT,
  category TEXT,
  boost_type TEXT,
  stat_boost TEXT,
  effect_value TEXT,
  image_url TEXT,
  data TEXT,
  sheet_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 7. inagle_manager_passives & custom passives
CREATE TABLE IF NOT EXISTS inagle_manager_passives (
  id TEXT PRIMARY KEY,
  coord_common TEXT,
  coord_legendary TEXT,
  manager_common TEXT,
  manager_legendary TEXT,
  requirements TEXT,
  stat TEXT,
  name_fr TEXT,
  name_en TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS inagle_custom_passives (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS inagle_passive_scaling (
  id TEXT PRIMARY KEY,
  requirement TEXT,
  stat_affected TEXT,
  legendary_low INTEGER,
  legendary_high INTEGER,
  top_low INTEGER,
  top_high INTEGER,
  advanced_low INTEGER,
  advanced_high INTEGER,
  growing_low INTEGER,
  growing_high INTEGER,
  common_low INTEGER,
  common_high INTEGER
);

CREATE TABLE IF NOT EXISTS inagle_passive_generation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passive_id TEXT NOT NULL,
  no INTEGER NOT NULL,
  requirement TEXT,
  stat TEXT
);

CREATE TABLE IF NOT EXISTS inagle_passive_sheets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 8. inagle_shops
CREATE TABLE IF NOT EXISTS inagle_shops (
  id TEXT PRIMARY KEY,
  shop_id INTEGER,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  category TEXT,
  image_url TEXT,
  internal_code TEXT,
  slot_index INTEGER,
  items TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_inagle_shops_shop_id ON inagle_shops (shop_id);

-- 9. inagle_stadiums
CREATE TABLE IF NOT EXISTS inagle_stadiums (
  id TEXT PRIMARY KEY,
  field_index INTEGER,
  image_path TEXT,
  condition TEXT,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  data TEXT
);

-- 10. inagle_trophies
CREATE TABLE IF NOT EXISTS inagle_trophies (
  id TEXT PRIMARY KEY,
  trophy_id TEXT,
  code TEXT,
  category TEXT,
  group_name TEXT,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  desc_fr TEXT,
  desc_en TEXT,
  desc_ja TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_inagle_trophies_code ON inagle_trophies (code);

-- 11. inagle_quests
CREATE TABLE IF NOT EXISTS inagle_quests (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  type TEXT,
  phase TEXT,
  display_text TEXT,
  image_url TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 12. inagle_formations
CREATE TABLE IF NOT EXISTS inagle_formations (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  type TEXT,
  image_url TEXT,
  emblem_url TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 13. inagle_tactics & special tactics
CREATE TABLE IF NOT EXISTS inagle_tactics (
  id TEXT PRIMARY KEY,
  internal_code TEXT,
  name TEXT,
  name_fr TEXT,
  name_ja TEXT,
  effect1 TEXT,
  effect2 TEXT,
  effect3 TEXT,
  duration INTEGER,
  cooldown INTEGER,
  shop TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  element_id INTEGER,
  element TEXT,
  power INTEGER,
  recast_time INTEGER,
  partner_count INTEGER,
  partner_ids TEXT,
  image_url TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS inagle_special_tactics (
  id TEXT PRIMARY KEY,
  internal_code TEXT,
  name_en TEXT,
  name_fr TEXT,
  name_ja TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  power INTEGER,
  recast_time INTEGER,
  element_id INTEGER,
  element TEXT,
  partner_count INTEGER,
  partner_ids TEXT,
  data TEXT
);

-- 14. inagle_gallery
CREATE TABLE IF NOT EXISTS inagle_gallery (
  id TEXT PRIMARY KEY,
  img_path TEXT,
  thumb_path TEXT,
  need_token_num INTEGER,
  flg_no INTEGER,
  category TEXT,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inagle_gallery_flg_no ON inagle_gallery (flg_no);

-- 15. inagle_capsules, costumes & constellations
CREATE TABLE IF NOT EXISTS inagle_capsules (
  id TEXT PRIMARY KEY,
  prize_data TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_costumes (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  category TEXT,
  image_url TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS inagle_constellations (
  id TEXT PRIMARY KEY,
  index_num INTEGER,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  characters TEXT,
  rates TEXT,
  data TEXT
);

-- 16. inagle_coordinators
CREATE TABLE IF NOT EXISTS inagle_coordinators (
  id TEXT PRIMARY KEY,
  name_en TEXT,
  name_fr TEXT,
  name_ja TEXT,
  name_localised TEXT,
  name_romaji TEXT,
  internal_code TEXT,
  role TEXT,
  gender TEXT,
  element TEXT,
  playstyle TEXT,
  description_fr TEXT,
  description_en TEXT,
  image_url TEXT,
  data TEXT,
  sheet_data TEXT
);

-- 17. Auras, Keshins, Souls, Miximax
CREATE TABLE IF NOT EXISTS inagle_auras (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  aura_type TEXT,
  internal_code TEXT,
  element TEXT,
  power INTEGER,
  data TEXT,
  sheet_data TEXT
);

CREATE TABLE IF NOT EXISTS inagle_keshins (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  element TEXT,
  position TEXT,
  image_url TEXT,
  model_code TEXT,
  data TEXT,
  sheet_data TEXT
);

CREATE TABLE IF NOT EXISTS inagle_souls (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  type TEXT,
  image_url TEXT,
  data TEXT,
  sheet_data TEXT,
  asset_code TEXT,
  sub_type TEXT,
  element_id INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_miximax (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS inagle_override_skills (
  id TEXT PRIMARY KEY,
  chara_param_id TEXT,
  skill_id TEXT,
  slot_index INTEGER,
  conditions TEXT,
  data TEXT
);

-- 18. Drops
CREATE TABLE IF NOT EXISTS inagle_drops_tables (
  table_id TEXT PRIMARY KEY,
  entries TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_drops_battles (
  battle_group_id INTEGER PRIMARY KEY,
  item_table_id INTEGER,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_drops_treasures (
  id TEXT PRIMARY KEY,
  map_id TEXT,
  pos TEXT,
  items TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 19. Basara, Cutins, Manifests & CPK Index
CREATE TABLE IF NOT EXISTS inagle_basara (
  character_id TEXT PRIMARY KEY,
  name_romaji TEXT,
  name_localised TEXT,
  gender TEXT,
  position TEXT,
  alt_position TEXT,
  element TEXT,
  moveset TEXT,
  alt_moveset TEXT,
  passive TEXT,
  kick INTEGER,
  control INTEGER,
  technique INTEGER,
  pressure INTEGER,
  physical INTEGER,
  agility INTEGER,
  intelligence INTEGER
);

CREATE TABLE IF NOT EXISTS inagle_skill_cutins (
  skill_id TEXT PRIMARY KEY,
  event_id_name TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_skill_cutin_assets (
  event_id_name TEXT PRIMARY KEY,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_asset_manifests (
  name TEXT PRIMARY KEY,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_cpk_index (
  path TEXT PRIMARY KEY,
  top TEXT,
  sub TEXT,
  dir TEXT,
  name TEXT,
  ext TEXT,
  cpk TEXT,
  depth INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_game_text (
  hash_id TEXT,
  locale TEXT,
  category TEXT,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (hash_id, locale)
);

CREATE TABLE IF NOT EXISTS inagle_cross_catalog (
  guid TEXT PRIMARY KEY,
  key TEXT,
  type TEXT,
  bundle TEXT,
  size INTEGER,
  n_deps INTEGER,
  deps TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_cfgbin (
  path TEXT PRIMARY KEY,
  cpk TEXT,
  size INTEGER,
  parsed INTEGER,
  format TEXT,
  error TEXT,
  data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_emblems (
  emblem_id TEXT PRIMARY KEY,
  emblem_name TEXT,
  small_file_path TEXT,
  small_tex_name TEXT,
  large_file_path TEXT,
  large_tex_name TEXT,
  base_path TEXT,
  is_template INTEGER DEFAULT 0,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_missions (
  mission_id TEXT PRIMARY KEY,
  code TEXT,
  name_id TEXT,
  name_en TEXT,
  name_fr TEXT,
  name_ja TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_super_tactics (
  id TEXT PRIMARY KEY,
  kind TEXT,
  idx INTEGER,
  crc_id TEXT,
  conditions TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inagle_super_tactics_crc ON inagle_super_tactics (crc_id);

CREATE TABLE IF NOT EXISTS inagle_tricks (
  id TEXT PRIMARY KEY,
  trick_id_name TEXT,
  event_id TEXT,
  event_id_name TEXT,
  fail_event_id TEXT,
  fail_event_id_name TEXT,
  name_ja TEXT,
  trick_category TEXT,
  trick_category_name TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_opponent_teams (
  id TEXT PRIMARY KEY,
  team_id TEXT,
  name_fr TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_telop_waza (
  skill_id TEXT PRIMARY KEY,
  blank_left_index INTEGER,
  blank_right_index INTEGER,
  eldorado_id TEXT,
  left_blanks TEXT,
  right_blanks TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_video_waza (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  menu_id TEXT,
  caption_id TEXT,
  movie_path TEXT,
  bgm_name TEXT,
  fede_in_time INTEGER,
  fede_out_time INTEGER,
  staffroll_data_name TEXT,
  caption_name TEXT,
  caption_start_frame INTEGER,
  caption_end_frame INTEGER,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_skill_technic (
  id TEXT PRIMARY KEY,
  win_sub_motion_name_crc TEXT,
  lose_sub_motion_name_crc TEXT,
  lose_type INTEGER,
  formation_type INTEGER,
  formation_chara_len INTEGER,
  shoot_curve_mid_rate INTEGER,
  shoot_curve_height_rate INTEGER,
  shoot_curve_angle INTEGER,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_team_build (
  id TEXT PRIMARY KEY,
  section TEXT,
  idx INTEGER,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_boost_groups (
  id TEXT PRIMARY KEY,
  config_index INTEGER,
  duration INTEGER,
  spirit_indices TEXT,
  resolved_spirit_ids TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_star_signs (
  chara_param_id TEXT PRIMARY KEY,
  sign_id INTEGER,
  sign_name_ja TEXT,
  chara_rarity INTEGER,
  rate_default INTEGER,
  rate_boost_a INTEGER,
  rate_boost_b INTEGER,
  rate_boost_c INTEGER,
  rate_boost_d INTEGER,
  is_remarkable INTEGER DEFAULT 0,
  enable_cond TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_awakenings (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  type TEXT,
  sub_type TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  image_url TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_mode_changes (
  id TEXT PRIMARY KEY,
  name_fr TEXT,
  name_en TEXT,
  name_ja TEXT,
  type TEXT,
  sub_type TEXT,
  description_fr TEXT,
  description_en TEXT,
  description_ja TEXT,
  image_url TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inagle_skill_videos (
  skill_id TEXT NOT NULL,
  position TEXT NOT NULL,
  video_url TEXT,
  poster_url TEXT,
  label TEXT,
  data TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (skill_id, position)
);

CREATE TABLE IF NOT EXISTS inagle_lua_scripts (
  id TEXT PRIMARY KEY,
  name TEXT,
  version TEXT,
  category TEXT,
  functions TEXT,
  calls TEXT,
  strings TEXT,
  crc32_numbers TEXT,
  hash TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

