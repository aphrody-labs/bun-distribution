/**
 * frames-map-shared — traduction AniList → série DBFR et lien vers la fiche.
 *
 * Client-safe et pur : le module `frames-map.ts` est `server-only` (il ouvre
 * Postgres) et rendrait ces règles intestables, alors que ce sont elles qui
 * décident si une correspondance concerne Dragon Ball. Même découpage que
 * `ratings` / `ratings-rules`.
 *
 * Le problème résolu, mesuré le 2026-09-12 : sur une capture de Dragon Ball,
 * trace.moe renvoyait « Hayate no Gotoku! 54 % », « ONE PIECE 54 % »,
 * « Yu☆Gi☆Oh! ARC-V 54 % ». Dix correspondances, aucune utile — et la fiche
 * affichait « Confirmé pour cet épisode » sur la seule coïncidence du numéro
 * d'épisode. Un résultat ne vaut identification que s'il se rattache à une
 * fiche du site.
 */

/**
 * AniList → code `db_episodes.series`.
 *
 * Ids stables de l'API AniList (une entrée par diffusion). Kai et ses « Final
 * Chapters » sont deux entrées distinctes chez AniList comme chez nous, d'où
 * deux lignes plutôt qu'une série fourre-tout.
 */
export const ANILIST_TO_SERIES: Readonly<Record<number, string>> = {
	223: "DB",
	813: "DBZ",
	225: "DBGT",
	6033: "DBZ_KAI",
	18617: "DBZ_KAI_FINAL",
	21745: "DBS",
	178025: "DB_DAIMA",
};

/**
 * AniList → id `db_movies`.
 *
 * 26 films, téléfilms et OAV de Dragon Ball référencés dans notre base.
 * Permet d'identifier un film depuis trace.moe même si son titre diffère.
 */
export const ANILIST_TO_MOVIE: Readonly<Record<number, number>> = {
	502: 15, // La Légende de Shenron
	891: 16, // Le Château du démon
	892: 17, // L'Aventure mystique
	893: 18, // L'Armée du Ruban Rouge (Path to Power)
	894: 19, // À la poursuite de Garlic (Dead Zone)
	895: 20, // Le Robot des glaces (World's Strongest)
	896: 21, // Le Combat fratricide (Tree of Might)
	897: 22, // La Menace de Namek (Lord Slug)
	898: 23, // La Revanche de Cooler
	899: 24, // Cent mille guerriers de métal (Return of Cooler)
	900: 25, // L'Offensive des cyborgs (Super Android 13)
	901: 26, // Broly le super guerrier
	902: 27, // Les Mercenaires de l'espace (Bojack Unbound)
	903: 28, // Rivaux dangereux (Broly Second Coming)
	904: 29, // Attaque Super Warrior ! (Bio-Broly)
	905: 30, // Fusions (Fusion Reborn)
	906: 31, // L'Attaque du dragon (Wrath of the Dragon)
	984: 33, // Le Plan d'anéantissement des Saïyens
	985: 32, // L'Histoire de Trunks
	986: 11, // Bardock, The Father of Goku
	5152: 34, // Salut ! Son Gokû et ses amis sont de retour !!
	12231: 35, // Dragon Ball: Episode of Bardock
	14837: 13, // Dragon Ball Z: Battle of Gods
	20778: 14, // Dragon Ball Z: Resurrection 'F'
	101302: 12, // Dragon Ball Super: Broly
	133898: 36, // Dragon Ball Super: Super Hero
};

/** Séries indexées côté site, pour signaler un résultat hors univers. */
export const DBFR_ANILIST_IDS = Object.keys(ANILIST_TO_SERIES).map(Number);

/** AniList IDs des films indexés côté site. */
export const DBFR_MOVIE_ANILIST_IDS = Object.keys(ANILIST_TO_MOVIE).map(Number);

/** Tous les IDs AniList (séries + films) reconnus par le site. */
export const ALL_DBFR_ANILIST_IDS = [...DBFR_ANILIST_IDS, ...DBFR_MOVIE_ANILIST_IDS];

export type SiteEpisodeRef = {
	id: number;
	series: string;
	numberInSeries: number | null;
	title: string | null;
	/** Lien interne horodaté vers la fiche de l'épisode ou du film. */
	href: string;
	/** Vignette ou poster de l'épisode / du film. */
	image?: string | null;
};

/** Correspondance brute renvoyée par `bxc frames search` (local ou trace.moe). */
export type FrameMatchLike = {
	/** Titre stocké : nom trace.moe, code série (`DB`…) ou `movie:<id>` en local. */
	title?: string | null;
	anilist?: number | null;
	episode?: number | null;
	atMs?: number;
};

/** Clé de regroupement `série:numéro` — le couple que trace.moe nous donne. */
export const episodeKey = (series: string, episode: number) => `${series}:${episode}`;

/** Codes série indexés par le crawl local (`bxc frames index --title <code>`). */
const LOCAL_SERIES_CODES: ReadonlySet<string> = new Set(Object.values(ANILIST_TO_SERIES));

/**
 * Variantes et alias minuscules des codes séries vers leur code canonique DBFR.
 * Permet d'accepter les requêtes utilisateur ou locales souples (ex: `db`, `dbz`, `dbs`, `dbkai`, `daima`).
 */
const SERIES_ALIASES: Readonly<Record<string, string>> = {
	db: "DB",
	dragonball: "DB",
	"dragon ball": "DB",
	dbz: "DBZ",
	dragonballz: "DBZ",
	"dragon ball z": "DBZ",
	dbs: "DBS",
	dragonballsuper: "DBS",
	"dragon ball super": "DBS",
	dbgt: "DBGT",
	dragonballgt: "DBGT",
	"dragon ball gt": "DBGT",
	dbkai: "DBZ_KAI",
	dbz_kai: "DBZ_KAI",
	"dbz-kai": "DBZ_KAI",
	kai: "DBZ_KAI",
	dragonballkai: "DBZ_KAI",
	"dragon ball kai": "DBZ_KAI",
	dbz_kai_final: "DBZ_KAI_FINAL",
	"dbz-kai-final": "DBZ_KAI_FINAL",
	daima: "DB_DAIMA",
	db_daima: "DB_DAIMA",
	"db-daima": "DB_DAIMA",
	dragonballdaima: "DB_DAIMA",
	"dragon ball daima": "DB_DAIMA",
};

/**
 * Titre d'un film dans l'index local : `movie:<db_movies.id>`. Le crawl ne peut
 * pas nommer un film par son titre (anime-sama n'en donne aucun) : il l'identifie
 * par trace.moe puis l'enregistre sous son identifiant du site.
 */
const LOCAL_MOVIE_PREFIX = "movie:";

/** Id `db_movies` d'une correspondance locale ou distante de film, `null` sinon. */
export function movieIdForMatch(match: FrameMatchLike): number | null {
	if (match.anilist != null && ANILIST_TO_MOVIE[match.anilist] != null) {
		return ANILIST_TO_MOVIE[match.anilist];
	}
	const t = match.title?.trim() ?? "";
	for (const prefix of [LOCAL_MOVIE_PREFIX, "film:"]) {
		if (t.toLowerCase().startsWith(prefix)) {
			const id = Number(t.slice(prefix.length).trim());
			return Number.isInteger(id) && id > 0 ? id : null;
		}
	}
	return null;
}

/**
 * Série DBFR visée par une correspondance, `undefined` si hors univers ou si c'est un film.
 *
 * Deux provenances : trace.moe désigne la série par son id AniList ; l'index
 * local la désigne par le code série du site, posé en titre au moment du crawl.
 */
export function seriesForMatch(match: FrameMatchLike): string | undefined {
	if (match.anilist != null) return ANILIST_TO_SERIES[match.anilist];
	if (!match.title) return undefined;
	const trimmed = match.title.trim();
	if (LOCAL_SERIES_CODES.has(trimmed)) return trimmed;
	const lower = trimmed.toLowerCase();
	if (SERIES_ALIASES[lower]) return SERIES_ALIASES[lower];
	return undefined;
}

/** Clé d'un film résolu dans la map de `resolveSiteEpisodes`. */
export const movieKey = (id: number) => `${LOCAL_MOVIE_PREFIX}${id}`;

/** Fiche du site pour une correspondance, `null` si hors univers Dragon Ball. */
export function siteRefFor(
	match: FrameMatchLike,
	resolved: Map<string, SiteEpisodeRef>
): SiteEpisodeRef | null {
	const movieId = movieIdForMatch(match);
	const series = movieId == null ? seriesForMatch(match) : undefined;
	const cle =
		movieId != null
			? movieKey(movieId)
			: series && match.episode != null
				? episodeKey(series, match.episode)
				: null;
	if (!cle) return null;
	const ref = resolved.get(cle);
	if (!ref) return null;
	// Timecode transmis en secondes : la fiche épisode ouvre son lecteur dessus.
	const rawSec = (match.atMs ?? 0) / 1000;
	const seconds = Number.isFinite(rawSec) && rawSec > 0 ? Math.floor(rawSec) : 0;
	return { ...ref, href: seconds > 0 ? `${ref.href}?t=${seconds}` : ref.href };
}

/** Une correspondance appartient-elle à l'univers indexé par le site ? */
export function isDragonBallMatch(match: FrameMatchLike): boolean {
	if (movieIdForMatch(match) != null) return true;
	return seriesForMatch(match) !== undefined;
}

/**
 * Formate un timecode en millisecondes vers un format lisible `m:ss` (ou `mm:ss`).
 * Robuste aux valeurs nulles, négatives, non finies ou NaN.
 */
export function formatTimecode(
	ms: number | null | undefined,
	options: { padMinutes?: boolean } = {}
): string {
	if (ms == null || !Number.isFinite(ms) || ms <= 0) {
		return options.padMinutes ? "00:00" : "0:00";
	}
	const totalSec = Math.floor(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	const secStr = String(s).padStart(2, "0");
	const minStr = options.padMinutes ? String(m).padStart(2, "0") : String(m);
	return `${minStr}:${secStr}`;
}

/**
 * Tri prioritaire absolu des résultats de recherche de frames :
 * 1. Correspondances de l'univers Dragon Ball en priorité absolue (écarte le bruit trace.moe).
 * 2. Correspondances rattachées à une fiche du site (/wiki/episodes/<id> ou /wiki/films/<slug>).
 * 3. Similarité décroissante.
 */
export function sortFrameMatches<
	T extends { similarity: number; isDragonBall: boolean; siteEpisode?: SiteEpisodeRef | null },
>(matches: T[]): T[] {
	return [...matches].toSorted(
		(a, b) =>
			Number(b.isDragonBall) - Number(a.isDragonBall) ||
			Number(Boolean(b.siteEpisode)) - Number(Boolean(a.siteEpisode)) ||
			b.similarity - a.similarity
	);
}

/** Taille maximale autorisée pour une frame à analyser (8 Mo). */
export const MAX_FRAME_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImageSniffResult = {
	type: "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif";
	ext: "jpg" | "png" | "webp" | "gif" | "avif";
};

/**
 * Renifle les magic-bytes d'un buffer pour vérifier son vrai format d'image
 * (protège contre les faux Content-Type ou uploads malveillants).
 */
export function sniffImage(b: Uint8Array): ImageSniffResult | null {
	if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
		return { type: "image/png", ext: "png" };
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
		return { type: "image/jpeg", ext: "jpg" };
	if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
		return { type: "image/gif", ext: "gif" };
	if (
		b.length >= 12 &&
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	)
		return { type: "image/webp", ext: "webp" };
	if (
		b.length >= 12 &&
		b[4] === 0x66 &&
		b[5] === 0x74 &&
		b[6] === 0x79 &&
		b[7] === 0x70 &&
		((b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) ||
			(b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x73))
	)
		return { type: "image/avif", ext: "avif" };
	return null;
}

export type FrameImageValidationResult =
	| { ok: true; buffer: Uint8Array; mime: string; ext: "jpg" | "png" | "webp" | "gif" | "avif" }
	| { ok: false; error: string; status: number };

/**
 * Valide l'intégrité, le poids et le format d'une image soumise à la recherche.
 */
export function validateFrameImage(
	raw: Uint8Array | ArrayBuffer | null | undefined
): FrameImageValidationResult {
	if (!raw) {
		return {
			ok: false,
			error: "Veuillez fournir une image valide (fichier ou URL).",
			status: 400,
		};
	}
	const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
	if (u8.byteLength === 0) {
		return {
			ok: false,
			error: "Veuillez fournir une image valide (fichier ou URL).",
			status: 400,
		};
	}
	if (u8.byteLength > MAX_FRAME_IMAGE_BYTES) {
		return {
			ok: false,
			error: "L'image dépasse la taille maximale autorisée (8 Mo).",
			status: 400,
		};
	}
	const sniffed = sniffImage(u8);
	if (!sniffed) {
		return {
			ok: false,
			error: "Format d'image non supporté. Formats acceptés : JPEG, PNG, WebP, GIF, AVIF.",
			status: 400,
		};
	}
	return { ok: true, buffer: u8, mime: sniffed.type, ext: sniffed.ext };
}
