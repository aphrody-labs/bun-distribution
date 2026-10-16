import { projectionSource, sqliteRows } from "../sql/sqlite-query.js";
import { gameVfsPaths, readVfsConfig } from "../core/vfs-data.js";
import { parseTextDocument } from "../parsers/text-parser.js";
/** Direct VFS text access with an explicitly selected optional PostgreSQL adapter. */
import type { createInagleSql } from "@rosegriffon/db/inagle-sql";
import type { Database } from "@rosegriffon/db/schema";
import {
  type GameText,
  type GameTextLocale,
  type GameTextLocalized,
  normalizeHashId,
} from "./shared";

export type { GameText, GameTextLocalized } from "./shared";
export { normalizeHashId, pickLocale } from "./shared";

type Db = ReturnType<typeof createInagleSql<Database>>;
let db: Db | undefined;

async function sqlDb(): Promise<Db> {
  const { createInagleSql } = await import("@rosegriffon/db/inagle-sql");
  return (db ??= createInagleSql<Database>());
}

function* vfsTexts(locale: GameTextLocale): Generator<GameText> {
  const prefix = `data/common/text/${locale}/`;
  for (const path of gameVfsPaths()) {
    if (!path.startsWith(prefix) || !path.endsWith(".cfg.bin")) continue;
    const category = path.slice(prefix.length).replace(/\.cfg\.bin$/, "");
    for (const [hashId, value] of parseTextDocument(readVfsConfig(path)))
      yield { hashId, locale, category, value };
  }
}

function like(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function group(
  rows: Array<{ hash_id: string; locale: string; category: string; value: string }>,
): Map<string, GameTextLocalized> {
  const out = new Map<string, GameTextLocalized>();
  for (const row of rows) {
    const entry = out.get(row.hash_id) ?? { hashId: row.hash_id, category: row.category };
    if (row.locale === "fr" || row.locale === "en" || row.locale === "ja")
      entry[row.locale] = row.value;
    out.set(row.hash_id, entry);
  }
  return out;
}

export async function getText(hashId: string | number): Promise<GameTextLocalized | undefined> {
  if (projectionSource() === "sqlite")
    return (await getTexts([hashId])).get(normalizeHashId(hashId));
  if (projectionSource() === "vfs") {
    const records = await getTexts([hashId]);
    return records.get(normalizeHashId(hashId));
  }
  const rows = await (
    await sqlDb()
  )
    .selectFrom("inagle_game_text")
    .select(["hash_id", "locale", "category", "value"])
    .where("hash_id", "=", normalizeHashId(hashId))
    .orderBy("locale", "asc")
    .execute();
  return group(rows).values().next().value as GameTextLocalized | undefined;
}

export async function getTextLocale(
  hashId: string | number,
  locale: GameTextLocale = "fr",
): Promise<string | undefined> {
  const text = await getText(hashId);
  return text?.[locale] ?? text?.fr ?? text?.en ?? text?.ja;
}

export async function getTexts(
  hashIds: Array<string | number>,
): Promise<Map<string, GameTextLocalized>> {
  const keys = [...new Set(hashIds.map(normalizeHashId))];
  if (keys.length === 0) return new Map();
  if (projectionSource() === "sqlite") {
    const rows = sqliteRows<{ hash_id: string; locale: string; category: string; value: string }>(
      `SELECT hash_id, locale, category, value FROM inagle_game_text WHERE hash_id IN (${keys.map(() => "?").join(",")}) ORDER BY hash_id, locale`,
      keys,
    );
    return group(rows);
  }
  if (projectionSource() === "vfs") {
    const wanted = new Set(keys);
    const rows = [];
    for (const locale of ["fr", "en", "ja"] as const)
      for (const row of vfsTexts(locale))
        if (wanted.has(row.hashId)) rows.push({ hash_id: row.hashId, ...row });
    return group(rows);
  }
  const rows = await (
    await sqlDb()
  )
    .selectFrom("inagle_game_text")
    .select(["hash_id", "locale", "category", "value"])
    .where("hash_id", "in", keys)
    .orderBy("hash_id", "asc")
    .orderBy("locale", "asc")
    .execute();
  return group(rows);
}

export async function listCategory(
  category: string,
  locale: GameTextLocale = "fr",
  limit = 200,
  offset = 0,
): Promise<GameText[]> {
  if (projectionSource() === "sqlite")
    return sqliteRows<GameText>(
      "SELECT hash_id AS hashId, locale, category, value FROM inagle_game_text WHERE category = ? AND locale = ? ORDER BY hash_id LIMIT ? OFFSET ?",
      [category, locale, Math.max(0, limit), Math.max(0, offset)],
    );
  if (projectionSource() === "vfs")
    return [...vfsTexts(locale)]
      .filter((row) => row.category === category)
      .slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, limit));
  return (await sqlDb())
    .selectFrom("inagle_game_text")
    .select(["hash_id as hashId", "locale", "category", "value"])
    .where("category", "=", category)
    .where("locale", "=", locale)
    .orderBy("hash_id", "asc")
    .limit(Math.max(0, limit))
    .offset(Math.max(0, offset))
    .execute() as Promise<GameText[]>;
}

export async function searchText(
  query: string,
  locale: GameTextLocale = "fr",
  limit = 50,
): Promise<GameText[]> {
  const value = query.trim();
  if (!value) return [];
  if (projectionSource() === "sqlite") {
    const results: GameText[] = [];
    const maximum = Math.min(Math.max(1, limit), 500);
    for (let offset = 0; ; offset += 5000) {
      const page = sqliteRows<GameText>(
        "SELECT hash_id AS hashId, locale, category, value FROM inagle_game_text WHERE locale = ? ORDER BY hash_id LIMIT 5000 OFFSET ?",
        [locale, offset],
      );
      for (const row of page) {
        if (row.value.toLowerCase().includes(value.toLowerCase())) results.push(row);
        if (results.length >= maximum) return results;
      }
      if (page.length < 5000) return results;
    }
  }
  if (projectionSource() === "vfs") {
    const results = [];
    const maximum = Math.min(Math.max(1, limit), 500);
    for (const row of vfsTexts(locale)) {
      if (row.value.toLowerCase().includes(value.toLowerCase())) results.push(row);
      if (results.length >= maximum) break;
    }
    return results;
  }
  return (await sqlDb())
    .selectFrom("inagle_game_text")
    .select(["hash_id as hashId", "locale", "category", "value"])
    .where("locale", "=", locale)
    .where("value", "ilike", like(value))
    .orderBy("hash_id", "asc")
    .limit(Math.min(Math.max(1, limit), 500))
    .execute() as Promise<GameText[]>;
}

export async function categoryStats(): Promise<Array<{ category: string; count: number }>> {
  if (projectionSource() === "sqlite")
    return sqliteRows<{ category: string; count: number }>(
      "SELECT category, count(*) AS count FROM inagle_game_text WHERE locale = 'fr' GROUP BY category ORDER BY count DESC",
    );
  if (projectionSource() === "vfs") {
    const counts = new Map<string, number>();
    for (const row of vfsTexts("fr")) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    return [...counts]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }
  const rows = await (
    await sqlDb()
  )
    .selectFrom("inagle_game_text")
    .select((eb) => ["category", eb.fn.countAll<number>().as("count")])
    .where("locale", "=", "fr")
    .groupBy("category")
    .orderBy("count", "desc")
    .execute();
  return rows.map((row) => ({ category: row.category, count: Number(row.count) }));
}
