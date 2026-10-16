/**
 * @file drizzle.ts
 * @description Bun-native Drizzle ORM client and schemas for Inagle / Azalée / NIE.
 * Leverages Bun's native C++ SQL client (`drizzle-orm/bun-sql`) for PostgreSQL
 * and native `bun:sqlite` (`drizzle-orm/bun-sqlite`) for high-performance SQLite.
 */

import { Database } from "bun:sqlite";
import { localMirrorPath, ownedPostgresUrl } from "../core/data-source.js";
import { SQL } from "bun";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzlePg } from "drizzle-orm/bun-sql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { boolean, integer as pgInteger, jsonb, pgTable, text as pgText, timestamp } from "drizzle-orm/pg-core";

// ============================================================================
// CANONICAL SQLITE DRIZZLE SCHEMAS (for var/mirror.sqlite & memory)
// ============================================================================

export const sqliteCharacters = sqliteTable("inagle_characters", {
  id: text("id").primaryKey(),
  charaId: text("chara_id"),
  internalCode: text("internal_code"),
  nameFr: text("name_fr"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  descriptionFr: text("description_fr"),
  descriptionEn: text("description_en"),
  descriptionJa: text("description_ja"),
  rarity: text("rarity"),
  rarityCode: integer("rarity_code"),
  element: text("element"),
  position: text("position"),
  gender: text("gender"),
  imageUrl: text("image_url"),
  sheetData: text("sheet_data"),
  stats: text("stats"),
  skills: text("skills"),
  teams: text("teams"),
  series: text("series"),
  slug: text("slug"),
  baseSlug: text("base_slug"),
  teamId: text("team_id"),
  statFrappe: integer("stat_frappe"),
  statControle: integer("stat_controle"),
  statTechnique: integer("stat_technique"),
  statPression: integer("stat_pression"),
  statPhysique: integer("stat_physique"),
  statAgilite: integer("stat_agilite"),
  statIntelligence: integer("stat_intelligence"),
  statTotal: integer("stat_total"),
  zukanOrder: integer("zukan_order"),
  data: text("data"),
});

export const sqliteSkills = sqliteTable("inagle_skills", {
  id: text("id").primaryKey(),
  internalCode: text("internal_code"),
  nameFr: text("name_fr"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  descriptionFr: text("description_fr"),
  descriptionEn: text("description_en"),
  descriptionJa: text("description_ja"),
  category: text("category"),
  element: text("element"),
  powerMin: integer("power_min"),
  powerMax: integer("power_max"),
  tensionCost: integer("tension_cost"),
  tpCost: integer("tp_cost"),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  isHyper: integer("is_hyper"),
  isEldorado: integer("is_eldorado"),
  data: text("data"),
  sheetData: text("sheet_data"),
});

export const sqliteTeams = sqliteTable("inagle_teams", {
  id: text("id").primaryKey(),
  internalCode: text("internal_code"),
  nameFr: text("name_fr"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  emblemUrl: text("emblem_url"),
  emblems: text("emblems"),
  kits: text("kits"),
  members: text("members"),
  seasons: text("seasons"),
  series: text("series"),
  region: text("region"),
  data: text("data"),
  sheetData: text("sheet_data"),
  descriptionFr: text("description_fr"),
  descriptionEn: text("description_en"),
  descriptionJa: text("description_ja"),
});

export const sqliteItems = sqliteTable("inagle_items", {
  id: text("id").primaryKey(),
  internalCode: text("internal_code"),
  nameFr: text("name_fr"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  descriptionFr: text("description_fr"),
  descriptionEn: text("description_en"),
  descriptionJa: text("description_ja"),
  category: text("category"),
  rarity: integer("rarity"),
  price: integer("price"),
  imageUrl: text("image_url"),
  icon: text("icon"),
  shops: text("shops"),
  data: text("data"),
  sheetData: text("sheet_data"),
});

export const sqliteShops = sqliteTable("inagle_shops", {
  id: text("id").primaryKey(),
  shopId: integer("shop_id"),
  name: text("name"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  slotIndex: integer("slot_index"),
  itemId: text("item_id"),
  category: text("category"),
  internalCode: text("internal_code"),
  data: text("data"),
});

export const sqliteStadiums = sqliteTable("inagle_stadiums", {
  id: text("id").primaryKey(),
  fieldIndex: integer("field_index"),
  imagePath: text("image_path"),
  condition: text("condition"),
  nameFr: text("name_fr"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  data: text("data"),
});

export const sqliteTrophies = sqliteTable("inagle_trophies", {
  id: text("id").primaryKey(),
  trophyId: text("trophy_id"),
  code: text("code"),
  category: text("category"),
  groupName: text("group_name"),
  nameFr: text("name_fr"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  descFr: text("desc_fr"),
  descEn: text("desc_en"),
  descJa: text("desc_ja"),
  data: text("data"),
});

export const sqliteQuests = sqliteTable("inagle_quests", {
  id: text("id").primaryKey(),
  nameFr: text("name_fr"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  descriptionFr: text("description_fr"),
  descriptionEn: text("description_en"),
  descriptionJa: text("description_ja"),
  type: text("type"),
  phase: text("phase"),
  displayText: text("display_text"),
  imageUrl: text("image_url"),
  data: text("data"),
});

export const sqliteUniforms = sqliteTable("inagle_uniforms", {
  nameId: text("name_id").primaryKey(),
  modelCount: integer("model_count"),
  modelStart: integer("model_start"),
  typeId: integer("type_id"),
  models: text("models"),
  data: text("data"),
});

export const sqlitePassives = sqliteTable("inagle_passives", {
  id: text("id").primaryKey(),
  internalCode: text("internal_code"),
  nameFr: text("name_fr"),
  nameEn: text("name_en"),
  nameJa: text("name_ja"),
  type: text("type"),
  category: text("category"),
  boostType: text("boost_type"),
  statBoost: text("stat_boost"),
  effectValue: text("effect_value"),
  imageUrl: text("image_url"),
  data: text("data"),
  sheetData: text("sheet_data"),
});

// ============================================================================
// CANONICAL POSTGRESQL DRIZZLE SCHEMAS (for Supabase / RG DB)
// ============================================================================

export const pgCharacters = pgTable("inagle_characters", {
  id: pgText("id").primaryKey(),
  charaId: pgText("chara_id"),
  internalCode: pgText("internal_code"),
  nameFr: pgText("name_fr"),
  nameEn: pgText("name_en"),
  nameJa: pgText("name_ja"),
  descriptionFr: pgText("description_fr"),
  descriptionEn: pgText("description_en"),
  descriptionJa: pgText("description_ja"),
  rarity: pgText("rarity"),
  rarityCode: pgInteger("rarity_code"),
  element: pgText("element"),
  position: pgText("position"),
  gender: pgText("gender"),
  imageUrl: pgText("image_url"),
  sheetData: jsonb("sheet_data"),
  stats: jsonb("stats"),
  skills: jsonb("skills"),
  teams: jsonb("teams"),
  series: pgText("series"),
  slug: pgText("slug"),
  baseSlug: pgText("base_slug"),
  teamId: pgText("team_id"),
  statFrappe: pgInteger("stat_frappe"),
  statControle: pgInteger("stat_controle"),
  statTechnique: pgInteger("stat_technique"),
  statPression: pgInteger("stat_pression"),
  statPhysique: pgInteger("stat_physique"),
  statAgilite: pgInteger("stat_agilite"),
  statIntelligence: pgInteger("stat_intelligence"),
  statTotal: pgInteger("stat_total"),
  zukanOrder: pgInteger("zukan_order"),
  data: jsonb("data"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const pgSkills = pgTable("inagle_skills", {
  id: pgText("id").primaryKey(),
  internalCode: pgText("internal_code"),
  nameFr: pgText("name_fr"),
  nameEn: pgText("name_en"),
  nameJa: pgText("name_ja"),
  descriptionFr: pgText("description_fr"),
  descriptionEn: pgText("description_en"),
  descriptionJa: pgText("description_ja"),
  category: pgText("category"),
  element: pgText("element"),
  powerMin: pgInteger("power_min"),
  powerMax: pgInteger("power_max"),
  tensionCost: pgInteger("tension_cost"),
  tpCost: pgInteger("tp_cost"),
  imageUrl: pgText("image_url"),
  videoUrl: pgText("video_url"),
  isHyper: boolean("is_hyper"),
  isEldorado: boolean("is_eldorado"),
  data: jsonb("data"),
  sheetData: jsonb("sheet_data"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const pgTeams = pgTable("inagle_teams", {
  id: pgText("id").primaryKey(),
  internalCode: pgText("internal_code"),
  nameFr: pgText("name_fr"),
  nameEn: pgText("name_en"),
  nameJa: pgText("name_ja"),
  emblemUrl: pgText("emblem_url"),
  emblems: jsonb("emblems"),
  kits: jsonb("kits"),
  members: jsonb("members"),
  seasons: jsonb("seasons"),
  series: pgText("series"),
  region: pgText("region"),
  data: jsonb("data"),
  sheetData: jsonb("sheet_data"),
  descriptionFr: pgText("description_fr"),
  descriptionEn: pgText("description_en"),
  descriptionJa: pgText("description_ja"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

// ============================================================================
// DRIZZLE FACTORY CLIENTS
// ============================================================================

export function createDrizzleSqlite(dbOrPath?: Database | string) {
  const db =
    typeof dbOrPath === "string"
      ? new Database(dbOrPath, { readonly: true })
      : (dbOrPath ??
        new Database(
          localMirrorPath() ??
            (() => {
              throw new Error("An existing IECODE SQLite mirror is required");
            })(),
          { readonly: true },
        ));
  return drizzleSqlite(db, {
    schema: {
      characters: sqliteCharacters,
      skills: sqliteSkills,
      teams: sqliteTeams,
      items: sqliteItems,
      shops: sqliteShops,
      stadiums: sqliteStadiums,
      trophies: sqliteTrophies,
      quests: sqliteQuests,
      uniforms: sqliteUniforms,
      passives: sqlitePassives,
    },
  });
}

export function createDrizzlePg(sqlOrUrl?: SQL | string) {
  const client =
    typeof sqlOrUrl === "object" && sqlOrUrl !== null
      ? sqlOrUrl
      : new SQL({ url: typeof sqlOrUrl === "string" ? sqlOrUrl : ownedPostgresUrl() });
  return drizzlePg(client, {
    schema: {
      characters: pgCharacters,
      skills: pgSkills,
      teams: pgTeams,
    },
  });
}

export { drizzleSqlite, drizzlePg };
export * from "drizzle-orm";
