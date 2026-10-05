/**
 * db-universe — accès au **wiki Dragon Ball** (schéma Neon `bot`, miroir du
 * SQLite du bot) via Drizzle, en LECTURE SEULE.
 *
 * Server-only : ce module tape la DB Postgres et ne doit jamais entrer dans un
 * bundle client. Les Client Components qui avaient besoin de `assetUrl` doivent
 * désormais importer `@/lib/assets` directement.
 *
 * Convention de sortie : snake_case (les pages sagas/episodes/games/search…
 * consomment ces champs). Les mappers reproduisent à l'identique les shapes que
 * servait l'API REST du bot.
 */
import "server-only";
import { cache } from "react";
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { API_URL } from "@/lib/config";
import { chatAphrodyRag, searchAphrodyRag, usesAphrodyRag } from "@/lib/site-rag";
import {
	botArcs,
	botBattles,
	botCharacters,
	botCharacterArcs,
	botCharacterTechniques,
	botDatabooks,
	botDragons,
	botEpisodes,
	botGameCharacters,
	botGames,
	botItems,
	botLocations,
	botMangaChapters,
	botMangaVolumes,
	botMediaPublications,
	botMovies,
	botNews,
	botPlanets,
	botPowerLevels,
	botRaces,
	botSagas,
	botSoundtracks,
	botTechniques,
	botTimelineEvents,
	botTools,
	botTournaments,
	botTransformations,
	botVoiceActors,
	botWishes,
	botContributors,
	botContributorCredits,
	botNarrativeTimelines,
	botNarrativeEvents,
	botNarrativeEventRelations,
	botMediaWorks,
	botMediaEditions,
	botMediaVolumes,
} from "@/db/bot-schema";
import type {
	Availability,
	BattleCombatant,
	EpisodeFrame,
	LocationKeyEvent,
	TournamentMatch,
	VoiceActorRole,
	WikiSource,
} from "@/db/bot-schema";
import { eraOf, type TimelineItem } from "@/lib/chronology";
import { orderPlayers } from "@/lib/players";
import { CLE_VERIFIEE } from "@/lib/databooks-defauts";
import type { SignauxRichesse } from "@/lib/character-richesse";
import { formatCharacterSlug } from "@/lib/wiki-slugs";
import { mangaCoverPath, publishedMangaPageCount, publishedMangaPages } from "@/lib/manga-assets";
import { mangaBibliographicSourceUrl, mangaSourceLabel } from "@/lib/manga-source-registry";

// Re-export types from schema
export type { VoiceActorRole,    } from "@/db/bot-schema";

// Re-export pour back-compat des pages serveur qui importaient assetUrl ici.
export { assetUrl } from "@/lib/assets";
;

/** Champs article long-format encyclopédique — contrat snake_case du site. */
type WithArticle = {
	article: string | null;
	article_sources: WikiSource[] | null;
};

// API REST du bot — chemin de compatibilité du RAG local.
function apiBase(): string {
	const override = process.env.SHENRON_API_URL || process.env.NEXT_PUBLIC_SHENRON_API_URL;
	return override ? override.replace(/\/+$/, "") : API_URL;
}

export type Saga = WithArticle & {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	series: string;
	order_idx: number;
	description: string | null;
	image: string | null;
};

export type Episode = {
	id: number;
	series: string;
	number_in_series: number;
	title: string;
	title_ja: string | null;
	air_date: number | null;
	synopsis: string | null;
	official_source_url: string | null;
	image: string | null;
	video_url: string | null;
	mal_id: number | null;
	subtitles: { lang: string; label: string; src: string }[] | null;
	players:
		| {
				name: string;
				provider: string;
				embedUrl: string;
				lang?: "vf" | "vostfr";
		  }[]
		| null;
	/** Offres légales relevées (ADN…) — lien sortant, distinct de `players`. */
	availability: Availability[] | null;
	stream_url: string | null;
	// Scènes d'épisode : frames extraites + montage MP4 preview animé.
	frames: EpisodeFrame[] | null;
	scene_preview: string | null;
};

export type EpisodeNavItem = {
	id: number;
	number_in_series: number;
	title: string;
	image: string | null;
};

export type MovieNavItem = {
	id: number;
	slug: string;
	title: string;
	poster: string | null;
	release_date: number | null;
};

export type Movie = {
	id: number;
	slug: string;
	title: string;
	title_ja: string | null;
	title_romaji: string | null;
	series: string;
	release_date: number | null;
	duration_min: number | null;
	synopsis: string | null;
	poster: string | null;
	trailer_url: string | null;
	mal_id: number | null;
	anilist_id: number | null;
	video_url: string | null;
	subtitles: { lang: string; label: string; src: string }[] | null;
	players:
		| {
				name: string;
				provider: string;
				embedUrl: string;
				lang?: "vf" | "vostfr";
		  }[]
		| null;
	/** Offres légales relevées (ADN…) — lien sortant, distinct de `players`. */
	availability: Availability[] | null;
	stream_url: string | null;
};

type GameMedia = {
	type: "image" | "youtube";
	url: string;
	caption?: string | null;
};

export type Game = {
	id: number;
	slug: string;
	title: string;
	title_ja: string | null;
	platforms: string | null;
	release_date: number | null;
	developer: string | null;
	publisher: string | null;
	description: string | null;
	cover: string | null;
	official_url: string | null;
	/** Galerie style Steam (images + trailers YouTube). */
	media: GameMedia[];
	characters?: Array<{
		id: number;
		name: string;
		name_ja: string | null;
		image: string | null;
	}>;
};

export type Race = WithArticle & {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	description: string | null;
};

export type Transformation = {
	id: number;
	name: string;
	image: string | null;
	ki: string | null;
	character_id: number;
	/**
	 * Présence d'un article rédigé — pas son contenu. L'index n'affiche pas le
	 * texte, il a seulement besoin de savoir si la forme a une fiche vers
	 * laquelle pointer ; embarquer 23 articles de 2 à 3 Ko dans la charge d'un
	 * index serait payer le texte deux fois.
	 */
	a_article?: boolean;
};

export type MangaVolume = {
	id: number;
	series: string;
	volume_number: number;
	title: string | null;
	cover: string | null;
	title_ja?: string | null;
	published_at?: number | null;
	isbn?: string | null;
	/** Primary publisher page when the bibliographic record provides one. */
	source_url?: string | null;
	source_label?: string | null;
};

export type MangaChapter = {
	id: number;
	series: string;
	chapter_number: number;
	title: string | null;
	volume_id: number | null;
	cover: string | null;
	pages?: string[] | null;
};

/** Chapitre + ses pages, pour le lecteur de scan. `prev`/`next` = chapitres
 *  adjacents (même série, par numéro) pour la navigation. */
export type MangaChapterRead = MangaChapter & {
	pages: string[];
	prev: number | null;
	next: number | null;
	prevPages?: string[] | null;
	nextPages?: string[] | null;
};

export type Battle = WithArticle & {
	id: number;
	slug: string;
	title: string;
	title_ja: string | null;
	saga_id: number | null;
	arc_id: number | null;
	series: string;
	combatants: BattleCombatant[];
	winner_id: number | null;
	winner_name: string | null;
	location: string | null;
	manga_volume_start: number | null;
	manga_volume_end: number | null;
	manga_chapter_start: number | null;
	manga_chapter_end: number | null;
	episode_start: number | null;
	episode_end: number | null;
	techniques_used: string[] | null;
	climax_summary: string | null;
	canon: boolean;
	impact_level: number;
};

export type TimelineEvent = {
	id: number;
	age_year: number;
	age_month: number | null;
	age_day: number | null;
	era: string;
	title: string;
	title_ja: string | null;
	description: string;
	characters_involved: string[] | null;
	source_ref: string | null;
	canon: boolean;
	order_idx: number;
};

export type PowerLevel = {
	id: number;
	character_id: number | null;
	character_name: string;
	form: string | null;
	saga_id: number | null;
	saga_name: string | null;
	battle_power: number | null;
	battle_power_display: string;
	scouter_device: string | null;
	source_kind: string;
	source_page: string | null;
	canon: boolean;
	notes: string | null;
};

export type Item = WithArticle & {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	name_romaji: string | null;
	category: string;
	creator: string | null;
	description: string;
	debut_chapter: string | null;
	debut_episode: string | null;
	image: string | null;
};

export type Dragon = WithArticle & {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	creator: string | null;
	planet_realm: string | null;
	balls_count: number;
	balls_diameter: string | null;
	summon_phrase: string | null;
	summon_phrase_ja: string | null;
	wishes_count: number;
	cooldown: string | null;
	rules: string | null;
	image: string | null;
};

export type Wish = {
	id: number;
	dragon_id: number;
	dragon_name: string;
	wish_number_in_summon: number;
	whisperer: string;
	saga: string;
	manga_chapter: number | null;
	episode_number: number | null;
	wish_text: string;
	granted: boolean;
	canon: boolean;
};

export type Location = WithArticle & {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	name_romaji: string | null;
	realm_type: string;
	planet: string | null;
	description: string;
	debut_chapter: string | null;
	debut_episode: string | null;
	key_events: LocationKeyEvent[] | null;
	image: string | null;
};

export type Tournament = WithArticle & {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	tournament_type: string;
	saga: string;
	location: string | null;
	winner_name: string | null;
	runner_up_name: string | null;
	rules_summary: string;
	participants_count: number | null;
	notable_matches: TournamentMatch[] | null;
	canon: boolean;
};

export type VoiceActor = WithArticle & {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	nationality: string;
	birth_date: string | null;
	roles: VoiceActorRole[];
	biography: string;
	image: string | null;
};

export type Soundtrack = WithArticle & {
	id: number;
	slug: string;
	title: string;
	title_ja: string | null;
	title_romaji: string | null;
	track_type: string;
	series: string;
	artist: string;
	composer: string | null;
	lyricist: string | null;
	episodes_range: string | null;
	release_year: number | null;
	description: string;
};

export type News = {
	id: number;
	source_id: string;
	source_url: string;
	title: string;
	excerpt: string | null;
	category: string | null;
	published_at: number;
	image: string | null;
};

export type SearchResults = {
	q: string;
	characters: Array<{
		id: number;
		name: string;
		name_ja: string | null;
		image: string | null;
		race: string | null;
	}>;
	planets: Array<{
		id: number;
		name: string;
		name_ja: string | null;
		image: string | null;
	}>;
	sagas: Array<Pick<Saga, "id" | "slug" | "name" | "name_ja" | "series">>;
	movies: Array<Pick<Movie, "id" | "slug" | "title" | "title_ja" | "series">>;
	games: Array<Pick<Game, "id" | "slug" | "title" | "title_ja">>;
	episodes: Array<{
		id: number;
		series: string;
		number_in_series: number;
		title: string;
		image: string | null;
	}>;
	techniques: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		type: string | null;
	}>;
	races: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
	}>;
	transformations: Array<{
		id: number;
		name: string;
		image: string | null;
		character_id: number;
	}>;
	arcs: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		saga_slug: string | null;
	}>;
	mangaVolumes: Array<{
		id: number;
		series: string;
		volume_number: number | null;
		title: string | null;
		cover: string | null;
	}>;
	mangaChapters: Array<{
		id: number;
		series: string;
		chapter_number: number | null;
		title: string | null;
	}>;
	battles: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		saga: string;
	}>;
	locations: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		realm_type: string;
		image: string | null;
	}>;
	tournaments: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		saga: string;
	}>;
	voiceActors: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		nationality: string;
	}>;
	soundtracks: Array<{
		id: number;
		slug: string;
		title: string;
		title_ja: string | null;
		track_type: string;
		series: string;
	}>;
	powerLevels: Array<{
		id: number;
		character_name: string;
		battle_or_context: string | null;
		power_value_formatted: string;
	}>;
	items: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		category: string;
		image: string | null;
	}>;
	dragons: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		creator: string | null;
		image: string | null;
	}>;
	databooks: Array<{
		id: number;
		title: string;
		title_ja: string | null;
		category: string | null;
		cover: string | null;
	}>;
	novels: Array<{
		id: number;
		title: string;
		title_ja: string | null;
		publication_type: string;
		cover: string | null;
	}>;
	contributors: Array<{
		id: number;
		slug: string;
		name: string;
		name_ja: string | null;
		category: string;
	}>;
};

export type Arc = WithArticle & {
	id: number;
	saga_id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	order_idx: number;
	description: string | null;
};

export type Tool = {
	id: number;
	slug: string;
	name: string;
	description: string | null;
	url: string;
	author: string | null;
	language: string | null;
	category: string | null;
	target_game_id: number | null;
	stars: number;
	/** Dépôt archivé en amont sur GitHub — il ne recevra plus de correctif. */
	archived: boolean;
	/** Dernier push amont (epoch ms) : ce qui dit si l'outil vit encore. */
	pushed_at: number | null;
};

// ── Mappers camelCase (Drizzle) → snake_case (contrat site) ──────────────

function toSaga(r: typeof botSagas.$inferSelect): Saga {
	return {
		id: r.id,
		slug: r.slug,
		name: r.name,
		name_ja: r.nameJa,
		series: r.series ?? "",
		order_idx: r.orderIdx ?? 0,
		description: r.description,
		image: r.image,
		article: r.article ?? null,
		article_sources: r.articleSources ?? null,
	};
}

function toArc(r: typeof botArcs.$inferSelect): Arc {
	return {
		id: r.id,
		saga_id: r.sagaId ?? 0,
		slug: r.slug,
		name: r.name,
		name_ja: r.nameJa,
		order_idx: r.orderIdx ?? 0,
		description: r.description,
		article: r.article ?? null,
		article_sources: r.articleSources ?? null,
	};
}

function toEpisode(r: typeof botEpisodes.$inferSelect): Episode {
	return {
		id: r.id,
		series: r.series,
		number_in_series: r.numberInSeries ?? 0,
		title: r.title ?? "",
		title_ja: r.titleJa,
		air_date: r.airDate,
		// FR-first : synopsis traduit (translate-synopsis-fr.ts), repli sur l'original.
		synopsis: r.synopsisFr ?? r.synopsis,
		official_source_url: r.officialSourceUrl ?? null,
		image: r.image,
		video_url: r.videoUrl,
		mal_id: r.malId,
		subtitles: r.subtitles ?? null,
		players: orderPlayers(r.players),
		availability: normaliseOffres(r.availability),
		stream_url: r.streamUrl ?? null,
		frames: r.frames ?? null,
		scene_preview: r.scenePreview ?? null,
	};
}

function toMovie(r: typeof botMovies.$inferSelect): Movie {
	return {
		id: r.id,
		slug: r.slug,
		title: r.title,
		title_ja: r.titleJa,
		title_romaji: r.titleRomaji,
		series: r.series ?? "",
		release_date: r.releaseDate,
		duration_min: r.durationMin,
		// FR-first : synopsis traduit (translate-synopsis-fr.ts), repli sur l'original.
		synopsis: r.synopsisFr ?? r.synopsis,
		poster: r.poster,
		trailer_url: r.trailerUrl,
		mal_id: r.malId,
		anilist_id: r.anilistId,
		video_url: r.videoUrl ?? null,
		subtitles: r.subtitles ?? null,
		players: orderPlayers(r.players),
		availability: normaliseOffres(r.availability),
		stream_url: r.streamUrl ?? null,
	};
}

/**
 * Défend le rendu contre une colonne `availability` mal formée.
 *
 * Le jsonb a déjà été un scalaire double-encodé par le passé (piège `sql.json`,
 * cf. CLAUDE.md) : on ne suppose ni le tableau, ni la forme des entrées. Une
 * offre sans URL ou indisponible est écartée — la page ne doit jamais afficher
 * un bouton « Regarder » qui ne mène nulle part.
 */
function normaliseOffres(raw: unknown): Availability[] | null {
	if (!Array.isArray(raw)) return null;
	const out: Availability[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const o = item as Record<string, unknown>;
		if (typeof o.url !== "string" || !o.url) continue;
		if (o.available === false) continue;
		const langs = Array.isArray(o.langs)
			? (o.langs.filter((l) => l === "vf" || l === "vostfr") as ("vf" | "vostfr")[])
			: [];
		out.push({
			provider: typeof o.provider === "string" ? o.provider : "",
			label: typeof o.label === "string" && o.label ? o.label : "Officiel",
			url: o.url,
			embedUrl: typeof o.embedUrl === "string" ? o.embedUrl : null,
			langs,
			available: true,
			checkedAt: typeof o.checkedAt === "number" ? o.checkedAt : 0,
		});
	}
	return out.length ? out : null;
}

function normalizeGameMedia(raw: unknown): GameMedia[] {
	if (!Array.isArray(raw)) return [];
	const out: GameMedia[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const o = item as Record<string, unknown>;
		const url = typeof o.url === "string" ? o.url.trim() : "";
		if (!url) continue;
		const type = o.type === "youtube" ? "youtube" : "image";
		const caption = typeof o.caption === "string" && o.caption.trim() ? o.caption.trim() : null;
		out.push({ type, url, caption });
	}
	return out;
}

function toGame(r: typeof botGames.$inferSelect): Game {
	return {
		id: r.id,
		slug: r.slug,
		title: r.title,
		title_ja: r.titleJa,
		platforms: r.platforms,
		release_date: r.releaseDate,
		developer: r.developer,
		publisher: r.publisher,
		description: r.description,
		cover: r.cover,
		official_url: r.officialUrl,
		media: normalizeGameMedia(r.media),
	};
}

function toRace(r: typeof botRaces.$inferSelect): Race {
	return {
		id: r.id,
		slug: r.slug,
		name: r.name,
		name_ja: r.nameJa,
		description: r.description,
		article: r.article ?? null,
		article_sources: r.articleSources ?? null,
	};
}

function toTransformation(r: typeof botTransformations.$inferSelect): Transformation {
	return {
		id: r.id,
		name: r.name,
		image: r.image,
		ki: r.ki,
		character_id: r.characterId ?? 0,
		// Même seuil que le `generateStaticParams` de la fiche : sous 50
		// caractères, aucune page n'est générée et le lien serait un 404.
		a_article: !!r.article && r.article.trim().length > 50,
	};
}

function toMangaVolume(r: typeof botMangaVolumes.$inferSelect): MangaVolume {
	return {
		id: r.id,
		series: r.series,
		volume_number: r.volumeNumber ?? 0,
		title: r.title,
		cover: mangaCoverPath(r.series, r.volumeNumber ?? 0, r.cover),
		title_ja: r.titleJa,
		published_at: r.publishedAt,
		isbn: r.isbn,
		source_url: mangaBibliographicSourceUrl(r.series),
		source_label: mangaSourceLabel(r.series),
	};
}

type DatabookPage = {
	number: number;
	image: string | null;
	text: string | null;
	/** Transcription acquittée à la main par un relecteur (cf. `CLE_VERIFIEE`). */
	verifiee: boolean;
};

export type Databook = {
	id: number;
	kind: string;
	title: string;
	title_ja: string | null;
	author: string | null;
	published_at: number | null;
	cover: string | null;
	description: string | null;
	source_url: string | null;
	category: string | null;
	pages: DatabookPage[];
};

function toDatabookPages(raw: unknown): DatabookPage[] {
	if (!Array.isArray(raw)) return [];
	const out: DatabookPage[] = [];
	for (let i = 0; i < raw.length; i++) {
		const p = raw[i];
		if (!p || typeof p !== "object") continue;
		const o = p as Record<string, unknown>;
		const n =
			typeof o.number === "number" && Number.isFinite(o.number)
				? Math.trunc(o.number)
				: typeof o.number === "string" && Number.isFinite(Number(o.number))
					? Math.trunc(Number(o.number))
					: i + 1;
		out.push({
			number: n,
			image: typeof o.image === "string" ? o.image : null,
			text: typeof o.text === "string" ? o.text : null,
			verifiee: o[CLE_VERIFIEE] === true,
		});
	}
	return out;
}

function toDatabook(r: typeof botDatabooks.$inferSelect): Databook {
	return {
		id: r.id,
		kind: r.kind,
		title: r.title,
		title_ja: r.titleJa,
		author: r.author,
		published_at: r.publishedAt,
		cover: r.cover,
		description: r.description,
		source_url: r.sourceUrl,
		category: r.category ?? null,
		pages: toDatabookPages(r.pages),
	};
}

export type MediaPublication = {
	id: number;
	legacy_databook_id: number;
	publication_type: string;
	title: string;
	title_ja: string | null;
	author: string | null;
	illustrator: string | null;
	published_at: number | null;
	cover: string | null;
	description: string | null;
	pages: DatabookPage[];
};

function toMediaPublication(r: typeof botMediaPublications.$inferSelect): MediaPublication {
	return {
		id: r.id,
		legacy_databook_id: r.legacyDatabookId,
		publication_type: r.publicationType,
		title: r.title,
		title_ja: r.titleJa,
		author: r.author,
		illustrator: r.illustrator,
		published_at: r.publishedAt,
		cover: r.cover,
		description: r.description,
		pages: toDatabookPages(r.pages),
	};
}

function toMangaChapter(r: typeof botMangaChapters.$inferSelect): MangaChapter {
	return {
		id: r.id,
		series: r.series,
		chapter_number: r.chapterNumber ?? 0,
		title: r.title,
		volume_id: r.volumeId,
		cover: mangaCoverPath(r.series, r.chapterNumber ?? 0, r.cover),
		pages: publishedMangaPages(r.series, r.chapterNumber ?? 0, r.pages),
	};
}

function toNews(r: typeof botNews.$inferSelect): News {
	return {
		id: r.id,
		source_id: r.sourceId ?? "",
		source_url: r.sourceUrl ?? "",
		title: r.title,
		excerpt: r.excerpt,
		category: r.category,
		published_at: r.publishedAt ?? 0,
		image: r.image,
	};
}

function toTool(r: typeof botTools.$inferSelect): Tool {
	return {
		id: r.id,
		slug: r.slug,
		name: r.name,
		description: r.description,
		url: r.url ?? "",
		author: r.author,
		language: r.language,
		category: r.category,
		target_game_id: r.targetGameId,
		stars: r.stars ?? 0,
		archived: r.archived,
		pushed_at: r.pushedAt,
	};
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
	try {
		return await fn();
	} catch (e) {
		// Dégradation gracieuse (null) MAIS observable : sans ce log, une dérive de
		// schéma (colonne PG absente), un timeout de pool ou une panne PG seraient
		// invisibles dans journalctl. L'erreur postgres-js nomme la table/colonne
		// fautive → diagnostic direct. Volume borné (la plupart des rendus sont ISR).
		console.error("[db-universe] requête wiki échouée:", e);
		return null;
	}
}

// Seuil de proximité trigramme (pg_trgm). 0.3 attrape les fautes de frappe
// courantes ("vegetta"→Vegeta) sans bruit sur les noms courts.
const FUZZY_THRESHOLD = 0.3;

// WHERE tolérant aux fautes : substring (ILIKE, conserve le prefix/partial)
// OU proximité trigramme, le tout insensible casse + accents (unaccent).
// Tables wiki ~dizaines de lignes → seq-scan sub-ms, aucun index requis.
function fuzzyWhere(term: string, cols: PgColumn[]) {
	const pat = `%${term}%`;
	return or(
		...cols.flatMap((c) => [
			ilike(c, pat),
			sql`similarity(unaccent(lower(${c})), unaccent(lower(${term}))) > ${FUZZY_THRESHOLD}`,
		]),
	);
}

// ORDER BY pertinence : égalité exacte > préfixe > meilleure proximité
// trigramme (toutes colonnes confondues).
function fuzzyOrder(term: string, cols: PgColumn[]) {
	const primary = cols[0];
	const sim = sql`greatest(${sql.join(
		cols.map((c) => sql`similarity(unaccent(lower(${c})), unaccent(lower(${term})))`),
		sql`, `,
	)})`;
	return [
		sql`(lower(${primary}) = lower(${term})) desc`,
		sql`(unaccent(lower(${primary})) like unaccent(lower(${term})) || '%') desc`,
		sql`${sim} desc nulls last`,
	];
}

export const dbUniverse = {
	/**
	 * Compte réel de chaque table wiki (Neon `bot.*`), source unique pour les
	 * libellés « N personnages / N films … » — fini les nombres codés en dur qui
	 * se désynchronisent dès que la DB grossit. Un seul round-trip groupé.
	 */
	/**
	 * Mémoïsé par `cache()` (portée : un rendu). `counts()` déclenche 16 requêtes
	 * de comptage ; `/wiki/arcs` et `/wiki/transformations` l'appellent une fois
	 * pour la page ET une fois via `WikiCategoryNav`, soit 32 requêtes pour un
	 * seul rendu. Aucun autre helper de ce module n'est mémoïsé — celui-ci le
	 * mérite parce qu'il est à la fois le plus coûteux et le plus rappelé.
	 */
	counts: cache(() =>
		safe(async () => {
			const tables = {
				characters: botCharacters,
				planets: botPlanets,
				sagas: botSagas,
				arcs: botArcs,
				movies: botMovies,
				episodes: botEpisodes,
				games: botGames,
				races: botRaces,
				techniques: botTechniques,
				transformations: botTransformations,
				mangaVolumes: botMangaVolumes,
				mangaChapters: botMangaChapters,
				databooks: botDatabooks,
				news: botNews,
				tools: botTools,
				battles: botBattles,
				timelineEvents: botTimelineEvents,
				powerLevels: botPowerLevels,
				items: botItems,
				dragons: botDragons,
				wishes: botWishes,
				locations: botLocations,
				tournaments: botTournaments,
				voiceActors: botVoiceActors,
				soundtracks: botSoundtracks,
			} satisfies Record<string, PgTable>;
			// Seules les tables « parcourables » portent la colonne `visible` : on
			// compte alors uniquement les entités visibles (cohérent avec les index
			// publics). `news`/`tools` n'ont pas de visibilité → compte brut.
			const withVisibility = new Set<PgTable>([
				botCharacters,
				botPlanets,
				botSagas,
				botArcs,
				botMovies,
				botEpisodes,
				botGames,
				botRaces,
				botTechniques,
				botTransformations,
				botMangaVolumes,
				botMangaChapters,
				botDatabooks,
				botBattles,
				botTimelineEvents,
				botPowerLevels,
				botItems,
				botDragons,
				botWishes,
				botLocations,
				botTournaments,
				botVoiceActors,
				botSoundtracks,
			]);
			const entries = await Promise.all(
				(Object.entries(tables) as [keyof typeof tables, PgTable][]).map(async ([key, table]) => {
					const visCol = (table as unknown as { visible?: PgColumn }).visible;
					const base = db.select({ n: sql<number>`count(*)::int` }).from(table);
					const [{ n }] = withVisibility.has(table) && visCol ? await base.where(eq(visCol, true)) : await base;
					return [key, Number(n ?? 0)] as const;
				}),
			);
			return Object.fromEntries(entries) as Record<keyof typeof tables, number>;
		}),
	),

	sagas: () =>
		safe(async () => ({
			sagas: (await db.select().from(botSagas).where(eq(botSagas.visible, true)).orderBy(asc(botSagas.orderIdx))).map(
				toSaga,
			),
		})),

	/** Tous les arcs (toutes sagas) + nom/slug de leur saga, pour l'index /wiki/arcs. */
	arcs: () =>
		safe(async () => {
			const rows = await db
				.select({
					arc: botArcs,
					sagaName: botSagas.name,
					sagaSlug: botSagas.slug,
					sagaSeries: botSagas.series,
				})
				.from(botArcs)
				.leftJoin(botSagas, eq(botArcs.sagaId, botSagas.id))
				.where(and(eq(botArcs.visible, true), eq(botSagas.visible, true)))
				.orderBy(asc(botSagas.orderIdx), asc(botArcs.orderIdx));
			return {
				arcs: rows.map((r) => (Object.assign(toArc(r.arc), {
	saga_name: r.sagaName,
	saga_slug: r.sagaSlug,
	saga_series: r.sagaSeries
}))),
			};
		}),

	/**
	 * Facettes de filtrage des personnages (page /wiki/personnages) : options
	 * Techniques (uniquement celles liées à ≥1 perso → jamais d'option morte) et
	 * Arcs (tous, comptés), + les mappings perso→techniques / perso→arcs (sparse,
	 * seulement les persos ayant des liens) consommés côté client pour un filtrage
	 * cumulatif instantané. Race n'est pas ici : c'est une colonne du perso, déjà
	 * facettée dans la grille. Dégrade en `null` si la DB est indisponible.
	 */
	characterFacets: () =>
		safe(async () => {
			const cnt = sql<number>`count(*)::int`;
			const [techRows, arcRows, ctRows, caRows] = await Promise.all([
				db
					.select({
						id: botTechniques.id,
						name: botTechniques.name,
						count: cnt,
					})
					.from(botTechniques)
					.innerJoin(botCharacterTechniques, eq(botCharacterTechniques.techniqueId, botTechniques.id))
					.where(eq(botTechniques.visible, true))
					.groupBy(botTechniques.id, botTechniques.name)
					.orderBy(desc(cnt), asc(botTechniques.name)),
				db
					.select({ id: botArcs.id, name: botArcs.name, count: cnt })
					.from(botArcs)
					.leftJoin(botCharacterArcs, eq(botCharacterArcs.arcId, botArcs.id))
					.where(eq(botArcs.visible, true))
					.groupBy(botArcs.id, botArcs.name, botArcs.orderIdx)
					.orderBy(asc(botArcs.orderIdx)),
				db
					.select({
						characterId: botCharacterTechniques.characterId,
						techniqueId: botCharacterTechniques.techniqueId,
					})
					.from(botCharacterTechniques),
				db
					.select({
						characterId: botCharacterArcs.characterId,
						arcId: botCharacterArcs.arcId,
					})
					.from(botCharacterArcs),
			]);

			const group = <T>(rows: T[], self: (r: T) => number, val: (r: T) => number) => {
				const m: Record<string, string[]> = {};
				for (const r of rows) {
					const k = String(self(r));
					(m[k] ??= []).push(String(val(r)));
				}
				return m;
			};

			return {
				techniqueOptions: techRows.map((t) => ({
					value: String(t.id),
					label: t.name,
					count: Number(t.count),
				})),
				arcOptions: arcRows.map((a) => ({
					value: String(a.id),
					label: a.name,
					count: Number(a.count),
				})),
				charTechniques: group(
					ctRows,
					(r) => r.characterId,
					(r) => r.techniqueId,
				),
				charArcs: group(
					caRows,
					(r) => r.characterId,
					(r) => r.arcId,
				),
			};
		}),

	/**
	 * Signaux de richesse par personnage, pour le classement de la grille
	 * (`@/lib/character-richesse`). Une seule requête agrégée — mesurée à 120 ms
	 * sur les 1 307 fiches, contre quatre allers-retours si on comptait chaque
	 * table séparément.
	 *
	 * On rend les signaux BRUTS, pas la note : les pondérations vivent dans un
	 * module pur et testable, et se règlent sans réécrire ce SQL.
	 *
	 * `count(*)::int` partout : sans le cast, postgres-js rendrait des CHAÎNES et
	 * `"9" > "12"` classerait la grille à l'envers.
	 */
	characterRichesse: () =>
		safe(async () => {
			const rows = await db.execute<{
				id: number;
				len_article: number;
				len_description: number;
				len_sections: number;
				nb_sections: number;
				nb_variantes: number;
				nb_transformations: number;
				nb_techniques: number;
				a_nom_ja: boolean;
				a_race: boolean;
				a_ki: boolean;
				a_planete: boolean;
				image_propre: boolean;
				a_debut_episode: boolean;
				a_debut_chapitre: boolean;
			}>(sql`
				with sec as (
					select entity_id::bigint as id,
					       count(*)::int as n,
					       coalesce(sum(length(coalesce(body, ''))), 0)::int as len
					from bot.db_wiki_sections
					where entity_type = 'character'
					group by 1
				),
				varn as (
					select character_id as id, count(*)::int as n
					from bot.db_character_variants group by 1
				),
				trf as (
					select character_id as id, count(*)::int as n
					from bot.db_transformations where character_id is not null group by 1
				),
				tec as (
					select character_id as id, count(*)::int as n
					from bot.db_character_techniques group by 1
				)
				select
					c.id,
					length(coalesce(c.article, ''))::int      as len_article,
					length(coalesce(c.description, ''))::int  as len_description,
					coalesce(sec.len, 0)                      as len_sections,
					coalesce(sec.n, 0)                        as nb_sections,
					coalesce(varn.n, 0)                       as nb_variantes,
					coalesce(trf.n, 0)                        as nb_transformations,
					coalesce(tec.n, 0)                        as nb_techniques,
					coalesce(c.name_ja, '') <> ''             as a_nom_ja,
					coalesce(c.race, '') <> ''                as a_race,
					coalesce(c.ki, '') <> ''                  as a_ki,
					c.origin_planet_id is not null            as a_planete,
					(coalesce(c.image, '') <> ''
					   and c.image not like 'assets/wiki/characters/c%') as image_propre,
					c.debut_episode_id is not null            as a_debut_episode,
					c.debut_chapter_id is not null            as a_debut_chapitre
				from bot.db_characters c
				left join sec  on sec.id  = c.id
				left join varn on varn.id = c.id
				left join trf  on trf.id  = c.id
				left join tec  on tec.id  = c.id
				where coalesce(c.visible, true)`);

			const par = new Map<number, SignauxRichesse>();
			for (const r of rows) {
				par.set(Number(r.id), {
					longueurArticle: Number(r.len_article),
					longueurDescription: Number(r.len_description),
					longueurSections: Number(r.len_sections),
					nbSections: Number(r.nb_sections),
					nbVariantes: Number(r.nb_variantes),
					nbTransformations: Number(r.nb_transformations),
					nbTechniques: Number(r.nb_techniques),
					aNomJa: r.a_nom_ja,
					aRace: r.a_race,
					aKi: r.a_ki,
					aPlaneteOrigine: r.a_planete,
					imagePropre: r.image_propre,
					aDebutEpisode: r.a_debut_episode,
					aDebutChapitre: r.a_debut_chapitre,
				});
			}
			return par;
		}),

	saga: (slug: string) =>
		safe(async () => {
			const [s] = await db
				.select()
				.from(botSagas)
				.where(and(eq(botSagas.slug, slug), eq(botSagas.visible, true)))
				.limit(1);
			if (!s) return null;
			const arcs = (
				await db
					.select()
					.from(botArcs)
					.where(and(eq(botArcs.sagaId, s.id), eq(botArcs.visible, true)))
					.orderBy(asc(botArcs.orderIdx))
			).map(toArc);

			// Épisodes de la saga, DÉRIVÉS de ses bornes — `db_episodes.arc_id` est
			// nul sur 790 lignes sur 826, la relation n'existe pas en base. Une saga
			// sans borne (8 sur 33 : films, OAV, arcs manga-only de Super) rend une
			// liste vide, et la page n'affiche alors rien : mieux qu'un rattachement
			// approximatif.
			//
			// `Number()` à la lecture : postgres-js rend les `bigint` en chaînes.
			const debut = s.episodeStart === null ? null : Number(s.episodeStart);
			const fin = s.episodeEnd === null ? null : Number(s.episodeEnd);
			const episodes =
				s.episodeSeries && debut !== null && fin !== null
					? ((await db
							.select({
								id: botEpisodes.id,
								number_in_series: botEpisodes.numberInSeries,
								title: botEpisodes.title,
								image: botEpisodes.image,
							})
							.from(botEpisodes)
							.where(
								and(
									eq(botEpisodes.series, s.episodeSeries),
									eq(botEpisodes.visible, true),
									sql`${botEpisodes.numberInSeries} between ${debut} and ${fin}`,
								),
							)
							.orderBy(asc(botEpisodes.numberInSeries))) as EpisodeNavItem[])
					: [];

			return {
				...toSaga(s),
				arcs,
				episodes,
				/** La série d'épisodes réellement bornée — pas forcément `series`. */
				episodeSeries: s.episodeSeries ?? null,
			};
		}),

	/**
	 * Un arc, ses épisodes, et ce que la SAGA parente permet de mesurer.
	 *
	 * 45 des 65 arcs n'ont ni article ni description, et 790 épisodes sur 826
	 * n'ont pas d'`arc_id` : la page d'arc n'avait donc rien à montrer. La saga
	 * parente, elle, porte ses bornes (`manga_volume_start/end`,
	 * `episode_start/end`), posées par `variantes-par-saga.ts --bornes`.
	 *
	 * On rend donc les deux, SÉPARÉMENT — jamais fusionnés : `episodes` est le
	 * rattachement explicite (il fait foi), `sagaEpisodes` et `sagaVolumes` sont
	 * le périmètre de la saga, qui déborde l'arc et doit se dire comme tel à
	 * l'écran. Les confondre présenterait des épisodes d'un autre arc comme
	 * appartenant à celui-ci.
	 */
	arc: (slug: string) =>
		safe(async () => {
			const [a] = await db
				.select()
				.from(botArcs)
				.where(and(eq(botArcs.slug, slug), eq(botArcs.visible, true)))
				.limit(1);
			if (!a) return null;
			const [episodes, sagaRow] = await Promise.all([
				db
					.select()
					.from(botEpisodes)
					.where(and(eq(botEpisodes.arcId, a.id), eq(botEpisodes.visible, true)))
					.orderBy(asc(botEpisodes.numberInSeries))
					.then((rows) => rows.map(toEpisode)),
				a.sagaId
					? db
							.select()
							.from(botSagas)
							.where(and(eq(botSagas.id, a.sagaId), eq(botSagas.visible, true)))
							.limit(1)
							.then((r) => r[0] ?? null)
					: Promise.resolve(null),
			]);
			if (!sagaRow)
				return {
					arc: toArc(a),
					episodes,
					saga: null,
					sagaEpisodes: [],
					sagaVolumes: [],
				};

			// `Number()` sur TOUTE borne lue en base : postgres-js rend les `bigint`
			// en CHAÎNES, et `"163" <= "35"` est vrai lexicographiquement. C'est le
			// bug qui avait fabriqué ~100 fausses variantes de saga.
			const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
			const epDeb = num(sagaRow.episodeStart);
			const epFin = num(sagaRow.episodeEnd);
			const volDeb = num(sagaRow.mangaVolumeStart);
			const volFin = num(sagaRow.mangaVolumeEnd);

			const [sagaEpisodes, sagaVolumes] = await Promise.all([
				sagaRow.episodeSeries && epDeb !== null && epFin !== null
					? db
							.select({
								id: botEpisodes.id,
								number_in_series: botEpisodes.numberInSeries,
								title: botEpisodes.title,
								image: botEpisodes.image,
							})
							.from(botEpisodes)
							.where(
								and(
									eq(botEpisodes.series, sagaRow.episodeSeries),
									eq(botEpisodes.visible, true),
									sql`${botEpisodes.numberInSeries} between ${epDeb} and ${epFin}`,
								),
							)
							.orderBy(asc(botEpisodes.numberInSeries))
					: Promise.resolve([] as EpisodeNavItem[]),
				volDeb !== null && volFin !== null
					? db
							.select({
								id: botMangaVolumes.id,
								volume_number: botMangaVolumes.volumeNumber,
								title: botMangaVolumes.title,
								cover: botMangaVolumes.cover,
							})
							.from(botMangaVolumes)
							.where(
								and(
									eq(botMangaVolumes.series, "DB"),
									eq(botMangaVolumes.visible, true),
									sql`${botMangaVolumes.volumeNumber} between ${volDeb} and ${volFin}`,
								),
							)
							.orderBy(asc(botMangaVolumes.volumeNumber))
					: Promise.resolve([]),
			]);

			return {
				arc: toArc(a),
				episodes,
				saga: toSaga(sagaRow),
				sagaEpisodes: sagaEpisodes as EpisodeNavItem[],
				sagaVolumes,
			};
		}),

	/**
	 * La saga d'un épisode, DÉRIVÉE des bornes — rien n'est écrit en base.
	 *
	 * `db_episodes.arc_id` est nul sur 790 épisodes sur 826, et la base ne porte
	 * aucun `saga_id` sur l'épisode. Les bornes de saga, elles, existent
	 * (`episode_series` + `episode_start`/`episode_end`, posées par
	 * `variantes-par-saga.ts --bornes`) et couvrent **659 épisodes sur 826**.
	 *
	 * Pourquoi dériver plutôt qu'écrire une colonne : les bornes sont la source,
	 * une colonne en serait la copie, et une copie se désynchronise au premier
	 * ajustement. L'`arc_id`, lui, n'est de toute façon pas dérivable — 20 sagas
	 * sur 29 portent plusieurs arcs.
	 *
	 * `Number()` sur les bornes : postgres-js rend les `bigint` en CHAÎNES, et
	 * `"163" <= "35"` est vrai lexicographiquement. Ici la comparaison se fait en
	 * SQL sur des colonnes typées, donc le piège ne mord pas — mais la borne
	 * remonte quand même en chaîne côté TypeScript, d'où le cast à la lecture.
	 */
	episodeSaga: (series: string, numberInSeries: number) =>
		safe(async () => {
			const [s] = await db
				.select({
					id: botSagas.id,
					slug: botSagas.slug,
					name: botSagas.name,
					series: botSagas.series,
					image: botSagas.image,
					start: botSagas.episodeStart,
					end: botSagas.episodeEnd,
				})
				.from(botSagas)
				.where(
					and(
						eq(botSagas.visible, true),
						eq(botSagas.episodeSeries, series),
						sql`${numberInSeries} between ${botSagas.episodeStart} and ${botSagas.episodeEnd}`,
					),
				)
				// Une borne plus étroite est plus précise : si deux sagas se
				// chevauchent en base, on prend celle qui couvre le moins d'épisodes.
				.orderBy(asc(sql`${botSagas.episodeEnd} - ${botSagas.episodeStart}`))
				.limit(1);
			if (!s) return null;
			return {
				id: s.id,
				slug: s.slug,
				name: s.name,
				series: s.series,
				image: s.image,
				episode_start: Number(s.start),
				episode_end: Number(s.end),
			};
		}),

	episode: (id: number) =>
		safe(async () => {
			const [e] = await db
				.select()
				.from(botEpisodes)
				.where(and(eq(botEpisodes.id, id), eq(botEpisodes.visible, true)))
				.limit(1);
			return e ? toEpisode(e) : null;
		}),

	/** Flux résolu (HLS/mp4) + headers d'un épisode, pour le proxy HLS. */
	episodeStream: (id: number) =>
		safe(async () => {
			const [e] = await db
				.select({
					url: botEpisodes.streamUrl,
					headers: botEpisodes.streamHeaders,
				})
				.from(botEpisodes)
				.where(eq(botEpisodes.id, id))
				.limit(1);
			return e?.url ? { url: e.url, headers: e.headers ?? {} } : null;
		}),

	episodes: (series?: string, limit = 50, offset = 0) =>
		safe(async () => {
			const rows = series
				? await db
						.select()
						.from(botEpisodes)
						.where(and(eq(botEpisodes.series, series), eq(botEpisodes.visible, true)))
						.orderBy(asc(botEpisodes.numberInSeries))
						.limit(limit)
						.offset(offset)
				: await db
						.select()
						.from(botEpisodes)
						.where(eq(botEpisodes.visible, true))
						.orderBy(asc(botEpisodes.series), asc(botEpisodes.numberInSeries))
						.limit(limit)
						.offset(offset);
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)::int` })
				.from(botEpisodes)
				.where(
					series ? and(eq(botEpisodes.series, series), eq(botEpisodes.visible, true)) : eq(botEpisodes.visible, true),
				);
			return { episodes: rows.map(toEpisode), total: Number(n ?? 0) };
		}),

	/**
	 * Séries d'épisodes RÉELLEMENT présentes (avec compte), pour ne proposer
	 * que des onglets accessibles (sinon une série à 0 épisode → 404).
	 */
	episodeSeries: () =>
		safe(async () => {
			const rows = await db
				.select({ series: botEpisodes.series, n: sql<number>`count(*)::int` })
				.from(botEpisodes)
				.where(eq(botEpisodes.visible, true))
				.groupBy(botEpisodes.series);
			return rows.map((r) => ({ series: r.series, count: Number(r.n) })).filter((r) => r.count > 0);
		}),

	/**
	 * Identifiants de tous les épisodes visibles — projection légère pour
	 * `generateStaticParams`, sans charger les synopsis, players et frames en mémoire.
	 */
	episodeIds: () =>
		safe(async () => {
			const rows = await db
				.select({ id: botEpisodes.id })
				.from(botEpisodes)
				.where(eq(botEpisodes.visible, true))
				.orderBy(asc(botEpisodes.id));
			return rows.map((r) => r.id);
		}),

	/**
	 * Épisode précédent / suivant + un échantillon d'épisodes voisins de la même
	 * série, pour la navigation cinématique de la page épisode.
	 */
	episodeNav: (series: string, number: number) =>
		safe(async () => {
			const lite = {
				id: botEpisodes.id,
				number_in_series: botEpisodes.numberInSeries,
				title: botEpisodes.title,
				image: botEpisodes.image,
			};
			const [prev] = await db
				.select(lite)
				.from(botEpisodes)
				.where(
					and(eq(botEpisodes.series, series), lt(botEpisodes.numberInSeries, number), eq(botEpisodes.visible, true)),
				)
				.orderBy(desc(botEpisodes.numberInSeries))
				.limit(1);
			const [next] = await db
				.select(lite)
				.from(botEpisodes)
				.where(
					and(eq(botEpisodes.series, series), gt(botEpisodes.numberInSeries, number), eq(botEpisodes.visible, true)),
				)
				.orderBy(asc(botEpisodes.numberInSeries))
				.limit(1);
			// Fenêtre de 12 épisodes voisins (centrée approximativement) pour le strip.
			const around = await db
				.select(lite)
				.from(botEpisodes)
				.where(
					and(
						eq(botEpisodes.series, series),
						gt(botEpisodes.numberInSeries, number - 7),
						lt(botEpisodes.numberInSeries, number + 7),
						eq(botEpisodes.visible, true),
					),
				)
				.orderBy(asc(botEpisodes.numberInSeries));
			const lift = (e: typeof prev | undefined): EpisodeNavItem | null =>
				e
					? {
							id: e.id,
							number_in_series: e.number_in_series ?? 0,
							title: e.title ?? "",
							image: e.image,
						}
					: null;
			return {
				prev: lift(prev),
				next: lift(next),
				around: around.map((e) => lift(e)!).filter(Boolean),
			};
		}),

	movies: () =>
		safe(async () => ({
			movies: (await db.select().from(botMovies).where(eq(botMovies.visible, true))).map(toMovie),
		})),

	movie: (slug: string) =>
		safe(async () => {
			const [m] = await db
				.select()
				.from(botMovies)
				.where(
					and(
						/^\d+$/.test(slug) ? eq(botMovies.id, Number(slug)) : eq(botMovies.slug, slug),
						eq(botMovies.visible, true),
					),
				)
				.limit(1);
			return m ? toMovie(m) : null;
		}),

	/**
	 * Film précédent / suivant + la liste complète des films de la même série,
	 * ordonnés par date de sortie (tie-break id) — cohérent avec l'ordre de
	 * l'index /wiki/films. Les films n'ont PAS de numéro (contrairement aux
	 * épisodes) → l'adjacence se fait sur `release_date` (null → fin de liste).
	 */
	movieNav: (series: string, id: number) =>
		safe(async () => {
			const rows = await db
				.select({
					id: botMovies.id,
					slug: botMovies.slug,
					title: botMovies.title,
					poster: botMovies.poster,
					release_date: botMovies.releaseDate,
				})
				.from(botMovies)
				.where(and(eq(botMovies.series, series), eq(botMovies.visible, true)));
			const sorted: MovieNavItem[] = rows
				.map((r) => ({
					id: r.id,
					slug: r.slug ?? String(r.id),
					title: r.title ?? "",
					poster: r.poster,
					release_date: r.release_date ?? null,
				}))
				.toSorted(
					(a, b) =>
						(a.release_date ?? Number.POSITIVE_INFINITY) - (b.release_date ?? Number.POSITIVE_INFINITY) || a.id - b.id,
				);
			const idx = sorted.findIndex((m) => m.id === id);
			return {
				prev: idx > 0 ? sorted[idx - 1]! : null,
				next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1]! : null,
				around: sorted,
			};
		}),

	/**
	 * Dataset EXHAUSTIF de la chronologie universelle : TOUS les épisodes, TOUS
	 * les films, et les tomes canoniques du manga (DB « Dragon Ball Vol. N » + DBS
	 * « Dragon Ball Super Vol. N »), toutes séries confondues, normalisés sous des
	 * « ères » communes (cf. `@/lib/chronology`). Les tomes sont rangés dans l'ère
	 * `Manga` (leur code série `DB`/`DBS` désigne aussi des épisodes → l'ère est
	 * forcée ici, pas dérivée de `eraOf`). Aucun tri imposé (le client/l'admin
	 * trie/filtre) : on renvoie la matière première (ère, date, numéro, langues).
	 * ~750 items → un seul round-trip par table.
	 */
	timeline: () =>
		safe(async (): Promise<TimelineItem[]> => {
			const [eps, movs, vols] = await Promise.all([
				db
					.select({
						id: botEpisodes.id,
						series: botEpisodes.series,
						number: botEpisodes.numberInSeries,
						title: botEpisodes.title,
						titleJa: botEpisodes.titleJa,
						date: botEpisodes.airDate,
						image: botEpisodes.image,
						players: botEpisodes.players,
					})
					.from(botEpisodes)
					.where(eq(botEpisodes.visible, true)),
				db
					.select({
						id: botMovies.id,
						slug: botMovies.slug,
						series: botMovies.series,
						title: botMovies.title,
						titleJa: botMovies.titleJa,
						date: botMovies.releaseDate,
						poster: botMovies.poster,
						players: botMovies.players,
					})
					.from(botMovies)
					.where(eq(botMovies.visible, true)),
				// Tomes canoniques uniquement : les spin-offs (SD, Yamcha, Episode of
				// Bardock…) vivent dans la même table sous d'AUTRES codes série, donc
				// le filtre porte sur la série, pas sur le titre.
				//
				// Le filtre précédent exigeait un titre « Dragon Ball Vol. N » — et le
				// tome 1, seul du catalogue à porter son vrai titre (« Son Goku et ses
				// amis »), était donc absent de la frise : la chronologie du manga
				// commençait au tome 2. Vérifié en base avant la bascule : sous `DB` et
				// `DBS`, cette table ne contient QUE les 42 + 24 tomes canoniques.
				db
					.select({
						id: botMangaVolumes.id,
						series: botMangaVolumes.series,
						number: botMangaVolumes.volumeNumber,
						title: botMangaVolumes.title,
						titleJa: botMangaVolumes.titleJa,
						date: botMangaVolumes.publishedAt,
						cover: botMangaVolumes.cover,
					})
					.from(botMangaVolumes)
					.where(
						and(
							eq(botMangaVolumes.visible, true),
							or(eq(botMangaVolumes.series, "DB"), eq(botMangaVolumes.series, "DBS")),
						),
					),
			]);
			// Garde `Array.isArray` : `players` jsonb peut être un scalaire corrompu
			// (piège documenté) → un `.some` non gardé planterait tout le dataset.
			const langs = (players: { lang?: "vf" | "vostfr" }[] | null): { hasVf: boolean; hasVostfr: boolean } => {
				const arr = Array.isArray(players) ? players : [];
				return {
					hasVf: arr.some((p) => p.lang === "vf"),
					hasVostfr: arr.some((p) => p.lang === "vostfr"),
				};
			};
			const items: TimelineItem[] = [
				...eps.map((e) => {
					const l = langs(e.players);
					return {
						kind: "episode" as const,
						id: e.id,
						href: `/wiki/episodes/${e.id}`,
						title: e.title ?? "",
						titleJa: e.titleJa,
						series: e.series,
						era: eraOf(e.series),
						number: e.number ?? null,
						date: e.date ?? null,
						image: e.image,
						hasVf: l.hasVf,
						hasVostfr: l.hasVostfr,
					};
				}),
				...movs.map((m) => {
					const l = langs(m.players);
					return {
						kind: "movie" as const,
						id: m.id,
						href: `/wiki/films/${m.slug ?? m.id}`,
						title: m.title ?? "",
						titleJa: m.titleJa,
						series: m.series ?? "",
						era: eraOf(m.series),
						number: null,
						date: m.date ?? null,
						image: m.poster,
						hasVf: l.hasVf,
						hasVostfr: l.hasVostfr,
					};
				}),
				...vols.map((v) => ({
					kind: "manga" as const,
					id: v.id,
					href: `/wiki/manga/volume/${v.id}`,
					title: v.title ?? `Tome ${v.number ?? "?"}`,
					titleJa: v.titleJa,
					series: v.series,
					era: "Manga" as const,
					number: v.number ?? null,
					date: v.date ?? null,
					image: v.cover,
					hasVf: false,
					hasVostfr: false,
				})),
			];
			return items;
		}),

	games: () =>
		safe(async () => ({
			games: (await db.select().from(botGames).where(eq(botGames.visible, true))).map(toGame),
		})),

	game: (slug: string) =>
		safe(async () => {
			const [g] = await db
				.select()
				.from(botGames)
				.where(and(eq(botGames.slug, slug), eq(botGames.visible, true)))
				.limit(1);
			if (!g) return null;
			const rawCharacters = await db
				.select({
					id: botCharacters.id,
					name: botCharacters.name,
					name_ja: botCharacters.nameJa,
					image: botCharacters.image,
				})
				.from(botGameCharacters)
				.innerJoin(botCharacters, eq(botCharacters.id, botGameCharacters.characterId))
				.where(and(eq(botGameCharacters.gameId, g.id), eq(botCharacters.visible, true)))
				.orderBy(asc(botCharacters.name));
			const characters = rawCharacters.map((c) => (Object.assign(c, { slug: formatCharacterSlug(c) })));
			return { ...toGame(g), characters };
		}),

	tools: () =>
		safe(async () => ({
			// `visible = false` masque un dépôt hors sujet (playlists IPTV, démos
			// Android) sans jamais le supprimer — la doctrine du wiki interdit la
			// suppression éditoriale dure.
			tools: (await db.select().from(botTools).where(eq(botTools.visible, true)).orderBy(desc(botTools.stars))).map(
				toTool,
			),
		})),

	tool: (slug: string) =>
		safe(async () => {
			const [t] = await db.select().from(botTools).where(eq(botTools.slug, slug)).limit(1);
			return t ? toTool(t) : null;
		}),

	races: () =>
		safe(async () => ({
			races: (await db.select().from(botRaces).where(eq(botRaces.visible, true))).map(toRace),
		})),

	race: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botRaces)
				.where(and(eq(botRaces.slug, slug), eq(botRaces.visible, true)))
				.limit(1);
			return r ? toRace(r) : null;
		}),

	transformations: () =>
		safe(async () => ({
			transformations: (await db.select().from(botTransformations).where(eq(botTransformations.visible, true))).map(
				toTransformation,
			),
		})),

	mangaVolumes: (series = "DB") =>
		safe(async () => ({
			volumes: (
				await db
					.select()
					.from(botMangaVolumes)
					.where(and(eq(botMangaVolumes.series, series), eq(botMangaVolumes.visible, true)))
					.orderBy(asc(botMangaVolumes.volumeNumber))
			).map(toMangaVolume),
		})),

	/**
	 * Catalogue bibliographique complet, toutes séries confondues.
	 *
	 * La page `/wiki/manga` ne peut pas deviner les séries à montrer à partir
	 * d'une liste codée en dur : chaque nouvelle collection ingérée (Gaiden,
	 * Heroes, etc.) restait alors invisible malgré sa fiche publique. Cette
	 * projection légère est l'inventaire unique utilisé par le hub.
	 */
	mangaCatalogVolumes: () =>
		safe(async () => ({
			volumes: (
				await db
					.select()
					.from(botMangaVolumes)
					.where(eq(botMangaVolumes.visible, true))
					.orderBy(asc(botMangaVolumes.series), asc(botMangaVolumes.volumeNumber))
			).map(toMangaVolume),
		})),

	/** Databooks & interviews visibles, triés par date (défaut : plus récent). */
	databooks: (opts: { kind?: string; order?: "asc" | "desc" } = {}) =>
		safe(async () => {
			const conds = [eq(botDatabooks.visible, true)];
			if (opts.kind) conds.push(eq(botDatabooks.kind, opts.kind));
			const rows = await db
				.select()
				.from(botDatabooks)
				.where(and(...conds))
				.orderBy(opts.order === "asc" ? asc(botDatabooks.publishedAt) : desc(botDatabooks.publishedAt));
			return { items: rows.map(toDatabook) };
		}),

	/**
	 * Identifiants de tous les databooks visibles — projection légère pour
	 * `generateStaticParams`, sans charger les pages et transcriptions en mémoire.
	 */
	databookIds: () =>
		safe(async () => {
			const rows = await db
				.select({ id: botDatabooks.id })
				.from(botDatabooks)
				.where(eq(botDatabooks.visible, true))
				.orderBy(asc(botDatabooks.id));
			return rows.map((r) => r.id);
		}),

	/** Fiche databook / interview + pages lecteur. */
	databook: (id: number) =>
		safe(async () => {
			const [row] = await db
				.select()
				.from(botDatabooks)
				.where(and(eq(botDatabooks.id, id), eq(botDatabooks.visible, true)))
				.limit(1);
			return row ? toDatabook(row) : null;
		}),

	/** Publications dérivées (Light Novels, Jump Anime Comics). */
	mediaPublications: (type?: string) =>
		safe(async () => {
			const conds = [eq(botMediaPublications.visible, true)];
			if (type) conds.push(eq(botMediaPublications.publicationType, type));
			const rows = await db
				.select()
				.from(botMediaPublications)
				.where(and(...conds))
				.orderBy(desc(botMediaPublications.publishedAt));
			return rows.map(toMediaPublication);
		}),

	mediaPublicationById: (id: number) =>
		safe(async () => {
			const [row] = await db
				.select()
				.from(botMediaPublications)
				.where(and(eq(botMediaPublications.id, id), eq(botMediaPublications.visible, true)))
				.limit(1);
			return row ? toMediaPublication(row) : null;
		}),

	mangaVolume: (id: number) =>
		safe(async () => {
			const [v] = await db
				.select()
				.from(botMangaVolumes)
				.where(and(eq(botMangaVolumes.id, id), eq(botMangaVolumes.visible, true)))
				.limit(1);
			if (!v) return null;
			const chapters = (
				await db
					.select()
					.from(botMangaChapters)
					.where(and(eq(botMangaChapters.volumeId, id), eq(botMangaChapters.visible, true)))
					.orderBy(asc(botMangaChapters.chapterNumber))
			).map(toMangaChapter);
			return { ...toMangaVolume(v), chapters };
		}),

	// Chapitres manga LISIBLES → index du lecteur de scan.
	/**
	 * Chapitres lisibles — SANS leur tableau de planches complet.
	 *
	 * `select()` rendait la colonne `pages` entière : **12 362 chemins `.webp`**
	 * sérialisés dans la charge RSC de `/wiki/manga`, une page qui affiche 24
	 * couvertures et 62 liens. À elle seule cette colonne pesait ~600 Ko des
	 * 744 Ko de la page.
	 *
	 * Les appelants n'en ont jamais eu besoin en entier : la grille teste
	 * « ce chapitre est-il lisible » et précharge les **3 premières** planches au
	 * survol ; les deux `generateStaticParams` ne lisent que des identifiants. On
	 * découpe donc côté Postgres (`jsonb_path_query_array` sur les index 0 à 2) et
	 * on rend le total à part.
	 *
	 * Il ne faut surtout pas filtrer la requête SQL sur `pages` non vide. Certaines
	 * séries (DB, DBFC et DBS) disposent d'un miroir local complet :
	 * `publishedMangaPages` sait reconstruire leurs planches quand la colonne est
	 * vide ou ne contient que les anciennes URL anti-hotlink. Le filtrage est donc
	 * effectué après cette résolution, ce qui garde les tomes et chapitres reliés
	 * à leurs planches réellement servies.
	 */
	readableMangaChapters: (series?: string) =>
		safe(async () => ({
			chapters: (
				await db
					.select({
						id: botMangaChapters.id,
						series: botMangaChapters.series,
						chapterNumber: botMangaChapters.chapterNumber,
						title: botMangaChapters.title,
						volumeId: botMangaChapters.volumeId,
						cover: botMangaChapters.cover,
						pages: sql<string[] | null>`jsonb_path_query_array(${botMangaChapters.pages}, '$[0 to 2]')`.as("pages"),
						pageCount: sql<number>`coalesce(jsonb_array_length(${botMangaChapters.pages}), 0)::int`.as("page_count"),
					})
					.from(botMangaChapters)
					.where(
						series
							? and(eq(botMangaChapters.series, series), eq(botMangaChapters.visible, true))
							: eq(botMangaChapters.visible, true),
					)
					.orderBy(asc(botMangaChapters.series), asc(botMangaChapters.chapterNumber))
			)
				.map((c) => ({
					id: c.id,
					series: c.series,
					chapter_number: c.chapterNumber ?? 0,
					title: c.title,
					volume_id: c.volumeId,
					cover: mangaCoverPath(c.series, c.chapterNumber ?? 0, c.cover),
					/** Aperçu : les 3 premières planches, pour le préchargement au survol. */
					pages: publishedMangaPages(c.series, c.chapterNumber ?? 0, c.pages, 3),
					/** Nombre RÉEL de planches — `pages.length` ne vaut plus que 3 au plus. */
					page_count: publishedMangaPageCount(c.series, c.chapterNumber ?? 0, c.pages, Number(c.pageCount ?? 0)),
				}))
				.filter((chapter) => chapter.pages.length > 0),
		})),

	// Un chapitre + ses pages + chapitres adjacents (nav lecteur).
	mangaChapter: (id: number) =>
		safe<MangaChapterRead | null>(async () => {
			const [c] = await db
				.select()
				.from(botMangaChapters)
				.where(and(eq(botMangaChapters.id, id), eq(botMangaChapters.visible, true)))
				.limit(1);
			if (!c) return null;
			const chapter = toMangaChapter(c);
			if ((chapter.pages?.length ?? 0) === 0) return null;
			const previous = await db
				.select({
					id: botMangaChapters.id,
					chapterNumber: botMangaChapters.chapterNumber,
					pages: botMangaChapters.pages,
				})
				.from(botMangaChapters)
				.where(
					and(
						eq(botMangaChapters.series, c.series),
						lt(botMangaChapters.chapterNumber, c.chapterNumber ?? 0),
						eq(botMangaChapters.visible, true),
					),
				)
				.orderBy(desc(botMangaChapters.chapterNumber));
			const following = await db
				.select({
					id: botMangaChapters.id,
					chapterNumber: botMangaChapters.chapterNumber,
					pages: botMangaChapters.pages,
				})
				.from(botMangaChapters)
				.where(
					and(
						eq(botMangaChapters.series, c.series),
						gt(botMangaChapters.chapterNumber, c.chapterNumber ?? 0),
						eq(botMangaChapters.visible, true),
					),
				)
				.orderBy(asc(botMangaChapters.chapterNumber));
			const prev = previous.find(
				(candidate) => publishedMangaPages(c.series, candidate.chapterNumber ?? 0, candidate.pages).length > 0,
			);
			const next = following.find(
				(candidate) => publishedMangaPages(c.series, candidate.chapterNumber ?? 0, candidate.pages).length > 0,
			);
			return {
				...chapter,
				pages: chapter.pages ?? [],
				prev:
					publishedMangaPages(c.series, prev?.chapterNumber ?? 0, prev?.pages).length > 0 ? (prev?.id ?? null) : null,
				next:
					publishedMangaPages(c.series, next?.chapterNumber ?? 0, next?.pages).length > 0 ? (next?.id ?? null) : null,
				prevPages: publishedMangaPages(c.series, prev?.chapterNumber ?? 0, prev?.pages),
				nextPages: publishedMangaPages(c.series, next?.chapterNumber ?? 0, next?.pages),
			};
		}),

	news: (limit = 10) =>
		safe(async () => ({
			news: (await db.select().from(botNews).orderBy(desc(botNews.publishedAt)).limit(limit)).map(toNews),
		})),

	search: (q: string) =>
		safe<SearchResults>(async () => {
			const term = q.trim();
			if (term.length < 2) {
				return {
					q: term,
					characters: [],
					planets: [],
					sagas: [],
					movies: [],
					games: [],
					episodes: [],
					techniques: [],
					races: [],
					transformations: [],
					arcs: [],
					mangaVolumes: [],
					mangaChapters: [],
					battles: [],
					locations: [],
					tournaments: [],
					voiceActors: [],
					soundtracks: [],
					powerLevels: [],
					items: [],
					dragons: [],
					databooks: [],
					novels: [],
					contributors: [],
				};
			}
			const charCols = [botCharacters.name, botCharacters.nameJa, botCharacters.nameRomaji];
			const planetCols = [botPlanets.name, botPlanets.nameJa];
			const sagaCols = [botSagas.name, botSagas.nameJa];
			const movieCols = [botMovies.title, botMovies.titleJa];
			const gameCols = [botGames.title, botGames.titleJa];
			const episodeCols = [botEpisodes.title, botEpisodes.titleJa, botEpisodes.titleRomaji];
			const techniqueCols = [botTechniques.name, botTechniques.nameJa, botTechniques.nameRomaji];
			const raceCols = [botRaces.name, botRaces.nameJa];
			const arcCols = [botArcs.name, botArcs.nameJa];
			const transfoCols = [botTransformations.name];
			const volCols = [botMangaVolumes.title, botMangaVolumes.titleJa];
			const chapCols = [botMangaChapters.title, botMangaChapters.titleJa];
			const battleCols = [botBattles.title, botBattles.titleJa, botBattles.series];
			const locationCols = [botLocations.name, botLocations.nameJa, botLocations.nameRomaji, botLocations.planet];
			const tournamentCols = [botTournaments.name, botTournaments.nameJa, botTournaments.saga];
			const voiceActorCols = [botVoiceActors.name, botVoiceActors.nameJa];
			const soundtrackCols = [
				botSoundtracks.title,
				botSoundtracks.titleJa,
				botSoundtracks.titleRomaji,
				botSoundtracks.artist,
			];
			const powerLevelCols = [botPowerLevels.characterName, botPowerLevels.sagaName, botPowerLevels.form];
			const itemCols = [botItems.name, botItems.nameJa, botItems.nameRomaji, botItems.category];
			const dragonCols = [botDragons.name, botDragons.nameJa, botDragons.creator];
			const databookCols = [botDatabooks.title, botDatabooks.titleJa, botDatabooks.author];
			const novelCols = [botMediaPublications.title, botMediaPublications.titleJa, botMediaPublications.author];
			const contributorCols = [botContributors.name, botContributors.nameJa, botContributors.nameRomaji];
			// Manga : un terme purement numérique matche aussi le n° de tome/chapitre.
			const num = /^\d{1,4}$/.test(term) ? Number(term) : null;
			// Garde-fous anti-fantômes : ne remonter dans la recherche que les tomes
			// CANONIQUES (mêmes préfixes que timeline()/la grille — exclut spin-offs et
			// doublons « Volume N ») et les chapitres LISIBLES (pages renseignées).
			// Sinon /wiki/search surfaçait des entrées menant à des pages vides.
			// Filtre par SÉRIE et non par titre : le tome 1 s'appelle « Son Goku et
			// ses amis » et un filtre sur « Dragon Ball Vol. % » l'excluait de la
			// recherche comme de la frise (cf. timeline()).
			const canonicalVolTitle = or(eq(botMangaVolumes.series, "DB"), eq(botMangaVolumes.series, "DBS"));
			const volWhere = and(
				num != null ? or(fuzzyWhere(term, volCols), eq(botMangaVolumes.volumeNumber, num)) : fuzzyWhere(term, volCols),
				canonicalVolTitle,
			);
			const chapWhere = and(
				num != null ? or(fuzzyWhere(term, chapCols), eq(botMangaChapters.chapterNumber, num)) : fuzzyWhere(term, chapCols),
				sql`jsonb_array_length(case when jsonb_typeof(${botMangaChapters.pages}) = 'array' then ${botMangaChapters.pages} else '[]'::jsonb end) > 0`,
			);
			const [
				characters,
				planets,
				sagas,
				movies,
				games,
				episodes,
				techniques,
				races,
				transformations,
				arcs,
				mangaVolumes,
				mangaChapters,
				battles,
				locations,
				tournaments,
				voiceActors,
				soundtracks,
				powerLevels,
				items,
				dragons,
				databooks,
				novels,
				contributors,
			] = await Promise.all([
				db
					.select({
						id: botCharacters.id,
						name: botCharacters.name,
						name_ja: botCharacters.nameJa,
						image: botCharacters.image,
						race: botCharacters.race,
					})
					.from(botCharacters)
					.where(and(fuzzyWhere(term, charCols), eq(botCharacters.visible, true)))
					.orderBy(...fuzzyOrder(term, charCols))
					.limit(20),
				db
					.select({
						id: botPlanets.id,
						name: botPlanets.name,
						name_ja: botPlanets.nameJa,
						image: botPlanets.image,
					})
					.from(botPlanets)
					.where(and(fuzzyWhere(term, planetCols), eq(botPlanets.visible, true)))
					.orderBy(...fuzzyOrder(term, planetCols))
					.limit(10),
				db
					.select({
						id: botSagas.id,
						slug: botSagas.slug,
						name: botSagas.name,
						name_ja: botSagas.nameJa,
						series: botSagas.series,
					})
					.from(botSagas)
					.where(and(fuzzyWhere(term, sagaCols), eq(botSagas.visible, true)))
					.orderBy(...fuzzyOrder(term, sagaCols))
					.limit(10),
				db
					.select({
						id: botMovies.id,
						slug: botMovies.slug,
						title: botMovies.title,
						title_ja: botMovies.titleJa,
						series: botMovies.series,
					})
					.from(botMovies)
					.where(and(fuzzyWhere(term, movieCols), eq(botMovies.visible, true)))
					.orderBy(...fuzzyOrder(term, movieCols))
					.limit(10),
				db
					.select({
						id: botGames.id,
						slug: botGames.slug,
						title: botGames.title,
						title_ja: botGames.titleJa,
					})
					.from(botGames)
					.where(and(fuzzyWhere(term, gameCols), eq(botGames.visible, true)))
					.orderBy(...fuzzyOrder(term, gameCols))
					.limit(10),
				db
					.select({
						id: botEpisodes.id,
						series: botEpisodes.series,
						number_in_series: botEpisodes.numberInSeries,
						title: botEpisodes.title,
						image: botEpisodes.image,
					})
					.from(botEpisodes)
					.where(and(fuzzyWhere(term, episodeCols), eq(botEpisodes.visible, true)))
					.orderBy(...fuzzyOrder(term, episodeCols))
					.limit(12),
				db
					.select({
						id: botTechniques.id,
						slug: botTechniques.slug,
						name: botTechniques.name,
						name_ja: botTechniques.nameJa,
						type: botTechniques.type,
					})
					.from(botTechniques)
					.where(and(fuzzyWhere(term, techniqueCols), eq(botTechniques.visible, true)))
					.orderBy(...fuzzyOrder(term, techniqueCols))
					.limit(10),
				db
					.select({
						id: botRaces.id,
						slug: botRaces.slug,
						name: botRaces.name,
						name_ja: botRaces.nameJa,
					})
					.from(botRaces)
					.where(and(fuzzyWhere(term, raceCols), eq(botRaces.visible, true)))
					.orderBy(...fuzzyOrder(term, raceCols))
					.limit(8),
				db
					.select({
						id: botTransformations.id,
						name: botTransformations.name,
						image: botTransformations.image,
						character_id: botTransformations.characterId,
					})
					.from(botTransformations)
					.where(and(fuzzyWhere(term, transfoCols), eq(botTransformations.visible, true)))
					.orderBy(...fuzzyOrder(term, transfoCols))
					.limit(24),
				db
					.select({
						id: botArcs.id,
						slug: botArcs.slug,
						name: botArcs.name,
						name_ja: botArcs.nameJa,
						saga_slug: botSagas.slug,
					})
					.from(botArcs)
					.leftJoin(botSagas, eq(botArcs.sagaId, botSagas.id))
					.where(and(fuzzyWhere(term, arcCols), eq(botArcs.visible, true)))
					.orderBy(...fuzzyOrder(term, arcCols))
					.limit(10),
				db
					.select({
						id: botMangaVolumes.id,
						series: botMangaVolumes.series,
						volume_number: botMangaVolumes.volumeNumber,
						title: botMangaVolumes.title,
						cover: botMangaVolumes.cover,
					})
					.from(botMangaVolumes)
					.where(and(volWhere, eq(botMangaVolumes.visible, true)))
					.orderBy(...fuzzyOrder(term, volCols), asc(botMangaVolumes.volumeNumber))
					.limit(10),
				db
					.select({
						id: botMangaChapters.id,
						series: botMangaChapters.series,
						chapter_number: botMangaChapters.chapterNumber,
						title: botMangaChapters.title,
					})
					.from(botMangaChapters)
					.where(and(chapWhere, eq(botMangaChapters.visible, true)))
					.orderBy(...fuzzyOrder(term, chapCols), asc(botMangaChapters.chapterNumber))
					.limit(12),
				db
					.select({
						id: botBattles.id,
						slug: botBattles.slug,
						name: botBattles.title,
						name_ja: botBattles.titleJa,
						saga: botBattles.series,
					})
					.from(botBattles)
					.where(and(fuzzyWhere(term, battleCols), eq(botBattles.visible, true)))
					.orderBy(...fuzzyOrder(term, battleCols))
					.limit(10),
				db
					.select({
						id: botLocations.id,
						slug: botLocations.slug,
						name: botLocations.name,
						name_ja: botLocations.nameJa,
						realm_type: botLocations.realmType,
						image: botLocations.image,
					})
					.from(botLocations)
					.where(and(fuzzyWhere(term, locationCols), eq(botLocations.visible, true)))
					.orderBy(...fuzzyOrder(term, locationCols))
					.limit(10),
				db
					.select({
						id: botTournaments.id,
						slug: botTournaments.slug,
						name: botTournaments.name,
						name_ja: botTournaments.nameJa,
						saga: botTournaments.saga,
					})
					.from(botTournaments)
					.where(and(fuzzyWhere(term, tournamentCols), eq(botTournaments.visible, true)))
					.orderBy(...fuzzyOrder(term, tournamentCols))
					.limit(10),
				db
					.select({
						id: botVoiceActors.id,
						slug: botVoiceActors.slug,
						name: botVoiceActors.name,
						name_ja: botVoiceActors.nameJa,
						nationality: botVoiceActors.nationality,
					})
					.from(botVoiceActors)
					.where(and(fuzzyWhere(term, voiceActorCols), eq(botVoiceActors.visible, true)))
					.orderBy(...fuzzyOrder(term, voiceActorCols))
					.limit(10),
				db
					.select({
						id: botSoundtracks.id,
						slug: botSoundtracks.slug,
						title: botSoundtracks.title,
						title_ja: botSoundtracks.titleJa,
						track_type: botSoundtracks.trackType,
						series: botSoundtracks.series,
					})
					.from(botSoundtracks)
					.where(and(fuzzyWhere(term, soundtrackCols), eq(botSoundtracks.visible, true)))
					.orderBy(...fuzzyOrder(term, soundtrackCols))
					.limit(10),
				db
					.select({
						id: botPowerLevels.id,
						character_name: botPowerLevels.characterName,
						battle_or_context: botPowerLevels.sagaName,
						power_value_formatted: botPowerLevels.battlePowerDisplay,
					})
					.from(botPowerLevels)
					.where(and(fuzzyWhere(term, powerLevelCols), eq(botPowerLevels.visible, true)))
					.orderBy(...fuzzyOrder(term, powerLevelCols))
					.limit(10),
				db
					.select({
						id: botItems.id,
						slug: botItems.slug,
						name: botItems.name,
						name_ja: botItems.nameJa,
						category: botItems.category,
						image: botItems.image,
					})
					.from(botItems)
					.where(and(fuzzyWhere(term, itemCols), eq(botItems.visible, true)))
					.orderBy(...fuzzyOrder(term, itemCols))
					.limit(10),
				db
					.select({
						id: botDragons.id,
						slug: botDragons.slug,
						name: botDragons.name,
						name_ja: botDragons.nameJa,
						creator: botDragons.creator,
						image: botDragons.image,
					})
					.from(botDragons)
					.where(and(fuzzyWhere(term, dragonCols), eq(botDragons.visible, true)))
					.orderBy(...fuzzyOrder(term, dragonCols))
					.limit(10),
				db
					.select({
						id: botDatabooks.id,
						title: botDatabooks.title,
						title_ja: botDatabooks.titleJa,
						category: botDatabooks.category,
						cover: botDatabooks.cover,
					})
					.from(botDatabooks)
					.where(and(fuzzyWhere(term, databookCols), eq(botDatabooks.visible, true)))
					.orderBy(...fuzzyOrder(term, databookCols))
					.limit(10),
				db
					.select({
						id: botMediaPublications.id,
						title: botMediaPublications.title,
						title_ja: botMediaPublications.titleJa,
						publication_type: botMediaPublications.publicationType,
						cover: botMediaPublications.cover,
					})
					.from(botMediaPublications)
					.where(and(fuzzyWhere(term, novelCols), eq(botMediaPublications.visible, true)))
					.orderBy(...fuzzyOrder(term, novelCols))
					.limit(10),
				db
					.select({
						id: botContributors.id,
						slug: botContributors.slug,
						name: botContributors.name,
						name_ja: botContributors.nameJa,
						category: botContributors.category,
					})
					.from(botContributors)
					.where(and(fuzzyWhere(term, contributorCols), eq(botContributors.visible, true)))
					.orderBy(asc(botContributors.spotlightRank), ...fuzzyOrder(term, contributorCols))
					.limit(10),
			]);
			// Dédup des transformations par nom (Super Saiyan partagé par N persos) et
			// exclusion de celles sans personnage rattaché (lien impossible).
			const transfoSeen = new Set<string>();
			const transfoDedup = transformations
				.filter(
					(
						t,
					): t is {
						id: number;
						name: string;
						image: string | null;
						character_id: number;
					} => {
						if (t.character_id == null) return false;
						const k = t.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
						if (transfoSeen.has(k)) return false;
						transfoSeen.add(k);
						return true;
					},
				)
				.slice(0, 8);
			return {
				q: term,
				characters,
				planets,
				sagas: sagas.map((s) => (Object.assign(s, { series: s.series ?? '' }))),
				movies: movies.map((m) => (Object.assign(m, { series: m.series ?? '' }))),
				games,
				episodes: episodes.map((e) => (Object.assign(e, {
	title: e.title ?? '',
	number_in_series: e.number_in_series ?? 0
}))),
				techniques,
				races,
				transformations: transfoDedup,
				arcs,
				mangaVolumes,
				mangaChapters,
				battles,
				locations,
				tournaments,
				voiceActors,
				soundtracks,
				powerLevels,
				items,
				dragons,
				databooks,
				novels,
				contributors: contributors.map((c) => (Object.assign(c, { id: Number(c.id) }))),
			};
		}),

	rag: async (
		q: string,
		limit = 8,
		options?: {
			lang?: string;
			entity?: string;
			sourceId?: string;
			lexicalOnly?: boolean;
		},
	) => {
		try {
			if (usesAphrodyRag()) {
				return await searchAphrodyRag(q, limit, options);
			}
			let url = `${apiBase()}/api/public/rag/search?q=${encodeURIComponent(q)}&limit=${limit}`;
			if (options?.lang) url += `&lang=${encodeURIComponent(options.lang)}`;
			if (options?.entity) url += `&entity=${encodeURIComponent(options.entity)}`;
			if (options?.sourceId) url += `&sourceId=${encodeURIComponent(options.sourceId)}`;
			if (options?.lexicalOnly) url += `&lexicalOnly=true`;
			const r = await fetch(url, {
				next: { revalidate: 300 },
				signal: AbortSignal.timeout(3000),
			});
			if (!r.ok) return null;
			return (await r.json()) as {
				q: string;
				mode?: string;
				results: {
					rowid?: number;
					kind: string;
					title: string;
					url: string;
					snippet: string;
					score?: number;
				}[];
			};
		} catch {
			return null;
		}
	},

	ragChat: async (q: string, persona = "whis") => {
		try {
			if (usesAphrodyRag()) {
				return await chatAphrodyRag(q, persona);
			}
			const url = `${apiBase()}/api/public/rag/chat?q=${encodeURIComponent(q)}&persona=${encodeURIComponent(persona)}`;
			const r = await fetch(url, {
				cache: "no-store",
				signal: AbortSignal.timeout(3000),
			});
			if (!r.ok) return null;
			return (await r.json()) as {
				answer: string;
				hits: {
					rowid?: number;
					kind: string;
					title: string;
					url: string;
					snippet: string;
					score?: number;
				}[];
				mode: string;
			};
		} catch {
			return null;
		}
	},

	battles: (series?: string) =>
		safe(async () => {
			const conditions = [eq(botBattles.visible, true)];
			if (series) conditions.push(eq(botBattles.series, series));
			const rows = await db
				.select()
				.from(botBattles)
				.where(and(...conditions))
				.orderBy(asc(botBattles.id));
			return rows.map((r) => ({
				id: r.id,
				slug: r.slug,
				title: r.title,
				title_ja: r.titleJa,
				saga_id: r.sagaId,
				arc_id: r.arcId,
				series: r.series,
				combatants: r.combatants,
				winner_id: r.winnerId,
				winner_name: r.winnerName,
				location: r.location,
				manga_volume_start: r.mangaVolumeStart,
				manga_volume_end: r.mangaVolumeEnd,
				manga_chapter_start: r.mangaChapterStart,
				manga_chapter_end: r.mangaChapterEnd,
				episode_start: r.episodeStart,
				episode_end: r.episodeEnd,
				techniques_used: r.techniquesUsed,
				climax_summary: r.climaxSummary,
				canon: r.canon,
				impact_level: r.impactLevel ?? 3,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			}));
		}),

	battleBySlug: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botBattles)
				.where(and(eq(botBattles.slug, slug), eq(botBattles.visible, true)))
				.limit(1);
			if (!r) return null;
			return {
				id: r.id,
				slug: r.slug,
				title: r.title,
				title_ja: r.titleJa,
				saga_id: r.sagaId,
				arc_id: r.arcId,
				series: r.series,
				combatants: r.combatants,
				winner_id: r.winnerId,
				winner_name: r.winnerName,
				location: r.location,
				manga_volume_start: r.mangaVolumeStart,
				manga_volume_end: r.mangaVolumeEnd,
				manga_chapter_start: r.mangaChapterStart,
				manga_chapter_end: r.mangaChapterEnd,
				episode_start: r.episodeStart,
				episode_end: r.episodeEnd,
				techniques_used: r.techniquesUsed,
				climax_summary: r.climaxSummary,
				canon: r.canon,
				impact_level: r.impactLevel ?? 3,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			};
		}),

	timelineEvents: (era?: string) =>
		safe(async () => {
			const conditions = [eq(botTimelineEvents.visible, true)];
			if (era) conditions.push(eq(botTimelineEvents.era, era));
			const rows = await db
				.select()
				.from(botTimelineEvents)
				.where(and(...conditions))
				.orderBy(asc(botTimelineEvents.ageYear), asc(botTimelineEvents.orderIdx));
			return rows.map((r) => ({
				id: r.id,
				age_year: r.ageYear,
				age_month: r.ageMonth,
				age_day: r.ageDay,
				era: r.era,
				title: r.title,
				title_ja: r.titleJa,
				description: r.description,
				characters_involved: r.charactersInvolved,
				source_ref: r.sourceRef,
				canon: r.canon,
				order_idx: r.orderIdx,
			}));
		}),

	powerLevels: (sourceKind?: string) =>
		safe(async () => {
			const conditions = [eq(botPowerLevels.visible, true)];
			if (sourceKind) conditions.push(eq(botPowerLevels.sourceKind, sourceKind));
			const rows = await db
				.select()
				.from(botPowerLevels)
				.where(and(...conditions))
				.orderBy(asc(botPowerLevels.id));
			return rows.map((r) => ({
				id: r.id,
				character_id: r.characterId,
				character_name: r.characterName,
				form: r.form,
				saga_id: r.sagaId,
				saga_name: r.sagaName,
				battle_power: r.battlePower,
				battle_power_display: r.battlePowerDisplay,
				scouter_device: r.scouterDevice,
				source_kind: r.sourceKind,
				source_page: r.sourcePage,
				canon: r.canon,
				notes: r.notes,
			}));
		}),

	items: (category?: string) =>
		safe(async () => {
			const conditions = [eq(botItems.visible, true)];
			if (category) conditions.push(eq(botItems.category, category));
			const rows = await db
				.select()
				.from(botItems)
				.where(and(...conditions))
				.orderBy(asc(botItems.id));
			return rows.map((r) => ({
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				name_romaji: r.nameRomaji,
				category: r.category,
				creator: r.creator,
				description: r.description,
				debut_chapter: r.debutChapter,
				debut_episode: r.debutEpisode,
				image: r.image,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			}));
		}),

	itemBySlug: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botItems)
				.where(and(eq(botItems.slug, slug), eq(botItems.visible, true)))
				.limit(1);
			if (!r) return null;
			return {
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				name_romaji: r.nameRomaji,
				category: r.category,
				creator: r.creator,
				description: r.description,
				debut_chapter: r.debutChapter,
				debut_episode: r.debutEpisode,
				image: r.image,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			};
		}),

	dragons: () =>
		safe(async () => {
			const rows = await db.select().from(botDragons).where(eq(botDragons.visible, true)).orderBy(asc(botDragons.id));
			return rows.map((r) => ({
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				creator: r.creator,
				planet_realm: r.planetRealm,
				balls_count: r.ballsCount,
				balls_diameter: r.ballsDiameter,
				summon_phrase: r.summonPhrase,
				summon_phrase_ja: r.summonPhraseJa,
				wishes_count: r.wishesCount,
				cooldown: r.cooldown,
				rules: r.rules,
				image: r.image,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			}));
		}),

	dragonBySlug: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botDragons)
				.where(and(eq(botDragons.slug, slug), eq(botDragons.visible, true)))
				.limit(1);
			if (!r) return null;
			return {
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				creator: r.creator,
				planet_realm: r.planetRealm,
				balls_count: r.ballsCount,
				balls_diameter: r.ballsDiameter,
				summon_phrase: r.summonPhrase,
				summon_phrase_ja: r.summonPhraseJa,
				wishes_count: r.wishesCount,
				cooldown: r.cooldown,
				rules: r.rules,
				image: r.image,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			};
		}),

	wishes: (dragonId?: number) =>
		safe(async () => {
			const conditions = [eq(botWishes.visible, true)];
			if (dragonId != null) conditions.push(eq(botWishes.dragonId, dragonId));
			const rows = await db
				.select()
				.from(botWishes)
				.where(and(...conditions))
				.orderBy(asc(botWishes.id));
			return rows.map((r) => ({
				id: r.id,
				dragon_id: r.dragonId,
				dragon_name: r.dragonName,
				wish_number_in_summon: r.wishNumberInSummon ?? 1,
				whisperer: r.whisperer,
				saga: r.saga,
				manga_chapter: r.mangaChapter,
				episode_number: r.episodeNumber,
				wish_text: r.wishText,
				granted: r.granted,
				canon: r.canon,
			}));
		}),

	locations: (realmType?: string) =>
		safe(async () => {
			const conditions = [eq(botLocations.visible, true)];
			if (realmType) conditions.push(eq(botLocations.realmType, realmType));
			const rows = await db
				.select()
				.from(botLocations)
				.where(and(...conditions))
				.orderBy(asc(botLocations.id));
			return rows.map((r) => ({
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				name_romaji: r.nameRomaji,
				realm_type: r.realmType,
				planet: r.planet,
				description: r.description,
				debut_chapter: r.debutChapter,
				debut_episode: r.debutEpisode,
				key_events: r.keyEvents ?? null,
				image: r.image,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			}));
		}),

	locationBySlug: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botLocations)
				.where(and(eq(botLocations.slug, slug), eq(botLocations.visible, true)))
				.limit(1);
			if (!r) return null;
			return {
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				name_romaji: r.nameRomaji,
				realm_type: r.realmType,
				planet: r.planet,
				description: r.description,
				debut_chapter: r.debutChapter,
				debut_episode: r.debutEpisode,
				key_events: r.keyEvents ?? null,
				image: r.image,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			};
		}),

	tournaments: (tournamentType?: string) =>
		safe(async () => {
			const conditions = [eq(botTournaments.visible, true)];
			if (tournamentType) conditions.push(eq(botTournaments.tournamentType, tournamentType));
			const rows = await db
				.select()
				.from(botTournaments)
				.where(and(...conditions))
				.orderBy(asc(botTournaments.id));
			return rows.map((r) => ({
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				tournament_type: r.tournamentType,
				saga: r.saga,
				location: r.location,
				winner_name: r.winnerName,
				runner_up_name: r.runnerUpName,
				rules_summary: r.rulesSummary,
				participants_count: r.participantsCount,
				notable_matches: r.notableMatches ?? null,
				canon: r.canon,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			}));
		}),

	tournamentBySlug: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botTournaments)
				.where(and(eq(botTournaments.slug, slug), eq(botTournaments.visible, true)))
				.limit(1);
			if (!r) return null;
			return {
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				tournament_type: r.tournamentType,
				saga: r.saga,
				location: r.location,
				winner_name: r.winnerName,
				runner_up_name: r.runnerUpName,
				rules_summary: r.rulesSummary,
				participants_count: r.participantsCount,
				notable_matches: r.notableMatches ?? null,
				canon: r.canon,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			};
		}),

	voiceActors: (nationality?: "ja" | "fr") =>
		safe(async () => {
			const conditions = [eq(botVoiceActors.visible, true)];
			if (nationality) conditions.push(eq(botVoiceActors.nationality, nationality));
			const rows = await db
				.select()
				.from(botVoiceActors)
				.where(and(...conditions))
				.orderBy(asc(botVoiceActors.id));
			return rows.map((r) => ({
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				nationality: r.nationality,
				birth_date: r.birthDate,
				roles: r.roles,
				biography: r.biography,
				image: r.image,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			}));
		}),

	voiceActorBySlug: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botVoiceActors)
				.where(and(eq(botVoiceActors.slug, slug), eq(botVoiceActors.visible, true)))
				.limit(1);
			if (!r) return null;
			return {
				id: r.id,
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				nationality: r.nationality,
				birth_date: r.birthDate,
				roles: r.roles,
				biography: r.biography,
				image: r.image,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			};
		}),

	soundtracks: (trackType?: string) =>
		safe(async () => {
			const conditions = [eq(botSoundtracks.visible, true)];
			if (trackType) conditions.push(eq(botSoundtracks.trackType, trackType));
			const rows = await db
				.select()
				.from(botSoundtracks)
				.where(and(...conditions))
				.orderBy(asc(botSoundtracks.id));
			return rows.map((r) => ({
				id: r.id,
				slug: r.slug,
				title: r.title,
				title_ja: r.titleJa,
				title_romaji: r.titleRomaji,
				track_type: r.trackType,
				series: r.series,
				artist: r.artist,
				composer: r.composer,
				lyricist: r.lyricist,
				episodes_range: r.episodesRange,
				release_year: r.releaseYear,
				description: r.description,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			}));
		}),

	soundtrackBySlug: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botSoundtracks)
				.where(and(eq(botSoundtracks.slug, slug), eq(botSoundtracks.visible, true)))
				.limit(1);
			if (!r) return null;
			return {
				id: r.id,
				slug: r.slug,
				title: r.title,
				title_ja: r.titleJa,
				title_romaji: r.titleRomaji,
				track_type: r.trackType,
				series: r.series,
				artist: r.artist,
				composer: r.composer,
				lyricist: r.lyricist,
				episodes_range: r.episodesRange,
				release_year: r.releaseYear,
				description: r.description,
				article: r.article ?? null,
				article_sources: r.articleSources ?? null,
			};
		}),

	contributors: (filters?: { category?: string; spotlightOnly?: boolean }) =>
		safe(async () => {
			const conditions = [eq(botContributors.visible, true)];
			if (filters?.category && filters.category !== "all") {
				conditions.push(eq(botContributors.category, filters.category as any));
			}
			if (filters?.spotlightOnly) {
				conditions.push(isNotNull(botContributors.spotlightRank));
			}

			const rows = await db
				.select()
				.from(botContributors)
				.where(and(...conditions))
				.orderBy(asc(botContributors.spotlightRank), asc(botContributors.name));

			return rows.map((r) => ({
				id: Number(r.id),
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				name_romaji: r.nameRomaji,
				category: r.category,
				birth_date: r.birthDate,
				death_date: r.deathDate,
				biography_fr: r.biographyFr,
				spotlight_rank: r.spotlightRank,
			}));
		}),

	contributorBySlug: (slug: string) =>
		safe(async () => {
			const [r] = await db
				.select()
				.from(botContributors)
				.where(and(eq(botContributors.slug, slug), eq(botContributors.visible, true)))
				.limit(1);
			if (!r) return null;

			const credits = await db
				.select()
				.from(botContributorCredits)
				.where(and(eq(botContributorCredits.contributorId, r.id), eq(botContributorCredits.visible, true)));

			return {
				id: Number(r.id),
				slug: r.slug,
				name: r.name,
				name_ja: r.nameJa,
				name_romaji: r.nameRomaji,
				category: r.category,
				birth_date: r.birthDate,
				death_date: r.deathDate,
				biography_fr: r.biographyFr,
				spotlight_rank: r.spotlightRank,
				credits: credits.map((c) => ({
					id: Number(c.id),
					role: c.role,
					credit_scope: c.creditScope,
					work_id: c.workId ? Number(c.workId) : null,
					character_id: c.characterId ? Number(c.characterId) : null,
					episode_id: c.episodeId ? Number(c.episodeId) : null,
					movie_id: c.movieId ? Number(c.movieId) : null,
					game_id: c.gameId ? Number(c.gameId) : null,
					soundtrack_id: c.soundtrackId ? Number(c.soundtrackId) : null,
				})),
			};
		}),

	narrativeTimelines: () =>
		safe(async () => {
			const rows = await db
				.select()
				.from(botNarrativeTimelines)
				.where(eq(botNarrativeTimelines.visible, true))
				.orderBy(asc(botNarrativeTimelines.id));

			const counts = await db
				.select({
					timelineId: botNarrativeEvents.timelineId,
					eventCount: count(),
				})
				.from(botNarrativeEvents)
				.where(eq(botNarrativeEvents.visible, true))
				.groupBy(botNarrativeEvents.timelineId);

			const countMap = new Map(counts.map((c) => [c.timelineId, Number(c.eventCount)]));

			return rows.map((r) => ({
				id: Number(r.id),
				slug: r.slug,
				kind: r.kind,
				label: r.label,
				parent_id: r.parentId ? Number(r.parentId) : null,
				event_count: countMap.get(r.id) ?? 0,
			}));
		}),

	unifiedNarrativeEvents: (filters?: { timelineSlug?: string; kind?: string; canon?: string }) =>
		safe(async () => {
			const conditions = [eq(botNarrativeEvents.visible, true)];
			if (filters?.kind && filters.kind !== "all") {
				conditions.push(eq(botNarrativeEvents.kind, filters.kind as any));
			}

			let query = db
				.select({
					event: botNarrativeEvents,
					timeline: botNarrativeTimelines,
				})
				.from(botNarrativeEvents)
				.innerJoin(botNarrativeTimelines, eq(botNarrativeEvents.timelineId, botNarrativeTimelines.id));

			if (filters?.timelineSlug) {
				conditions.push(eq(botNarrativeTimelines.slug, filters.timelineSlug));
			}

			const rows = await query
				.where(and(...conditions))
				.orderBy(asc(botNarrativeEvents.startOrder), asc(botNarrativeEvents.id));

			return rows.map(({ event: r, timeline: t }) => ({
				id: Number(r.id),
				slug: r.slug,
				kind: r.kind,
				title: r.title,
				title_ja: r.titleJa,
				title_romaji: r.titleRomaji,
				synopsis_fr: r.synopsisFr,
				timeline_slug: t.slug,
				timeline_label: t.label,
				canon: r.canon,
				start_order: r.startOrder ? Number(r.startOrder) : null,
				end_order: r.endOrder ? Number(r.endOrder) : null,
			}));
		}),

	mediaWorks: (filters?: { kind?: string; series?: string; slug?: string }) =>
		safe(async () => {
			const conditions = [eq(botMediaWorks.visible, true)];
			if (filters?.kind) conditions.push(eq(botMediaWorks.kind, filters.kind));
			if (filters?.series) conditions.push(eq(botMediaWorks.series, filters.series));
			if (filters?.slug) conditions.push(eq(botMediaWorks.slug, filters.slug));

			const works = await db
				.select()
				.from(botMediaWorks)
				.where(and(...conditions))
				.orderBy(asc(botMediaWorks.id));

			if (works.length === 0) return [];

			const workIds = works.map((w) => w.id);
			const editions = await db
				.select()
				.from(botMediaEditions)
				.where(and(inArray(botMediaEditions.workId, workIds), eq(botMediaEditions.visible, true)))
				.orderBy(asc(botMediaEditions.id));

			const editionIds = editions.map((e) => e.id);
			const volumeCounts =
				editionIds.length > 0
					? await db
							.select({
								editionId: botMediaVolumes.editionId,
								volCount: count(),
							})
							.from(botMediaVolumes)
							.where(and(inArray(botMediaVolumes.editionId, editionIds), eq(botMediaVolumes.visible, true)))
							.groupBy(botMediaVolumes.editionId)
					: [];

			const countMap = new Map(volumeCounts.map((v) => [v.editionId, Number(v.volCount)]));

			return works.map((w) => ({
				id: Number(w.id),
				slug: w.slug,
				kind: w.kind,
				series: w.series,
				title: w.title,
				title_ja: w.titleJa,
				title_romaji: w.titleRomaji,
				synopsis_fr: w.synopsisFr,
				editions: editions
					.filter((e) => e.workId === w.id)
					.map((e) => ({
						id: Number(e.id),
						edition: e.edition,
						label: e.label,
						language: e.language,
						isbn: e.isbn,
						publisher: e.publisher,
						published_at: e.publishedAt,
						page_color: e.pageColor,
						scan_policy: e.scanPolicy,
						volumes_count: countMap.get(e.id) ?? 0,
					})),
			}));
		}),

	mediaEditions: (filters?: { workSlug?: string; edition?: string }) =>
		safe(async () => {
			const conditions = [eq(botMediaEditions.visible, true)];
			if (filters?.edition) conditions.push(eq(botMediaEditions.edition, filters.edition));

			const rows = await db
				.select({
					edition: botMediaEditions,
					work: botMediaWorks,
				})
				.from(botMediaEditions)
				.innerJoin(botMediaWorks, eq(botMediaEditions.workId, botMediaWorks.id))
				.where(
					and(
						...conditions,
						filters?.workSlug ? eq(botMediaWorks.slug, filters.workSlug) : undefined,
						eq(botMediaWorks.visible, true)
					)
				)
				.orderBy(asc(botMediaEditions.id));

			const editionIds = rows.map((r) => r.edition.id);
			const volumeCounts =
				editionIds.length > 0
					? await db
							.select({
								editionId: botMediaVolumes.editionId,
								volCount: count(),
							})
							.from(botMediaVolumes)
							.where(and(inArray(botMediaVolumes.editionId, editionIds), eq(botMediaVolumes.visible, true)))
							.groupBy(botMediaVolumes.editionId)
					: [];

			const countMap = new Map(volumeCounts.map((v) => [v.editionId, Number(v.volCount)]));

			return rows.map(({ edition: e, work: w }) => ({
				id: Number(e.id),
				work_id: Number(w.id),
				work_slug: w.slug,
				work_title: w.title,
				series: w.series,
				edition: e.edition,
				label: e.label,
				language: e.language,
				isbn: e.isbn,
				publisher: e.publisher,
				published_at: e.publishedAt,
				page_color: e.pageColor,
				scan_policy: e.scanPolicy,
				volumes_count: countMap.get(e.id) ?? 0,
			}));
		}),
};
