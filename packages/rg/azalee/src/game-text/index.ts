/** Accès SQL canonique aux textes de jeu IEVR. */
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import type { Database } from "@rosegriffon/db/schema";
import {
	type GameText,
	type GameTextLocale,
	type GameTextLocalized,
	normalizeHashId,
} from "./shared";

export type { GameText, GameTextLocalized } from "./shared";
export { normalizeHashId, pickLocale } from "./shared";

type Db = ReturnType<typeof createAchilleaSql<Database>>;
let db: Db | undefined;

function sqlDb(): Db {
	return (db ??= createAchilleaSql<Database>());
}

function like(value: string): string {
	return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function group(rows: Array<{ hash_id: string; locale: string; category: string; value: string }>): Map<string, GameTextLocalized> {
	const out = new Map<string, GameTextLocalized>();
	for (const row of rows) {
		const entry = out.get(row.hash_id) ?? { hashId: row.hash_id, category: row.category };
		if (row.locale === "fr" || row.locale === "en" || row.locale === "ja") entry[row.locale] = row.value;
		out.set(row.hash_id, entry);
	}
	return out;
}

export async function getText(hashId: string | number): Promise<GameTextLocalized | undefined> {
	const rows = await sqlDb()
		.selectFrom("inagle_game_text")
		.select(["hash_id", "locale", "category", "value"])
		.where("hash_id", "=", normalizeHashId(hashId))
		.orderBy("locale", "asc")
		.execute();
	return group(rows).values().next().value as GameTextLocalized | undefined;
}

export async function getTextLocale(hashId: string | number, locale: GameTextLocale = "fr"): Promise<string | undefined> {
	const text = await getText(hashId);
	return text?.[locale] ?? text?.fr ?? text?.en ?? text?.ja;
}

export async function getTexts(hashIds: Array<string | number>): Promise<Map<string, GameTextLocalized>> {
	const keys = [...new Set(hashIds.map(normalizeHashId))];
	if (keys.length === 0) return new Map();
	const rows = await sqlDb()
		.selectFrom("inagle_game_text")
		.select(["hash_id", "locale", "category", "value"])
		.where("hash_id", "in", keys)
		.orderBy("hash_id", "asc")
		.orderBy("locale", "asc")
		.execute();
	return group(rows);
}

export async function listCategory(category: string, locale: GameTextLocale = "fr", limit = 200, offset = 0): Promise<GameText[]> {
	return sqlDb()
		.selectFrom("inagle_game_text")
		.select(["hash_id as hashId", "locale", "category", "value"])
		.where("category", "=", category)
		.where("locale", "=", locale)
		.orderBy("hash_id", "asc")
		.limit(Math.max(0, limit))
		.offset(Math.max(0, offset))
		.execute() as Promise<GameText[]>;
}

export async function searchText(query: string, locale: GameTextLocale = "fr", limit = 50): Promise<GameText[]> {
	const value = query.trim();
	if (!value) return [];
	return sqlDb()
		.selectFrom("inagle_game_text")
		.select(["hash_id as hashId", "locale", "category", "value"])
		.where("locale", "=", locale)
		.where("value", "ilike", like(value))
		.orderBy("hash_id", "asc")
		.limit(Math.min(Math.max(1, limit), 500))
		.execute() as Promise<GameText[]>;
}

export async function categoryStats(): Promise<Array<{ category: string; count: number }>> {
	const rows = await sqlDb()
		.selectFrom("inagle_game_text")
		.select((eb) => ["category", eb.fn.countAll<number>().as("count")])
		.where("locale", "=", "fr")
		.groupBy("category")
		.orderBy("count", "desc")
		.execute();
	return rows.map((row) => ({ category: row.category, count: Number(row.count) }));
}
