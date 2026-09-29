/**
 * Liste **client-safe** des tables wiki éditoriales dont Neon (schéma `bot`) est
 * la source de vérité, + leur schéma statique (pk + colonnes mutables) en
 * **camelCase** (clés des objets Drizzle `bot-schema.ts`, alignées sur le contrat
 * de l'API bot `/api/database`).
 *
 * Ce module ne contient QUE des constantes — aucun import Drizzle/server-only —
 * pour pouvoir être importé depuis les Client Components (`DbCrud`, éditeur
 * générique) afin de router l'écriture vers `/api/wiki-admin` plutôt que vers le
 * proxy bot `/api/bot-admin/database`, et de fournir le schéma de formulaire sans
 * aller-retour réseau vers le bot.
 *
 * La logique d'accès DB (lecture/écriture Neon) vit dans `wiki-admin.ts`
 * (`import "server-only"`). Garder les deux listes synchronisées.
 */

export interface WikiTableSpec {
	name: string;
	/** pk simple ("id" | "key" | "slug") ou composite (deux colonnes snake_case). */
	pk: string | [string, string];
	mutableColumns: string[];
}

/** Schéma statique par table — camelCase (clés Drizzle), miroir de l'API bot. */
export const WIKI_TABLE_SPECS: Record<string, WikiTableSpec> = {
	db_characters: {
		name: "db_characters",
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
			"debutEpisodeId",
			"debutChapterId",
			"debutSagaId",
			// jsonb stats : CharacterStatsPanel (exclu SmartField via JSONB_PANEL_COLS).
			"stats",
			// Article long-format : édité au script jusqu'au 2026-08-26, désormais
			// éditable au studio et proposable par la communauté.
			"article",
		],
	},
	db_planets: {
		name: "db_planets",
		pk: "id",
		mutableColumns: [
			"name",
			"nameJa",
			"nameRomaji",
			"image",
			"isDestroyed",
			"description",
			"article",
		],
	},
	db_transformations: {
		name: "db_transformations",
		pk: "id",
		mutableColumns: ["name", "image", "ki", "characterId", "article"],
	},
	db_races: {
		name: "db_races",
		pk: "id",
		mutableColumns: ["slug", "name", "nameJa", "homePlanetId", "description", "article"],
	},
	db_techniques: {
		name: "db_techniques",
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
			"article",
		],
	},
	db_character_techniques: {
		name: "db_character_techniques",
		pk: ["character_id", "technique_id"],
		mutableColumns: ["characterId", "techniqueId"],
	},
	db_character_arcs: {
		name: "db_character_arcs",
		pk: ["character_id", "arc_id"],
		mutableColumns: ["characterId", "arcId", "note", "appearanceImage"],
	},
	db_sagas: {
		name: "db_sagas",
		pk: "id",
		mutableColumns: [
			"slug",
			"name",
			"nameJa",
			"series",
			"orderIdx",
			"description",
			"image",
			"article",
		],
	},
	db_arcs: {
		name: "db_arcs",
		pk: "id",
		mutableColumns: ["sagaId", "slug", "name", "nameJa", "orderIdx", "description", "article"],
	},
	db_episodes: {
		name: "db_episodes",
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
	},
	db_manga_volumes: {
		name: "db_manga_volumes",
		pk: "id",
		mutableColumns: ["series", "volumeNumber", "title", "titleJa", "publishedAt", "cover", "isbn"],
	},
	db_databooks: {
		name: "db_databooks",
		pk: "id",
		// Un seul champ catégorie (Art Book, Saikyō Jump, V-Jump…).
		// `kind` est dérivé auto côté wiki-admin — plus dans le formulaire.
		mutableColumns: [
			"category",
			"title",
			"titleJa",
			"author",
			"publishedAt",
			"cover",
			"description",
			"sourceUrl",
			// jsonb pages : DatabookPagesPanel (exclu du formulaire SmartField).
			"pages",
		],
	},
	db_manga_chapters: {
		name: "db_manga_chapters",
		pk: "id",
		mutableColumns: ["series", "chapterNumber", "title", "titleJa", "volumeId", "publishedAt"],
	},
	db_manga_pages: {
		name: "db_manga_pages",
		pk: "id",
		// OCR planches : édition text/lang/hasJa (pas de réécriture bulk des 12k lignes).
		mutableColumns: [
			"series",
			"tome",
			"planche",
			"lines",
			"text",
			"lang",
			"hasJa",
			"lineCount",
			"charCount",
		],
	},
	db_movies: {
		name: "db_movies",
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
			"trailerUrl",
		],
	},
	db_games: {
		name: "db_games",
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
			// jsonb media : GameMediaPanel (exclu du formulaire SmartField).
			"media",
		],
	},
	db_game_characters: {
		name: "db_game_characters",
		pk: ["game_id", "character_id"],
		mutableColumns: ["gameId", "characterId"],
	},
	db_tools: {
		name: "db_tools",
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
	},
	// Actualités : lues en Postgres par /wiki/news. Absentes de cette liste, l'admin
	// /admin/database/db_news écrivait via le bot, qui refuse toute écriture `db_*`
	// (409 « Wiki en lecture seule côté bot ») : aucune édition n'aboutissait.
	db_news: {
		name: "db_news",
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
	},
	db_character_variants: {
		name: "db_character_variants",
		pk: "id",
		mutableColumns: [
			"characterId",
			"sagaId",
			"slug",
			"label",
			"displayName",
			"nameJa",
			"form",
			"image",
			"age",
			"powerLevel",
			"ki",
			"maxKi",
			"role",
			"affiliation",
			"summary",
			"highlights",
			"transformationIds",
			"techniqueIds",
			"firstVolume",
			"lastVolume",
			// `origin` est mutable À DESSEIN : c'est en le passant à "editorial"
			// qu'un rédacteur soustrait sa variante aux remesures automatiques.
			"origin",
			"sortOrder",
			"visible",
		],
	},
	db_wiki_sections: {
		name: "db_wiki_sections",
		pk: "id",
		mutableColumns: [
			"entityType",
			"entityId",
			"key",
			"label",
			"accent",
			"body",
			"groupLabel",
			"links",
			"sortOrder",
			"visible",
		],
	},
	// Rubriques d'expansion : mêmes droits d'édition et de contribution que les
	// rubriques historiques. Sans spec, leurs fiches n'avaient ni barre
	// d'édition, ni correction communautaire, ni historique de révisions.
	db_battles: {
		name: "db_battles",
		pk: "id",
		mutableColumns: [
			"slug",
			"title",
			"titleJa",
			"sagaId",
			"arcId",
			"series",
			"winnerId",
			"winnerName",
			"location",
			"mangaVolumeStart",
			"mangaVolumeEnd",
			"mangaChapterStart",
			"mangaChapterEnd",
			"episodeStart",
			"episodeEnd",
			"climaxSummary",
			"canon",
			"impactLevel",
			"article",
			"visible",
		],
	},
	db_items: {
		name: "db_items",
		pk: "id",
		mutableColumns: [
			"slug",
			"name",
			"nameJa",
			"nameRomaji",
			"category",
			"creator",
			"description",
			"debutChapter",
			"debutEpisode",
			"image",
			"article",
			"visible",
		],
	},
	db_dragons: {
		name: "db_dragons",
		pk: "id",
		mutableColumns: [
			"slug",
			"name",
			"nameJa",
			"creator",
			"planetRealm",
			"ballsCount",
			"ballsDiameter",
			"summonPhrase",
			"summonPhraseJa",
			"wishesCount",
			"cooldown",
			"rules",
			"image",
			"article",
			"visible",
		],
	},
	db_wishes: {
		name: "db_wishes",
		pk: "id",
		mutableColumns: [
			"dragonId",
			"dragonName",
			"wishNumberInSummon",
			"whisperer",
			"saga",
			"mangaChapter",
			"episodeNumber",
			"wishText",
			"granted",
			"canon",
			"visible",
		],
	},
	db_locations: {
		name: "db_locations",
		pk: "id",
		mutableColumns: [
			"slug",
			"name",
			"nameJa",
			"nameRomaji",
			"realmType",
			"planet",
			"description",
			"debutChapter",
			"debutEpisode",
			"image",
			"article",
			"visible",
		],
	},
	db_tournaments: {
		name: "db_tournaments",
		pk: "id",
		mutableColumns: [
			"slug",
			"name",
			"nameJa",
			"tournamentType",
			"saga",
			"location",
			"winnerName",
			"runnerUpName",
			"rulesSummary",
			"participantsCount",
			"canon",
			"article",
			"visible",
		],
	},
	db_voice_actors: {
		name: "db_voice_actors",
		pk: "id",
		mutableColumns: [
			"slug",
			"name",
			"nameJa",
			"nationality",
			"birthDate",
			"biography",
			"image",
			"article",
			"visible",
		],
	},
	db_soundtracks: {
		name: "db_soundtracks",
		pk: "id",
		mutableColumns: [
			"slug",
			"title",
			"titleJa",
			"titleRomaji",
			"trackType",
			"series",
			"artist",
			"composer",
			"lyricist",
			"episodesRange",
			"releaseYear",
			"description",
			"article",
			"visible",
		],
	},
	db_power_levels: {
		name: "db_power_levels",
		pk: "id",
		mutableColumns: [
			"characterId",
			"characterName",
			"form",
			"sagaId",
			"sagaName",
			"battlePower",
			"battlePowerDisplay",
			"scouterDevice",
			"sourceKind",
			"sourcePage",
			"canon",
			"notes",
			"visible",
		],
	},
	db_timeline_events: {
		name: "db_timeline_events",
		pk: "id",
		mutableColumns: [
			"ageYear",
			"ageMonth",
			"ageDay",
			"era",
			"title",
			"titleJa",
			"description",
			"sourceRef",
			"canon",
			"orderIdx",
			"visible",
		],
	},
	db_sources: {
		name: "db_sources",
		pk: "id",
		mutableColumns: ["name", "url", "licenseKey", "attributionTemplate"],
	},
	db_licenses: {
		name: "db_licenses",
		pk: "key",
		mutableColumns: ["name", "url", "requiresAttribution", "shareAlike"],
	},
	db_assets: {
		name: "db_assets",
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
	},
};

/** Noms des tables wiki éditoriales (Neon source de vérité). */
export const WIKI_TABLE_NAMES = Object.keys(WIKI_TABLE_SPECS);

/** True si l'écriture/lecture de `table` doit passer par `/api/wiki-admin`. */
export function isWikiTable(name: string): boolean {
	return name in WIKI_TABLE_SPECS;
}

/**
 * Base path CRUD pour une table : `/api/wiki-admin` (Neon direct) pour les tables
 * wiki éditoriales, sinon `/api/bot-admin/database` (proxy API bot) — inchangé
 * pour users/shop_items/level_rewards/db_news/etc.
 */
export function crudBase(table: string): string {
	return isWikiTable(table) ? "/api/wiki-admin" : "/api/bot-admin/database";
}
