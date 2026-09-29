/**
 * home-bestof-data — assemblage **server-only** des view-models de la section
 * « Best of des sagas » de la home.
 *
 * Tout le contenu affiché vient du Postgres `bot.*` (source de vérité wiki) :
 * fiches sagas (nom, description, artwork), épisodes échantillonnés dans les
 * bornes canon, affiches des films, couvertures des tomes. La curation
 * (`lib/home-bestof.ts`, client-safe) ne fige que les bornes canon et le ton.
 * Défensif comme le reste de la home : toute erreur ⇒ [] (panneau masqué),
 * jamais de throw vers la page.
 */
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { botSagas, botEpisodes, botMovies, botMangaVolumes } from "@/db/bot-schema";
import { assetUrl } from "@/lib/assets";
import {
	BESTOF_CURATION,
	BESTOF_EPISODES_PER_SAGA,
	BESTOF_TOMES_PER_SAGA,
	BESTOF_SERIES_LABELS,
	BESTOF_SERIES_YEARS,
	bestofAccent,
	type BestOfMediaItem,
	type BestOfSagaView,
} from "@/lib/home-bestof";

/** Échantillonnage régulier de `n` éléments (bornes incluses, ordre préservé). */
function sampleEvenly<T>(rows: readonly T[], n: number): T[] {
	if (rows.length <= n) return [...rows];
	const out: T[] = [];
	for (let i = 0; i < n; i++) {
		out.push(rows[Math.round((i * (rows.length - 1)) / (n - 1))]);
	}
	return out;
}

const movieYear = (releaseDate: number | null): string | null =>
	releaseDate ? String(new Date(releaseDate * 1000).getFullYear()) : null;

/** View-models best-of, dans l'ordre de la curation. Ne throw jamais. */
export async function getSagaBestOf(): Promise<BestOfSagaView[]> {
	try {
		const slugs = BESTOF_CURATION.map((c) => c.slug);
		const epSeries = [
			...new Set(BESTOF_CURATION.flatMap((c) => (c.episodes ? [c.episodes.series] : []))),
		];
		const tomeSeries = [
			...new Set(BESTOF_CURATION.flatMap((c) => (c.tomes ? [c.tomes.series] : []))),
		];
		const movieSlugs = [...new Set(BESTOF_CURATION.flatMap((c) => c.movieSlugs ?? []))];

		const [sagas, episodes, movies, volumes] = await Promise.all([
			db
				.select({
					slug: botSagas.slug,
					name: botSagas.name,
					description: botSagas.description,
					image: botSagas.image,
				})
				.from(botSagas)
				.where(and(inArray(botSagas.slug, slugs), eq(botSagas.visible, true))),
			epSeries.length
				? db
						.select({
							id: botEpisodes.id,
							series: botEpisodes.series,
							num: botEpisodes.numberInSeries,
							title: botEpisodes.title,
							image: botEpisodes.image,
						})
						.from(botEpisodes)
						.where(and(inArray(botEpisodes.series, epSeries), eq(botEpisodes.visible, true)))
						.orderBy(asc(botEpisodes.numberInSeries))
				: Promise.resolve([]),
			movieSlugs.length
				? db
						.select({
							slug: botMovies.slug,
							title: botMovies.title,
							poster: botMovies.poster,
							releaseDate: botMovies.releaseDate,
						})
						.from(botMovies)
						.where(and(inArray(botMovies.slug, movieSlugs), eq(botMovies.visible, true)))
				: Promise.resolve([]),
			tomeSeries.length
				? db
						.select({
							id: botMangaVolumes.id,
							series: botMangaVolumes.series,
							num: botMangaVolumes.volumeNumber,
							cover: botMangaVolumes.cover,
						})
						.from(botMangaVolumes)
						.where(
							and(inArray(botMangaVolumes.series, tomeSeries), eq(botMangaVolumes.visible, true))
						)
						.orderBy(asc(botMangaVolumes.volumeNumber))
				: Promise.resolve([]),
		]);

		const sagaBySlug = new Map(sagas.map((s) => [s.slug, s]));
		const movieBySlug = new Map(movies.map((m) => [m.slug, m]));

		const views: BestOfSagaView[] = [];
		for (const cur of BESTOF_CURATION) {
			const saga = sagaBySlug.get(cur.slug);
			if (!saga?.image) continue; // saga masquée/absente → on la saute, jamais de trou

			const epsInRange = cur.episodes
				? episodes.filter(
						(e) =>
							e.series === cur.episodes!.series &&
							e.num != null &&
							e.num >= cur.episodes!.from &&
							e.num <= cur.episodes!.to
					)
				: [];
			const tomesInRange = cur.tomes
				? volumes.filter(
						(v) =>
							v.series === cur.tomes!.series &&
							v.num != null &&
							v.num >= cur.tomes!.from &&
							v.num <= cur.tomes!.to
					)
				: [];
			const sagaMovies = (cur.movieSlugs ?? []).flatMap((s) => {
				const m = movieBySlug.get(s);
				return m ? [m] : [];
			});

			const media: BestOfMediaItem[] = [
				...sampleEvenly(
					epsInRange.filter((e) => !!e.image),
					BESTOF_EPISODES_PER_SAGA
				).map((e) => ({
					kind: "episode" as const,
					href: `/wiki/episodes/${e.id}`,
					image: assetUrl(e.image),
					label: e.title ?? `Épisode ${e.num}`,
					badge: `Épisode ${e.num}`,
				})),
				...sagaMovies
					.filter((m) => !!m.poster)
					.map((m) => ({
						kind: "film" as const,
						href: `/wiki/films/${m.slug}`,
						image: assetUrl(m.poster),
						label: m.title,
						badge: movieYear(m.releaseDate) ? `Film · ${movieYear(m.releaseDate)}` : "Film",
					})),
				...sampleEvenly(
					tomesInRange.filter((v) => !!v.cover),
					BESTOF_TOMES_PER_SAGA
				).map((v) => ({
					kind: "tome" as const,
					href: `/wiki/manga/volume/${v.id}`,
					image: assetUrl(v.cover),
					label: `${BESTOF_SERIES_LABELS[v.series] ?? v.series} — Tome ${v.num}`,
					badge: `Tome ${v.num}`,
				})),
			];
			if (media.length === 0) continue;

			const firstEp = epsInRange[0];
			const firstMovie = sagaMovies[0];
			const [watchHref, watchLabel] = firstEp
				? [`/wiki/episodes/${firstEp.id}`, "Regarder la saga"]
				: firstMovie
					? [`/wiki/films/${firstMovie.slug}`, "Regarder le film"]
					: ["/wiki/episodes", "Voir les épisodes"];

			const seriesCode = cur.episodes?.series ?? "";
			views.push({
				slug: cur.slug,
				name: saga.name,
				seriesLabel: seriesCode
					? (BESTOF_SERIES_LABELS[seriesCode] ?? seriesCode)
					: "Film Dragon Ball Super",
				years: seriesCode ? (BESTOF_SERIES_YEARS[seriesCode] ?? null) : null,
				tagline: cur.tagline,
				description: saga.description,
				image: assetUrl(saga.image),
				era: cur.era,
				accent: bestofAccent(cur.era),
				stats: {
					episodes: epsInRange.length,
					films: sagaMovies.length,
					tomes: tomesInRange.length,
				},
				watchHref,
				watchLabel,
				media,
			});
		}
		return views;
	} catch (e) {
		console.error("[home-bestof] lecture échouée, panneau masqué :", e);
		return [];
	}
}
