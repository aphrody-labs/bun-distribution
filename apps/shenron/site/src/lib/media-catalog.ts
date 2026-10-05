import "server-only";

import { and, desc, eq, ilike, or } from "drizzle-orm";
import { botDatabooks, botEpisodes, botMangaVolumes, botMovies } from "@/db/bot-schema";
import { db } from "@/lib/db";
import { publicDatabookImage } from "@/lib/databook-media";

const LIMIT = 12;

/**
 * Sélection légère et universelle pour les rails média de l'accueil et de
 * l'espace membre. Les pages/transcriptions et autres gros JSON ne quittent
 * jamais PostgreSQL : les cartes n'utilisent que les métadonnées visibles.
 */
export async function readMediaCatalog() {
	const [episodes, movies, manga, databooks] = await Promise.all([
		db
			.select({
				id: botEpisodes.id,
				series: botEpisodes.series,
				number: botEpisodes.numberInSeries,
				title: botEpisodes.title,
				titleJa: botEpisodes.titleJa,
				image: botEpisodes.image,
				airDate: botEpisodes.airDate,
				players: botEpisodes.players,
			})
			.from(botEpisodes)
			.where(eq(botEpisodes.visible, true))
			.orderBy(desc(botEpisodes.airDate), desc(botEpisodes.id))
			.limit(LIMIT),
		db
			.select({
				id: botMovies.id,
				slug: botMovies.slug,
				title: botMovies.title,
				titleJa: botMovies.titleJa,
				poster: botMovies.poster,
				releaseDate: botMovies.releaseDate,
				duration: botMovies.durationMin,
				players: botMovies.players,
			})
			.from(botMovies)
			.where(eq(botMovies.visible, true))
			.orderBy(desc(botMovies.releaseDate), desc(botMovies.id))
			.limit(LIMIT),
		db
			.select({
				id: botMangaVolumes.id,
				series: botMangaVolumes.series,
				number: botMangaVolumes.volumeNumber,
				title: botMangaVolumes.title,
				titleJa: botMangaVolumes.titleJa,
				cover: botMangaVolumes.cover,
				publishedAt: botMangaVolumes.publishedAt,
			})
			.from(botMangaVolumes)
			.where(
				and(
					eq(botMangaVolumes.visible, true),
					or(
						and(
							eq(botMangaVolumes.series, "DB"),
							ilike(botMangaVolumes.title, "Dragon Ball Vol. %")
						),
						and(
							eq(botMangaVolumes.series, "DBS"),
							ilike(botMangaVolumes.title, "Dragon Ball Super Vol. %")
						)
					)
				)
			)
			.orderBy(desc(botMangaVolumes.publishedAt), desc(botMangaVolumes.id))
			.limit(LIMIT),
		db
			.select({
				id: botDatabooks.id,
				kind: botDatabooks.kind,
				category: botDatabooks.category,
				title: botDatabooks.title,
				titleJa: botDatabooks.titleJa,
				cover: botDatabooks.cover,
				publishedAt: botDatabooks.publishedAt,
			})
			.from(botDatabooks)
			.where(eq(botDatabooks.visible, true))
			.orderBy(desc(botDatabooks.publishedAt), desc(botDatabooks.id))
			.limit(LIMIT),
	]);

	return {
		episodes,
		movies,
		manga,
		databooks: databooks.map((book) => (Object.assign(book, { cover: publicDatabookImage(book.cover) }))),
	};
}
