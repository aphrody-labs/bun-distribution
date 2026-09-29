/**
 * Revalidation ISR des pages publiques du wiki après une écriture éditoriale.
 * Extrait du route handler `/api/wiki-admin` pour être partagé avec le retour
 * arrière (`/api/wiki-history`). Server-only (utilise `next/cache` + `getWikiRow`).
 *
 * Ne JAMAIS laisser une revalidation faire échouer l'écriture : tout est
 * best-effort (try/catch), la source de vérité reste la DB.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { getWikiRow } from "@/lib/wiki-admin";
import { publicEntityUrl } from "@/lib/wiki-fields";

/** Pages liste publiques par table (revalidées à chaque écriture). */
const WIKI_LIST_PATHS: Record<string, string[]> = {
	db_characters: ["/wiki/personnages"],
	db_planets: ["/wiki/lieux", "/wiki/cosmologie"],
	db_sagas: ["/wiki/sagas"],
	db_arcs: ["/wiki/sagas"],
	db_movies: ["/wiki/films"],
	db_games: ["/wiki/jeux"],
	db_manga_volumes: ["/wiki/manga"],
	db_manga_chapters: ["/wiki/manga"],
	db_episodes: ["/wiki/episodes"],
	db_techniques: ["/wiki/techniques"],
	db_races: ["/wiki/races"],
	db_tools: ["/wiki/tools"],
	db_news: ["/wiki/news"],
	db_databooks: ["/wiki/databooks"],
};

/** entity_type d'une section → table wiki de l'entité parente (revalidation). */
const SECTION_ENTITY_TABLE: Record<string, string> = {
	character: "db_characters",
	planet: "db_planets",
	saga: "db_sagas",
	arc: "db_arcs",
	race: "db_races",
	technique: "db_techniques",
	game: "db_games",
	movie: "db_movies",
};

/**
 * Purge le cache ISR des pages publiques impactées par une écriture wiki, pour
 * que l'édition apparaisse tout de suite (au lieu d'attendre la revalidation).
 */
export function revalidateWikiEntity(table: string, row?: Record<string, unknown>): void {
	try {
		for (const p of WIKI_LIST_PATHS[table] ?? []) revalidatePath(p);
		revalidatePath("/wiki");
		const detail = row ? publicEntityUrl(table, row) : null;
		if (detail) revalidatePath(detail);
		// Les transformations n'ont pas de page propre → elles s'affichent sur la
		// fiche du personnage.
		if (table === "db_transformations" && row?.characterId != null) {
			revalidatePath(`/wiki/personnages/${row.characterId}`);
		}
	} catch {
		/* best-effort : ne jamais faire échouer l'écriture pour une revalidation */
	}
}

/**
 * Purge la page détail de l'entité parente quand une de ses sections change
 * (best-effort : résout le slug/id via la table parente puis `publicEntityUrl`).
 */
export async function revalidateSectionParent(
	row: Record<string, unknown> | undefined
): Promise<void> {
	try {
		if (!row) return;
		const entityType = typeof row.entityType === "string" ? row.entityType : "";
		const entityId = row.entityId;
		const table = SECTION_ENTITY_TABLE[entityType];
		if (!table || entityId == null) return;
		const parent = await getWikiRow(table, String(entityId)).catch(() => null);
		const url = parent ? publicEntityUrl(table, parent) : null;
		if (url) revalidatePath(url);
	} catch {
		/* best-effort */
	}
}
