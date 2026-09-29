/**
 * episode-frames.ts — Contrat partagé du type `EpisodeFrame` (feature « Scènes
 * d'épisode »).
 *
 * Vit dans `src/db/` (et non dans `scripts/lib/`) pour que le schéma Drizzle
 * (`schema.ts`, colonne `db_episodes.frames`) puisse `$type<EpisodeFrame[]>()`
 * sans inverser la dépendance src → scripts. La fondation pipeline
 * `scripts/lib/frames-common.ts` ré-exporte ces types depuis ici.
 *
 * Le site (`apps/shenron/site/`) s'aligne sur CE shape (colonne Neon `bot.db_episodes.frames`
 * jsonb = `EpisodeFrame[]`).
 */

/** Séries DBZ reconnues côté `db_episodes.series`. */
export type Series = "DB" | "DBZ" | "DBGT" | "DBS" | "DB_DAIMA" | "DBZ_KAI" | "DBZ_KAI_FINAL";

/**
 * Une frame extraite/scrapée d'un épisode. Schéma stable, repris du
 * `AnimeFrameImport` rpbey et adapté au modèle shenron (asset self-host sous
 * `apps/shenron/bot/assets/`).
 */
export interface EpisodeFrame {
	/** Provenance : "ffmpeg" (vidéo locale). */
	source: "ffmpeg";
	/** Id stable côté source (ex. `ffmpeg:dbz:001:00042`). */
	sourceId: string;
	/** URL/chemin d'origine (page wiki, ou chemin de la vidéo source). */
	sourceUrl: string | null;
	/** Numéro d'épisode dans la série (= `db_episodes.number_in_series`). */
	episodeNumber: number;
	/**
	 * Chemin d'asset bot RELATIF (`./assets/ext/db_episodes_frames/...`) — servi
	 * via `bot.dragonballfr.com/assets/...`. null pour un dry-run (frame non écrite).
	 */
	imagePath: string | null;
	/** Timecode dans l'épisode en secondes. */
	timecodeSec: number | null;
	width: number | null;
	height: number | null;
	/** Noms de personnages présents (rempli par le merge, livrable séparé). */
	characterNames: string[];
	tags: string[];
	caption: string | null;
	/** Frame marquante (ex. scene-cut fort, épisode de combat). */
	isNotable: boolean;
	/** Ordre stable pour l'affichage. */
	sortOrder: number;
}
