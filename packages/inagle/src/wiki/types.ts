/**
 * @file types.ts
 * @description Canonical, unified Wiki types for Inazuma Eleven: Victory Road.
 * Shared between NIE (Rust/WebAssembly), Azalée (Headless API/Frontend), and Inagle (Universal Data Engine).
 */

import type {
  BaseCharacter,
  Character,
  CharacterStats,
  CharacterVariant,
  LocalizedNames,
  MultiLevelStats,
  RomanizedName,
} from "../core/types.js";
import { ElementId, PositionId, RarityId } from "../core/types.js";

export type {
  BaseCharacter,
  Character,
  CharacterStats,
  CharacterVariant,
  LocalizedNames,
  MultiLevelStats,
  RomanizedName,
};
export { ElementId, PositionId, RarityId };

// ============================================================================
// STATS & NUMERICAL MODELS (Grounded in aphrody-nie-wiki::model::StatBlock)
// ============================================================================

export interface WikiStatBlock {
  kick: number;
  control: number;
  technique: number;
  pressure: number;
  physical: number;
  agility: number;
  intelligence: number;
}

export type StatBlock = WikiStatBlock;

export function statBlockTotal(stats: WikiStatBlock): number {
  return (
    stats.kick + stats.control + stats.technique + stats.pressure + stats.physical + stats.agility + stats.intelligence
  );
}

// ============================================================================
// SKILLS & CUTINS
// ============================================================================

export interface SkillSlot {
  skillId: string;
  learnLevel: number;
}

export interface SkillProfile {
  id: string;
  nameFr: string | null;
  nameEn: string | null;
  nameJa: string | null;
  category: string | null;
  element: string | null;
  powerMax: number | null;
  powerMin: number | null;
  tpCost: number | null;
  tensionCost: number | null;
  descriptionFr: string | null;
  descriptionEn: string | null;
  internalCode: string | null;
  isHyper: boolean;
  isEldorado: boolean;
  videoUrl?: string | null;
  imageUrl?: string | null;
  sheetData?: Record<string, unknown>;
}

export interface SkillCutin {
  skillId: string;
  eventIdName: string;
  data: Record<string, unknown>;
}

// ============================================================================
// ITEMS & SHOPS
// ============================================================================

export interface ItemProfile {
  id: string;
  nameFr: string | null;
  nameEn: string | null;
  nameJa: string | null;
  category: string | null;
  rarity: number | null;
  descriptionFr: string | null;
  internalCode: string | null;
  price: number | null;
  buyPrice?: number | null;
  sellPrice?: number | null;
  imageUrl?: string | null;
  icon?: string | null;
  shops: string[];
  effect?: Record<string, unknown>;
  sheetData?: Record<string, unknown>;
}

export interface ShopItem {
  id: string;
  name: string;
  category: string | null;
  icon: string | null;
  internalCode: string | null;
  slotIndex: number;
  resolved: boolean;
}

export interface ShopSummary {
  shopId: number;
  name: string;
  nameEn: string | null;
  nameJa: string | null;
  itemCount: number;
  categories: { category: string; count: number }[];
}

export interface ShopDetail extends ShopSummary {
  items: ShopItem[];
}

// ============================================================================
// TEAMS, UNIFORMS & ROSTERS
// ============================================================================

export interface TeamKitModel {
  typeId: number; // 0 = home, 1 = away
  uniformFielderModelIdCrc: string;
  uniformKeeperModelIdCrc: string;
  shoesFielderModelIdCrc: string;
  gloveModelIdCrc: string;
}

export interface TeamKit {
  series: string;
  seriesLabel: string;
  nameId: string;
  models: TeamKitModel[];
}

export interface TeamEmblem {
  series: string;
  seriesLabel: string;
  crc: string;
}

export interface TeamRosterMember {
  charaId: string;
  name: string;
  nameJa: string | null;
  slug: string | null;
  position: string | null;
  element: string | null;
  rarity: string | null;
  imageUrl: string;
}

export interface TeamListItem {
  id: string;
  name: string;
  nameJa: string | null;
  nameEn: string | null;
  emblemUrl: string | null;
  seasons: Record<string, number>;
  seriesKeys: string[];
  rosterCount: number;
  order: number;
}

export interface TeamDetail {
  id: string;
  name: string;
  nameEn: string | null;
  nameJa: string | null;
  descriptionFr: string | null;
  descriptionEn: string | null;
  emblemUrl: string | null;
  emblems: TeamEmblem[];
  kits: TeamKit[];
  seasons: Record<string, number>;
  roster: TeamRosterMember[];
}

// ============================================================================
// STADIUMS & TROPHIES
// ============================================================================

export interface Stadium {
  id: string;
  code: string;
  index: number | null;
  title: string;
  image: string;
  thumb: string | null;
  full: string | null;
}

export type TrophyCategory = "trophy" | "activity";

export interface LocalizedText {
  fr: string;
  en: string;
  ja: string;
}

export interface Trophy {
  id: string;
  code: string;
  category: TrophyCategory;
  group: string;
  groupLabel: string;
  name: string;
  desc: string;
  names: LocalizedText;
  descriptions: LocalizedText;
}

// ============================================================================
// QUESTS
// ============================================================================

export type QuestKind = "main" | "side";

export interface Quest {
  id: string;
  title: string;
  titles: { fr: string; en: string; ja: string };
  type: number;
  phase: number;
  image: string | null;
  kind: QuestKind;
  area: number | null;
}

// ============================================================================
// PASSIVES & SHEETS
// ============================================================================

export interface PassiveListItem {
  id: string;
  nameFr: string | null;
  nameEn: string | null;
  nameJa: string | null;
  descriptionFr: string | null;
  descriptionEn: string | null;
  category: string | null;
  boostType: string | null;
  statBoost: string | null;
  effectValue: string | null;
}

export interface PassiveDetail extends PassiveListItem {
  scaling?: Array<{
    tier: string;
    low: number;
    high: number;
  }>;
}

export interface PlayerPassiveSheet {
  id: string;
  kind: "player";
  data: Record<string, unknown>;
}

export interface CustomPassiveSheet {
  id: string;
  kind: "custom";
  data: Record<string, unknown>;
}

export interface CoordinatorPassiveSheet {
  id: string;
  kind: "coordinator";
  data: Record<string, unknown>;
}

export type PassiveSheets = PlayerPassiveSheet | CustomPassiveSheet | CoordinatorPassiveSheet;

// ============================================================================
// AURAS, KESHINS & SOULS
// ============================================================================

export interface AuraSummary {
  id: string;
  name: string;
  auraType: string;
  element?: string | null;
  power?: number | null;
  internalCode?: string | null;
}
