import { eq, sql, type SQL } from "drizzle-orm";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import * as schema from "~/db/schema";
import { logger } from "~/lib/logger";

/**
 * Whitelist des tables CRUD-able depuis le dashboard.
 *
 * Pour chaque table on déclare :
 *   - `table` : la drizzle table
 *   - `pk` : nom de la colonne primary key (utilisée par GET/PUT/DELETE par id)
 *   - `readonly` : si true, seul GET autorisé
 *   - `mutableColumns` : whitelist des colonnes éditables via PUT (sécurité)
 *
 * Les tables non listées ici sont **invisibles** depuis l'API — pas de fuite
 * accidentelle. Les tables de logs / d'état runtime / de jonction (action_logs,
 * invites_log, vocal_tempo(_bans), giveaway_entries, db_*_techniques/characters)
 * sont exposées en `readonly: true` : consultables mais jamais mutables.
 * Les tables sensibles (`ba_*` better-auth, FTS5 `db_search*`/`rag_chunks*`)
 * restent volontairement hors liste.
 */

interface TableSpec {
	name: string;
	table: any;
	pk: string;
	readonly?: boolean;
	mutableColumns?: string[];
	description?: string;
}

export const TABLES: TableSpec[] = [
	{
		name: "users",
		table: schema.users,
		pk: "id",
		mutableColumns: [
			"xp",
			"zeni",
			"currentLevelRoleId",
			"lastLevelReached",
			"messageCount",
			"totalVoiceMs",
			"equippedCard",
			"equippedBadge",
			"equippedColor",
			"equippedTitle",
		],
		description: "Joueurs (XP, zeni, équipement)",
	},
	{
		name: "inventory",
		table: schema.inventory,
		pk: "id",
		mutableColumns: [],
		description: "Possessions des joueurs (read-only — utilise /custom give)",
		readonly: true,
	},
	{
		name: "shop_items",
		table: schema.shopItems,
		pk: "key",
		mutableColumns: ["name", "description", "price", "roleId", "meta", "enabled"],
		description: "Items du shop",
	},
	{
		name: "achievements",
		table: schema.achievements,
		pk: "id",
		readonly: true,
		description: "Succès débloqués par utilisateur",
	},
	{
		name: "achievement_triggers",
		table: schema.achievementTriggers,
		pk: "code",
		mutableColumns: ["description", "pattern", "flags", "enabled"],
		description: "Patterns regex de succès",
	},
	{
		name: "level_rewards",
		table: schema.levelRewards,
		pk: "level",
		mutableColumns: ["roleId", "zeniBonus", "xpThreshold"],
		description: "Niveau → rôle + bonus zeni",
	},
	{
		name: "guild_settings",
		table: schema.guildSettings,
		pk: "key",
		mutableColumns: ["value"],
		description: "Settings runtime",
	},
	{
		name: "warns",
		table: schema.warns,
		pk: "id",
		mutableColumns: ["active"],
		description: "Avertissements",
	},
	{
		name: "jails",
		table: schema.jails,
		pk: "userId",
		mutableColumns: ["expiresAt", "active"],
		description: "Joueurs en jail",
	},
	{
		name: "bans",
		table: schema.bans,
		pk: "id",
		mutableColumns: ["active"],
		description: "Bannissements persistants",
	},
	{
		name: "tickets",
		table: schema.tickets,
		pk: "id",
		mutableColumns: ["status", "closedAt"],
		description: "Tickets de support",
	},
	{
		name: "giveaways",
		table: schema.giveaways,
		pk: "id",
		mutableColumns: ["title", "description", "winners", "endsAt", "ended"],
		description: "Giveaways",
	},
	{
		name: "fusions",
		table: schema.fusions,
		pk: "id",
		readonly: true,
		description: "Fusions actives",
	},
	{
		name: "db_planets",
		table: schema.dbPlanets,
		pk: "id",
		mutableColumns: ["name", "nameJa", "nameRomaji", "image", "isDestroyed", "description"],
		description: "Wiki planètes",
	},
	{
		name: "db_characters",
		table: schema.dbCharacters,
		pk: "id",
		mutableColumns: [
			"name",
			"nameJa",
			"nameRomaji",
			"image",
			"ki",
			"maxKi",
			"race",
			"gender",
			"affiliation",
			"description",
			"originPlanetId",
		],
		description: "Wiki personnages",
	},
	{
		name: "db_transformations",
		table: schema.dbTransformations,
		pk: "id",
		mutableColumns: ["name", "image", "ki", "characterId"],
		description: "Wiki transformations",
	},
	{
		name: "db_sagas",
		table: schema.dbSagas,
		pk: "id",
		mutableColumns: ["slug", "name", "nameJa", "series", "orderIdx", "description", "image"],
		description: "Wiki sagas",
	},
	{
		name: "db_arcs",
		table: schema.dbArcs,
		pk: "id",
		mutableColumns: ["sagaId", "slug", "name", "nameJa", "orderIdx", "description"],
		description: "Wiki arcs narratifs",
	},
	{
		name: "db_episodes",
		table: schema.dbEpisodes,
		pk: "id",
		mutableColumns: [
			"series",
			"numberInSeries",
			"title",
			"titleJa",
			"titleRomaji",
			"arcId",
			"airDate",
			"durationSec",
			"synopsis",
			"image",
			"videoUrl",
			"malId",
		],
		description: "Wiki épisodes",
	},
	{
		name: "db_movies",
		table: schema.dbMovies,
		pk: "id",
		mutableColumns: [
			"slug",
			"title",
			"titleJa",
			"titleRomaji",
			"series",
			"releaseDate",
			"durationMin",
			"synopsis",
			"poster",
			"malId",
			"anilistId",
		],
		description: "Wiki films",
	},
	{
		name: "db_games",
		table: schema.dbGames,
		pk: "id",
		mutableColumns: [
			"slug",
			"title",
			"titleJa",
			"platforms",
			"releaseDate",
			"publisher",
			"developer",
			"description",
			"cover",
			"officialUrl",
		],
		description: "Wiki jeux",
	},
	{
		name: "db_manga_volumes",
		table: schema.dbMangaVolumes,
		pk: "id",
		mutableColumns: ["series", "volumeNumber", "title", "titleJa", "publishedAt", "cover", "isbn"],
		description: "Wiki tomes manga",
	},
	{
		name: "db_manga_chapters",
		table: schema.dbMangaChapters,
		pk: "id",
		mutableColumns: ["series", "chapterNumber", "title", "titleJa", "volumeId", "publishedAt"],
		description: "Wiki chapitres manga",
	},
	{
		name: "db_manga_pages",
		table: schema.dbMangaPages,
		pk: "id",
		// OCR des planches manga (texte reconnu) : correction éditoriale du texte/langue.
		mutableColumns: ["text", "lang", "hasJa"],
		description: "Wiki OCR des planches manga (texte reconnu)",
	},
	{
		name: "db_races",
		table: schema.dbRaces,
		pk: "id",
		mutableColumns: ["slug", "name", "nameJa", "homePlanetId", "description"],
		description: "Wiki races",
	},
	{
		name: "db_techniques",
		table: schema.dbTechniques,
		pk: "id",
		mutableColumns: [
			"slug",
			"name",
			"nameJa",
			"nameRomaji",
			"type",
			"creatorId",
			"description",
			"debutEpisodeId",
			"debutChapterId",
		],
		description: "Wiki techniques",
	},
	{
		name: "db_tools",
		table: schema.dbTools,
		pk: "id",
		mutableColumns: [
			"slug",
			"name",
			"description",
			"url",
			"author",
			"language",
			"category",
			"targetGameId",
			"stars",
		],
		description: "Wiki outils",
	},
	{
		name: "db_news",
		table: schema.dbNews,
		pk: "id",
		mutableColumns: [
			"sourceId",
			"sourceUrl",
			"title",
			"titleJa",
			"excerpt",
			"category",
			"publishedAt",
			"image",
		],
		description: "Wiki news",
	},
	{
		name: "db_sources",
		table: schema.dbSources,
		pk: "id",
		mutableColumns: ["name", "url", "licenseKey", "attributionTemplate"],
		description: "Wiki sources/attribution",
	},
	{
		name: "db_licenses",
		table: schema.dbLicenses,
		pk: "key",
		mutableColumns: ["name", "url", "requiresAttribution", "shareAlike"],
		description: "Wiki licences",
	},
	{
		name: "db_assets",
		table: schema.dbAssets,
		pk: "id",
		mutableColumns: [
			"path",
			"sourceId",
			"sourceUrl",
			"licenseKey",
			"attribution",
			"mimeType",
			"width",
			"height",
			"entityType",
			"entityId",
			"role",
		],
		description: "Wiki médias/assets traçables",
	},
	{
		name: "action_logs",
		table: schema.actionLogs,
		pk: "id",
		readonly: true,
		description: "Audit trail",
	},
	{
		name: "invites_log",
		table: schema.invitesLog,
		pk: "id",
		readonly: true,
		description: "Suivi des invitations (qui a invité qui)",
	},
	{
		name: "giveaway_entries",
		table: schema.giveawayEntries,
		pk: "id",
		readonly: true,
		description: "Participations aux giveaways (géré par le système de giveaway)",
	},
	{
		name: "vocal_tempo",
		table: schema.vocalTempo,
		pk: "channel_id",
		readonly: true,
		description: "Salons vocaux éphémères actifs (état runtime)",
	},
	{
		name: "vocal_tempo_bans",
		table: schema.vocalTempoBans,
		pk: "id",
		readonly: true,
		description: "Bannissements de salons vocaux éphémères",
	},
	{
		name: "db_character_techniques",
		table: schema.dbCharacterTechniques,
		pk: "character_id",
		readonly: true,
		description: "Relation personnages ↔ techniques (table de jonction)",
	},
	{
		name: "db_game_characters",
		table: schema.dbGameCharacters,
		pk: "game_id",
		readonly: true,
		description: "Relation jeux ↔ personnages (table de jonction)",
	},
];

export function getTableSpec(name: string): TableSpec | undefined {
	return TABLES.find((t) => t.name === name);
}

export async function listRows(spec: TableSpec, limit: number, offset: number) {
	const dbs = container.resolve(DatabaseService);
	const rows = await dbs.db.select().from(spec.table).limit(limit).offset(offset);
	const [{ count = 0 } = { count: 0 }] = await dbs.db
		.select({ count: sql<number>`COUNT(*)` })
		.from(spec.table);
	return { rows, total: Number(count), limit, offset };
}

export async function getRow(spec: TableSpec, id: string | number) {
	const dbs = container.resolve(DatabaseService);
	const cond = pkCond(spec, id);
	const rows = await dbs.db.select().from(spec.table).where(cond).limit(1);
	return rows[0] ?? null;
}

/**
 * Coerce les valeurs entrantes vers le type attendu par Drizzle.
 * Les colonnes `mode: "timestamp"/"timestamp_ms"` ont `dataType === "date"` :
 * Drizzle appelle `value.getTime()` à l'écriture → il faut un objet Date, pas
 * une string/number issue du formulaire dashboard.
 */
function coerceForColumns(spec: TableSpec, body: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		const col = spec.table[key];
		if (col?.dataType === "date" && value != null && !(value instanceof Date)) {
			if (value === "") {
				out[key] = null;
				continue;
			}
			const d = typeof value === "number" ? new Date(value) : new Date(String(value));
			out[key] = Number.isNaN(d.getTime()) ? value : d;
			continue;
		}
		out[key] = value;
	}
	return out;
}

export async function insertRow(spec: TableSpec, body: Record<string, unknown>) {
	if (spec.readonly) throw new Error(`Table ${spec.name} en read-only.`);
	const dbs = container.resolve(DatabaseService);
	await dbs.db.insert(spec.table).values(coerceForColumns(spec, body) as any);
}

export async function updateRow(
	spec: TableSpec,
	id: string | number,
	body: Record<string, unknown>
) {
	if (spec.readonly) throw new Error(`Table ${spec.name} en read-only.`);
	if (!spec.mutableColumns?.length) throw new Error(`Table ${spec.name} : aucune colonne mutable.`);
	const dbs = container.resolve(DatabaseService);
	const filtered: Record<string, unknown> = {};
	for (const col of spec.mutableColumns) {
		if (col in body) filtered[col] = body[col];
	}
	if (Object.keys(filtered).length === 0) {
		throw new Error("Aucune colonne mutable fournie.");
	}
	const cond = pkCond(spec, id);
	await dbs.db.update(spec.table).set(coerceForColumns(spec, filtered)).where(cond);
	logger.info({ table: spec.name, id, cols: Object.keys(filtered) }, "row updated via API");
}

export async function deleteRow(spec: TableSpec, id: string | number) {
	if (spec.readonly) throw new Error(`Table ${spec.name} en read-only.`);
	const dbs = container.resolve(DatabaseService);
	const cond = pkCond(spec, id);
	await dbs.db.delete(spec.table).where(cond);
}

function pkCond(spec: TableSpec, id: string | number): SQL {
	const col = spec.table[spec.pk];
	if (!col) throw new Error(`PK ${spec.pk} introuvable sur ${spec.name}`);
	const coerced = typeof spec.table[spec.pk]?.dataType === "number" ? Number(id) : String(id);
	return eq(col, coerced as any);
}
