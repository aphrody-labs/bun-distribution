/**
 * Liste des tables du **wiki éditorial** dont Neon `bot.*` est la SOURCE DE
 * VÉRITÉ (édité par le site via Server Actions). Partagée par les deux scripts
 * de sync sans side-effect :
 *   - sync-sqlite-to-neon.ts (forward, runtime+news) les EXCLUT.
 *   - sync-neon-to-sqlite.ts (reverse, wiki) les rafraîchit Neon→SQLite.
 *
 * `db_news` n'en fait PAS partie (écrit par le bot en runtime → forward-mirroré).
 */
export const WIKI_EDITORIAL = [
	"media_works",
	"media_editions",
	"media_volumes",
	"media_chapters",
	"media_page_assets",
	"media_page_refs",
	"narrative_timelines",
	"narrative_events",
	"narrative_event_aliases",
	"narrative_event_participants",
	"narrative_event_relations",
	"contributors",
	"contributor_credits",
	"db_media_publications",
	"db_characters",
	"db_planets",
	"db_transformations",
	"db_races",
	"db_techniques",
	"db_character_techniques",
	"db_sagas",
	"db_arcs",
	"db_episodes",
	"db_manga_volumes",
	"db_manga_chapters",
	"db_movies",
	"db_games",
	"db_game_characters",
	"db_tools",
	"db_sources",
	"db_licenses",
	"db_assets",
	// Piliers encyclopédiques : créés et enrichis directement dans PG
	// (scripts/ops/create-mega-data-tables.ts, enrich-lore-batch.ts). Mirrorés
	// SQLite→Neon, ils étaient DROP puis recréés toutes les 30 min avec `visible`
	// en bigint, ce qui cassait les requêtes booléennes du site et écrasait toute
	// édition faite dans PG.
	"db_battles",
	"db_items",
	"db_dragons",
	"db_wishes",
	"db_timeline_events",
	"db_power_levels",
	"db_locations",
	"db_tournaments",
	"db_voice_actors",
	"db_soundtracks",
] as const;
