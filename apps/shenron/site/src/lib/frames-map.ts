/**
 * frames-map — résolution Postgres des correspondances de frames.
 *
 * Les règles pures (AniList → série, lien horodaté) vivent dans
 * `frames-map-shared.ts` : ce module impose `server-only`, ce qui les rendrait
 * intestables. Réexportées ici pour ne rien casser côté appelants.
 */
import "server-only";
import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { botEpisodes, botMovies } from "@/db/bot-schema";
import { assetUrl } from "@/lib/assets";
import { sansAccents } from "@/lib/pg-unaccent";
import {
	episodeKey,
	movieIdForMatch,
	movieKey,
	seriesForMatch,
	type FrameMatchLike,
	type SiteEpisodeRef,
} from "@/lib/frames-map-shared";
import { extraitAutour, normaliser, scorer } from "@/lib/manga-search-rules";

export {






	formatTimecode,
	isDragonBallMatch,


	MAX_FRAME_IMAGE_BYTES,




	siteRefFor,

	sortFrameMatches,
	validateFrameImage,

	type FrameMatchLike,

	type SiteEpisodeRef,
} from "@/lib/frames-map-shared";

/**
 * Résout un lot de correspondances en fiches épisodes et films du site.
 *
 * Un lot, pas une boucle de requêtes : dix correspondances ne doivent pas
 * coûter dix allers-retours Postgres sur une route déjà limitée à 30 s.
 */
export async function resolveSiteEpisodes(
	matches: ReadonlyArray<FrameMatchLike>
): Promise<Map<string, SiteEpisodeRef>> {
	const wanted = new Map<string, { series: string; episode: number }>();
	const movieIds = new Set<number>();
	for (const m of matches) {
		const movieId = movieIdForMatch(m);
		if (movieId != null) {
			movieIds.add(movieId);
			continue;
		}
		const series = seriesForMatch(m);
		if (!series || m.episode == null || !Number.isFinite(m.episode)) continue;
		wanted.set(episodeKey(series, m.episode), { series, episode: m.episode });
	}

	const out = new Map<string, SiteEpisodeRef>();
	// Films de l'index local (`movie:<id>`) ou identifiés via trace.moe (AniList)
	if (movieIds.size > 0) {
		const films = await db
			.select({
				id: botMovies.id,
				slug: botMovies.slug,
				title: botMovies.title,
				series: botMovies.series,
				poster: botMovies.poster,
			})
			.from(botMovies)
			.where(inArray(botMovies.id, [...movieIds]));
		for (const f of films) {
			out.set(movieKey(f.id), {
				id: f.id,
				series: f.series ?? "MOVIE",
				numberInSeries: null,
				title: f.title,
				href: `/wiki/films/${f.slug}`,
				image: f.poster ? assetUrl(f.poster) : null,
			});
		}
	}
	if (wanted.size === 0) return out;

	const seriesList = [...new Set([...wanted.values()].map((w) => w.series))];
	const numbers = [...new Set([...wanted.values()].map((w) => w.episode))];

	const rows = await db
		.select({
			id: botEpisodes.id,
			series: botEpisodes.series,
			numberInSeries: botEpisodes.numberInSeries,
			title: botEpisodes.title,
			image: botEpisodes.image,
		})
		.from(botEpisodes)
		.where(
			and(inArray(botEpisodes.series, seriesList), inArray(botEpisodes.numberInSeries, numbers))
		);

	for (const r of rows) {
		if (r.numberInSeries == null) continue;
		const key = episodeKey(r.series, r.numberInSeries);
		if (!wanted.has(key)) continue;
		out.set(key, {
			id: r.id,
			series: r.series,
			numberInSeries: r.numberInSeries,
			title: r.title,
			href: `/wiki/episodes/${r.id}`,
			image: r.image ? assetUrl(r.image) : null,
		});
	}
	return out;
}

/* ───────────── Recherche inverse : du texte vers les scènes ───────────── */

export type SceneTrouvee = {
	id: number;
	series: string;
	numberInSeries: number | null;
	title: string | null;
	image: string | null;
	extrait: string;
	score: number;
	href: string;
};

/**
 * Le sens inverse du Frame Finder : une phrase → les épisodes où la scène se
 * trouve.
 *
 * Tant que l'index local frame par frame est vide, aucune frame ne porte de
 * légende : on cherche donc dans ce qui décrit réellement une scène — le titre
 * et le synopsis de l'épisode — avec le même algorithme de rappel que les
 * planches (trigrammes sans accents) et le même classement. Le jour où les
 * frames seront légendées, c'est ici qu'elles viendront s'ajouter.
 */
export async function chercherScenes(q: string, limit = 8): Promise<SceneTrouvee[]> {
	const terme = q.trim().slice(0, 120);
	if (terme.length < 2) return [];
	const norm = normaliser(terme);
	const max = Math.min(Math.max(limit, 1), 30);

	const corpusNorm = await sansAccents(sql`concat_ws(' ', title, synopsis_fr, synopsis)`);

	const rows = await db.execute<{
		id: number;
		series: string;
		number_in_series: number | null;
		title: string | null;
		image: string | null;
		corpus: string;
		sim: number;
	}>(sql`
		SELECT id, series, number_in_series, title, image,
			concat_ws(' — ', title, synopsis_fr, synopsis) AS corpus,
			word_similarity(${norm}, ${corpusNorm})::float8 AS sim
		FROM bot.db_episodes
		WHERE visible IS NOT FALSE
			AND (
				${corpusNorm} LIKE ${"%" + norm + "%"}
				OR word_similarity(${norm}, ${corpusNorm}) >= 0.5
			)
		ORDER BY sim DESC
		LIMIT ${max * 4}
	`);

	return rows
		.map((r) => ({ r, d: scorer(r.corpus, terme, Number(r.sim) || 0) }))
		.filter((x) => x.d.score > 0)
		.toSorted((a, b) => b.d.score - a.d.score || Number(a.r.id) - Number(b.r.id))
		.slice(0, max)
		.map(({ r, d }) => ({
			id: Number(r.id),
			series: r.series,
			numberInSeries: r.number_in_series,
			title: r.title,
			image: r.image ? assetUrl(r.image) : null,
			extrait: extraitAutour(r.corpus, terme, 180),
			score: d.score,
			href: `/wiki/episodes/${r.id}`,
		}));
}
