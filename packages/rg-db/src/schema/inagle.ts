import type { ColumnType, JSONColumnType } from "kysely";

type Json = JSONColumnType<Record<string, unknown> | unknown[] | null>;

export interface InagleTables {
  inagle_basara: InagleBasaraTable;
  inagle_characters: InagleCharacterTable;
  inagle_skills: InagleSkillTable;
  inagle_cfgbin: InagleCfgbinTable;
  inagle_passives: InaglePassiveTable;
  inagle_passive_sheets: InaglePassiveSheetTable;
  inagle_items: InagleItemTable;
  inagle_quests: InagleQuestTable;
  inagle_teams: InagleTeamTable;
  inagle_souls: InagleSoulTable;
  inagle_formations: InagleFormationTable;
  inagle_skill_cutins: InagleSkillCutinTable;
  inagle_skill_cutin_assets: InagleSkillCutinAssetTable;
  inagle_asset_manifests: InagleAssetManifestTable;
  inagle_capsules: InagleCapsuleTable;
  inagle_gallery: InagleGalleryTable;
  inagle_uniforms: InagleUniformTable;
  inagle_drops_battles: InagleDropBattleTable;
  inagle_drops_tables: InagleDropTable;
  inagle_drops_treasures: InagleDropTreasureTable;
  inagle_cross_catalog: InagleCrossCatalogTable;
  inagle_cpk_index: InagleCpkIndexTable;
  inagle_game_text: InagleGameTextTable;
}

export interface InagleBasaraTable {
  character_id: string;
  name_romaji: string | null;
  name_localised: string | null;
  gender: string | null;
  position: string | null;
  alt_position: string | null;
  element: string | null;
  moveset: string | null;
  alt_moveset: string | null;
  passive: string | null;
  kick: number | null;
  control: number | null;
  technique: number | null;
  pressure: number | null;
  physical: number | null;
  agility: number | null;
  intelligence: number | null;
}

/** Canonical SQL projection for extracted characters. */
export interface InagleCharacterTable {
  id: string;
  chara_id: string | null;
  internal_code: string | null;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_ja: string | null;
  rarity: string | null;
  rarity_code: number | null;
  rarity_label: string | null;
  element_id: number | null;
  element: string | null;
  position_id: number | null;
  position: string | null;
  gender: string | null;
  image_url: string | null;
  sheet_data: Json;
  stats: Json;
  skills: Json;
  teams: Json;
  series: string | null;
  slug: string | null;
  team_id: string | null;
  stat_frappe: number | null;
  stat_controle: number | null;
  stat_technique: number | null;
  stat_pression: number | null;
  stat_physique: number | null;
  stat_agilite: number | null;
  stat_intelligence: number | null;
  stat_total: number | null;
  constellation: string | null;
  constellation_index: number | null;
  zukan_hash: string | null;
  created_at: ColumnType<Date, string | undefined, never> | null;
  zukan_order: number | null;
  base_slug: string | null;
  control_type: string | null;
  data: Json;
  is_controllable: boolean | null;
  game_appearances: string[] | null;
  model_id: string | null;
  stat_lv1_frappe: number | null;
  stat_lv1_controle: number | null;
  stat_lv1_technique: number | null;
  stat_lv1_pression: number | null;
  stat_lv1_physique: number | null;
  stat_lv1_agilite: number | null;
  stat_lv1_intelligence: number | null;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
  hero_type: string | null;
}

/** Canonical SQL projection for extracted techniques and skills. */
export interface InagleSkillTable {
  id: string;
  internal_code: string | null;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_ja: string | null;
  category_id: number | null;
  element_id: number | null;
  power_min: number | null;
  power_max: number | null;
  tension_cost: number | null;
  image_url: string | null;
  video_url: string | null;
  poster_url: string | null;
  is_hyper: boolean | null;
  sheet_data: Json;
  created_at: ColumnType<Date, string | undefined, never> | null;
  category: string | null;
  data: Json;
  element: string | null;
  evolution_type: string | null;
  foul_rate: number | null;
  growth_type: string | null;
  hash_id: string | null;
  is_eldorado: boolean | null;
  partner_count: number | null;
  recast_time: number | null;
  tp_cost: number | null;
  skill_effect_bit_flag: number | null;
  tags: string[] | null;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

/** Parsed cfg.bin rows. JSONB is the SQL-native extraction format; the game
 * dump is imported once and is no longer read from loose JSON files at run time. */
export interface InagleCfgbinTable {
  path: string;
  cpk: string;
  size: number;
  parsed: number;
  format: string | null;
  error: string | null;
  data: Json;
  created_at: ColumnType<Date, string | undefined, never> | null;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InaglePassiveTable {
  id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_ja: string | null;
  type: string | null;
  image_url: string | null;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
  category: string | null;
  boost_type: string | null;
  stat_boost: string | null;
  effect_value: string | null;
}

/** Canonical SQL projection for custom/coordinator passive sheets. */
export interface InaglePassiveSheetTable {
  id: string;
  kind: "player" | "custom" | "coordinator";
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InagleItemTable {
  id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_ja: string | null;
  category: string | null;
  rarity: number | null;
  image_url: string | null;
  sheet_data: Json;
  price: number | null;
  internal_code: string | null;
  shops: Json;
  created_at: ColumnType<Date, string | undefined, never> | null;
  data: Json;
  sell_price: number | null;
  buy_price: number | null;
  shop_names: string[] | null;
  stat_boost_1: string | null;
  stat_boost_2: string | null;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
  boost_type: string | null;
  effect_value: number | null;
}

export interface InagleQuestTable {
  id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_ja: string | null;
  type: string | null;
  image_url: string | null;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
  display_text: string | null;
  phase: string | null;
}

export interface InagleTeamTable {
  id: string;
  internal_code: string | null;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  emblems: Json;
  kits: Json;
  members: Json;
  sheet_data: Json;
  created_at: ColumnType<Date, string | undefined, never> | null;
  country_code: string | null;
  data: Json;
  description_en: string | null;
  description_ja: string | null;
  description_fr: string | null;
  emblem_url: string | null;
  series: string | null;
  region: string | null;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InagleSoulTable {
  id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_ja: string | null;
  type: string | null;
  image_url: string | null;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
  sheet_data: Json;
  asset_code: string | null;
  sub_type: string | null;
  element_id: number | null;
}

export interface InagleFormationTable {
  id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_ja: string | null;
  type: string | null;
  image_url: string | null;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
  emblem_url: string | null;
}

/** Canonical SQL projection of the extracted skill cut-in metadata. */
export interface InagleSkillCutinTable {
  skill_id: string;
  event_id_name: string | null;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

/** Gate for the cut-in models/textures actually served by the CDN. */
export interface InagleSkillCutinAssetTable {
  event_id_name: string;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

/** Build-time/client projections derived from the canonical CPK inventory. */
export interface InagleAssetManifestTable {
  name: string;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InagleCapsuleTable {
  id: string;
  prize_data: Json;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InagleGalleryTable {
  id: string;
  img_path: string | null;
  thumb_path: string | null;
  need_token_num: number | null;
  flg_no: number | null;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InagleUniformTable {
  name_id: string;
  model_count: number;
  model_start: number;
  type_id: number | null;
  models: Json;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InagleDropBattleTable {
  battle_group_id: number;
  item_table_id: number | null;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InagleDropTable {
  table_id: string;
  entries: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

export interface InagleDropTreasureTable {
  id: string;
  map_id: string | null;
  pos: Json;
  items: Json;
  data: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

/** Durable SQL index for the Cross Addressables catalogue. */
export interface InagleCrossCatalogTable {
  guid: string;
  key: string;
  type: string;
  bundle: string;
  size: number;
  n_deps: number;
  deps: Json;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

/** Durable PostgreSQL projection of the decoded CPK path index. */
export interface InagleCpkIndexTable {
  path: string;
  top: string;
  sub: string;
  dir: string;
  name: string;
  ext: string;
  cpk: string;
  depth: number;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}

/** Searchable multilingual game-text projection. */
export interface InagleGameTextTable {
  hash_id: string;
  locale: string;
  category: string;
  value: string;
  updated_at: ColumnType<Date, string | undefined, string | Date> | null;
}
