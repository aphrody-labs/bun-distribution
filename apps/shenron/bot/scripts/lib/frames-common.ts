/**
 * frames-common.ts — Fondation partagée du pipeline « frames d'épisode » DBZ.
 *
 * Réplique l'architecture rpbey (apps/web/scripts/lib/ghost-scraper.ts) : un type
 * de frame stable, une écriture NON-DESTRUCTIVE (jamais d'écrasement par du vide),
 * et un mapping commun frame ↔ épisode ↔ personnage. Deux producteurs partagent
 * ce contrat :
 *   - extract-dbz-frames.ts   → ffmpeg sur vidéo locale (scene-detection + fps, webp)
 *
 * Le producteur qui aspirait des screencaps depuis Fandom a été retiré : source
 * interdite (cf. CLAUDE.md).
 *
 * AUCUNE écriture DB ici. La sortie est un dataset JSON + des fichiers webp/jpg sur
 * disque ; l'ingestion dans `db_episodes` (Neon, gardé) se fait séparément.
 *
 * Bun-only : `Bun.write`, `Bun.file`, `Bun.spawn`. Pas de node/npm/tsx.
 */

// Le type `EpisodeFrame` (et `Series`) vit désormais dans `src/db/episode-frames.ts`
// pour que le schéma Drizzle puisse le `$type<EpisodeFrame[]>()` sans inverser la
// dépendance src → scripts. On le ré-exporte ici pour préserver l'API du pipeline.
export type { EpisodeFrame, Series } from "../../src/db/episode-frames.js";
import type { EpisodeFrame, Series } from "../../src/db/episode-frames.js";

/** Enveloppe du dataset écrit sur disque, par (série, épisode). */
export interface FramesDataset {
	series: Series;
	episodeNumber: number;
	/** Id `db_episodes` si connu (résolu à l'ingestion sinon). */
	episodeId: number | null;
	source: EpisodeFrame["source"];
	/** Métadonnées de la source (chemin vidéo, durée, params ffmpeg, ou URL wiki). */
	meta: Record<string, unknown>;
	scrapedAt: string;
	frames: EpisodeFrame[];
}

/**
 * Écriture NON-DESTRUCTIVE + atomique (calquée sur `writeIfNonEmpty` rpbey) :
 * refuse d'écraser une sortie existante par un payload vide (0 frame) — un échec
 * d'extraction/scrape ne doit pas détruire un dataset déjà constitué.
 */
export async function writeDatasetIfNonEmpty(
	path: string,
	dataset: FramesDataset
): Promise<boolean> {
	const count = dataset.frames.length;
	if (count <= 0) {
		console.error(`  ✗ 0 frame → ${path} PRÉSERVÉ (non-destructif).`);
		return false;
	}
	const tmp = `${path}.tmp`;
	await Bun.write(tmp, JSON.stringify(dataset, null, 2));
	await Bun.write(path, Bun.file(tmp));
	await Bun.file(tmp)
		.unlink?.()
		.catch(() => {});
	console.log(`  ✓ ${count} frame(s) → ${path}`);
	return true;
}

/** Padding cohérent pour les noms de fichiers/dossiers (ep007, 00042). */
export function pad(n: number, width: number): string {
	return String(n).padStart(width, "0");
}

/**
 * Résout (best-effort, lecture seule) l'`id` et le `number_in_series` d'un
 * épisode depuis le SQLite local, sans jamais écrire. Sert à nommer les assets et
 * pré-câbler `episodeId` dans le dataset. Renvoie null si la DB est absente.
 */
export function resolveEpisode(
	series: Series,
	numberInSeries: number
): { id: number; numberInSeries: number } | null {
	const dbPath = new URL("../../data/bot.db", import.meta.url).pathname;
	try {
		// Import paresseux : un dry-run sans DB ne doit pas planter.
		const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
		const db = new Database(dbPath, { readonly: true });
		try {
			const row = db
				.query(
					"SELECT id, number_in_series AS n FROM db_episodes WHERE series = ? AND number_in_series = ? LIMIT 1"
				)
				.get(series, numberInSeries) as { id: number; n: number } | null;
			return row ? { id: row.id, numberInSeries: row.n } : null;
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}
