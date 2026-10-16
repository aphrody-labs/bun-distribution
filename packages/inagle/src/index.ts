/**
 * @file index.ts
 * @description Universal Game Data API for Inazuma Eleven: Victory Road
 * @module @/lib/inagle
 */

// Canonical character and BASARA types.
export * from "./basara/types.js";
export * from "./characters/comparison-engine.js";

// Constellation
export type { ConstellationAPI } from "./constellation/index.js";
// Exporters
export * from "./core/exporters.js";

// Core exports
export {
  DATA_ROOT,
  ElementId,
  ElementNames,
  FILES,
  fromHex,
  InagleError,
  InagleErrorCode,
  measureTime,
  PATHS,
  PositionId,
  PositionNames,
  RarityId,
  RarityNames,
  toHex,
} from "./core/index.js";
// Core types for base characters with variants
export type {
  BaseCharacter,
  Character,
  CharacterStats as GameCharacterStats,
  CharacterVariant,
  MultiLevelStats,
} from "./core/types.js";
import type { Skill as CoreSkill, Team as CoreTeam } from "./core/types.js";

/** Canonical cross-package DTOs. Wiki/API enrich these game entities with
 * localized SQL projections while preserving the game-level core contract. */
export interface Skill extends CoreSkill {
  [key: string]: any;
}
export interface Team extends CoreTeam {
  [key: string]: any;
}
// New entity builders
export { type BaseCharacterStats, type CharacterFilter, type CharacterStatsSummary } from "./entities/types.js";
export * from "./menu/index.js";
// APIs
export * from "./service.js";

// Stat Calculator
export * from "./analysis/index.js";
export * from "./stat-calculator.js";
export * from "./zukan/index.js";

// Items
export type { ItemCategory, ParsedItem as Item } from "./parsers/item-config.js";
// Global Search
export {
  type GlobalSearchAPI,
  type GlobalSearchResult,
  type SearchableType,
  type SearchConfig,
} from "./search/index.js";
// Canonical skill types and labels.
export type { TeamPassive } from "./skills/types.js";
export { CATEGORY_NAMES, ELEMENT_NAMES, PASSIVE_BOOST_NAMES, PASSIVE_SCOPE_NAMES } from "./skills/types.js";

// Romaji & Transliteration
export { initRomaji, toRomaji, toRomajiTitleCase, toKana } from "./utils/romaji.js";

// Authoritative Level-5 NIE binary bridge
export * as NieBridge from "./nie-bridge/index.js";
export * from "./nie-bridge/index.js";

// Canonical unified Wiki module
export * as Wiki from "./wiki/index.js";
export type {
  AuraSummary,
  CoordinatorPassiveSheet,
  CustomPassiveSheet,
  ItemProfile,
  LocalizedText,
  PassiveDetail,
  PassiveListItem,
  PassiveSheets,
  PlayerPassiveSheet,
  Quest,
  QuestKind,
  ShopDetail,
  ShopItem,
  ShopSummary,
  SkillCutin,
  SkillProfile,
  SkillSlot,
  Stadium,
  TeamDetail,
  TeamEmblem,
  TeamKit,
  TeamKitModel,
  TeamListItem,
  TeamRosterMember,
  Trophy,
  TrophyCategory,
  WikiStatBlock,
} from "./wiki/index.js";
export { statBlockTotal } from "./wiki/index.js";

// Bun-native Drizzle ORM client & schemas
export * as Drizzle from "./sql/drizzle.js";
export { createDrizzleSqlite, createDrizzlePg } from "./sql/drizzle.js";

// Canonical pure game rules, formations & mechanics
export * as game from "./game/index.js";
export {
  FORMATIONS,
  LEGACY_FORMATIONS,
  isFemaleGender,
  decodeTeamCode,
  encodeTeamCode,
  TEAM_EMBLEM_MAP,
  interpolateVariantStats,
} from "./game/index.js";

// Canonical CPK index & media assets
export * as cpk from "./cpk/index.js";

// Canonical text formatting, gaiji & translations
export * as text from "./text/index.js";
export { formatDescription, translateEffect, tacticSlug, GAIJI, GAIJI_ATLAS, type GaijiGlyph } from "./text/index.js";

// Canonical game-text SQL lookup
export * as gameText from "./game-text/index.js";

// Consolidated sub-package namespaces: un cli, un api, un types, un ffi, un core, un db, un ui
export * as cli from "./cli/index.js";
export * as api from "./api/index.js";
export * as types from "./types/index.js";
export * as ffi from "./ffi/index.js";
export * as core from "./core/index.js";
export * as db from "./db/index.js";
export * as ui from "./ui/index.js";
export * as dotnet from "./dotnet/index.js";
export * as docs from "./docs/index.js";
export * as formats from "./formats/index.js";
