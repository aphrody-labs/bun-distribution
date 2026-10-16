import { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";
import { Database as SqliteDatabase } from "bun:sqlite";
import { decodeProjectionJson } from "./projection-json.js";

type JsonObject = Record<string, unknown>;
type Db = ReturnType<typeof createInagleSql<Database>>;
type ReadRows = (table: string, order?: string) => Promise<Record<string, any>[]>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Charge les projections SQL consommées par le service Inagle.
 * The host selects an owned PostgreSQL service or an existing read-only SQLite
 * mirror. Both consume the same imported projections; this boundary never restores data.
 */
export async function loadInagleServiceData(db: Db = createInagleSql<Database>()) {
  return loadProjectionData(async (table, order) => {
    let query = db.selectFrom(table as any).selectAll();
    if (order) query = query.orderBy(order, "asc");
    return (await query.execute()) as Record<string, any>[];
  });
}

/** Read the same imported projections from an existing mirror without writing or restoring it. */
export async function loadSqliteServiceData(path: string) {
  const db = new SqliteDatabase(path, { readonly: true, strict: true });
  try {
    return await loadProjectionData(async (table, order) => {
      if (!/^inagle_[a-z_]+$/.test(table) || (order && !/^[a-z_]+$/.test(order)))
        throw new Error("Invalid internal projection identifier");
      const rows = db.query(`SELECT * FROM "${table}"${order ? ` ORDER BY "${order}" ASC` : ""}`).all() as Record<
        string,
        any
      >[];
      for (const row of rows) {
        for (const key of [
          "data",
          "emblems",
          "kits",
          "prize_data",
          "placements",
          "stats",
          "skills",
          "teams",
          "series",
          "sheet_data",
        ]) {
          const value = row[key];
          if (typeof value === "string" && (value.trim().startsWith("[") || value.trim().startsWith("{")))
            try {
              row[key] = decodeProjectionJson(value);
            } catch {
              throw new Error(`Invalid SQLite JSON projection metadata in ${table}.${key}`);
            }
        }
      }
      return rows;
    });
  } finally {
    db.close();
  }
}

async function loadProjectionData(readRows: ReadRows) {
  try {
    const optionalRows = async (table: string) => {
      try {
        return await readRows(table);
      } catch {
        return [];
      }
    };
    const [
      basara,
      characters,
      skills,
      passives,
      teams,
      formations,
      items,
      quests,
      capsules,
      gallery,
      uniforms,
      dropTables,
      dropBattles,
      dropTreasures,
      auras,
      keshins,
      souls,
      miximax,
      awakenings,
      modeChanges,
    ] = await Promise.all([
      readRows("inagle_basara", "character_id"),
      readRows("inagle_characters", "id"),
      readRows("inagle_skills", "id"),
      readRows("inagle_passives", "id"),
      readRows("inagle_teams", "id"),
      readRows("inagle_formations", "id"),
      readRows("inagle_items", "id"),
      readRows("inagle_quests", "id"),
      readRows("inagle_capsules", "id"),
      readRows("inagle_gallery", "id"),
      readRows("inagle_uniforms", "name_id"),
      readRows("inagle_drops_tables"),
      readRows("inagle_drops_battles"),
      readRows("inagle_drops_treasures"),
      optionalRows("inagle_auras"),
      optionalRows("inagle_keshins"),
      optionalRows("inagle_souls"),
      optionalRows("inagle_miximax"),
      optionalRows("inagle_awakenings"),
      optionalRows("inagle_mode_changes"),
    ]);

    if (characters.length === 0 || skills.length === 0 || teams.length === 0) {
      throw new Error("Incomplete Inagle SQL projections: characters, skills and teams are required");
    }

    return {
      basara,
      characters,
      skills,
      passives,
      teams: teams.map(row => {
        const payload = object(row.data);
        const name = row.name_fr ?? row.name_en ?? row.name_ja ?? row.id;
        return {
          ...payload,
          teamId: row.id,
          teamIdStr: row.id,
          name,
          displayName: name,
          name_FR: row.name_fr ?? undefined,
          name_EN: row.name_en ?? undefined,
          name_JA: row.name_ja ?? undefined,
          emblemId: row.emblem_url ?? row.id,
          emblems: row.emblems ?? payload.emblems,
          kits: row.kits ?? payload.kits,
          uniforms: array(payload.uniforms),
        };
      }),
      formations: formations.map(row => {
        const payload = object(row.data);
        return {
          ...payload,
          formId: row.id,
          formIdStr: row.id,
          name_FR: row.name_fr ?? undefined,
          name_EN: row.name_en ?? undefined,
          name_JA: row.name_ja ?? undefined,
          placements: array(payload.placements),
        };
      }),
      items: items.map(row => {
        const payload = object(row.data);
        return {
          ...payload,
          itemId: row.id,
          internalCode: row.internal_code ?? undefined,
          category: row.category ?? "important",
          rarity: row.rarity ?? undefined,
          names: {
            en: row.name_en ?? undefined,
            fr: row.name_fr ?? undefined,
            ja: row.name_ja ?? undefined,
          },
          descriptions: {
            en: row.description_en ?? undefined,
            fr: row.description_fr ?? undefined,
            ja: row.description_ja ?? undefined,
          },
          imageUrl: row.image_url ?? undefined,
          shops: object(row.shops) as { en: string[]; fr: string[] },
          price: row.price ?? undefined,
        };
      }),
      quests: quests.map(row => {
        const payload = object(row.data);
        const titles = object(payload.titles);
        return {
          ...payload,
          questId: row.id,
          titleHash: String(payload.titleHash ?? ""),
          phase: Number(row.phase ?? payload.phase ?? 0),
          type: Number(row.type ?? payload.type ?? 0),
          titles: {
            en: row.name_en ?? titles.en,
            fr: row.name_fr ?? titles.fr,
            ja: row.name_ja ?? titles.ja,
          },
        };
      }),
      capsules: capsules.map(row => ({
        ...object(row.data),
        capsuleId: row.id,
        capsuleIdStr: row.id,
        rarity: Number(object(row.data).rarity ?? 0),
        dropTable: array(row.prize_data),
        thumbnailPath: String(object(row.data).thumbnailPath ?? ""),
      })),
      gallery: gallery.map(row => ({
        ...object(row.data),
        galleryId: row.id,
        galleryIdStr: row.id,
        imgPath: row.img_path ?? "",
        thumbPath: row.thumb_path ?? "",
        categoryId: Number(object(row.data).categoryId ?? 0),
        unlockCondition: String(object(row.data).unlockCondition ?? ""),
      })),
      uniforms,
      drops: { tables: dropTables, battles: dropBattles, treasures: dropTreasures },
      auras,
      keshins,
      souls,
      miximax,
      awakenings,
      modeChanges,
    };
  } catch (error) {
    throw new Error("Inagle SQL projections are unavailable; run the SQL importers before starting the runtime.", {
      cause: error,
    });
  }
}
