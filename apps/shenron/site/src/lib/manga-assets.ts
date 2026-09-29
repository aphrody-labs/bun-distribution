/**
 * Règles de publication des médias manga.
 *
 * Toute planche indexée et crawlée dans le catalogue est publiable. Une URL
 * présente en base est donc conservée : le lecteur doit refléter le corpus
 * effectivement acquis, quelle que soit la série dont elle provient.
 */

/**
 * Inventaire vérifié du miroir `assets/manga/DB/regular`.
 *
 * Les 42 lignes `DB` de PostgreSQL ont été réimportées depuis la collection
 * DragonBallCN `full_color` et pointent donc aujourd'hui vers 8 196 URL
 * interdites au hotlink. Le bot possède pourtant bien l'édition régulière :
 * 7 965 fichiers WebP, numérotés sans trou à partir de `001.webp` dans chaque
 * tome. Ce tableau permet au site de publier ce miroir disponible sans faire
 * dépendre son lecteur des URL distantes cassées.
 */
const DRAGON_BALL_REGULAR_PAGE_COUNTS: readonly number[] = [
	221, 204, 217, 220, 187, 188, 172, 172, 188, 170, 172, 187, 186, 187, 187, 187, 187, 188, 187,
	202, 203, 202, 187, 187, 184, 185, 187, 190, 187, 178, 173, 187, 176, 173, 180, 198, 171, 193,
	175, 175, 228, 237,
];

/**
 * Inventaire vérifié du miroir `assets/manga/DBFC` (520 chapitres, ch0 à ch519).
 * Couvre l'intégralité des 7 954 planches Dragon Ball Full Color.
 */
const DRAGON_BALL_FULL_COLOR_PAGE_COUNTS: readonly number[] = [
	19, 33, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 17, 15, 15, 15, 15, 14, 16, 15, 14, 15, 15, 15,
	15, 20, 17, 15, 15, 15, 15, 14, 16, 15, 14, 15, 15, 15, 15, 21, 17, 15, 15, 17, 15, 15, 15, 16, 15,
	15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 16, 15, 15, 15, 15,
	15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15,
	20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 16, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 14, 15, 19, 17,
	15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 16, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15,
	15, 15, 15, 14, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15,
	15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15,
	15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 21, 17, 15, 15, 15, 15, 15,
	15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 16, 15, 15,
	15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15,
	15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15,
	15, 13, 15, 15, 15, 19, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 13, 22, 17, 15, 15, 15, 15, 17, 15,
	15, 15, 13, 15, 20, 17, 19, 15, 15, 15, 15, 15, 14, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15,
	15, 15, 15, 20, 18, 20, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 16, 15, 15, 15,
	20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15, 15, 15, 15, 15, 15, 15, 15, 20, 17, 15,
	15, 13, 15, 15, 18, 15, 15, 15, 20, 17, 15, 14, 15, 13, 15, 13, 13, 15, 15, 15, 20, 17, 15, 13, 15,
	13, 15, 15, 15, 15, 15, 15, 15, 20, 15, 13, 15, 13, 15, 13, 13, 13, 13, 15, 13, 20, 15, 13, 13, 15,
	13, 13, 13, 15, 13, 13, 13, 13, 13, 18, 15, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 18, 15, 13,
	13, 13, 13, 13, 13, 13, 13, 12, 13, 13, 18, 15, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13,
	13, 13, 18, 15, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 15, 13, 13, 25,
];

/**
 * Inventaire vérifié du miroir `assets/manga/DBS` (103 chapitres, ch1 à ch103).
 * Couvre l'intégralité des 4 355 planches Dragon Ball Super.
 */
const DRAGON_BALL_SUPER_PAGE_COUNTS: readonly number[] = [
	16, 16, 16, 23, 24, 20, 22, 23, 27, 26, 21, 29, 40, 41, 40, 41, 26, 41, 40, 40, 46, 46, 46, 46, 46,
	45, 46, 45, 46, 46, 46, 46, 44, 46, 45, 45, 46, 46, 46, 47, 46, 45, 46, 45, 46, 46, 46, 46, 46, 46,
	46, 46, 46, 49, 47, 45, 44, 46, 46, 46, 46, 46, 46, 46, 45, 44, 46, 46, 46, 46, 46, 46, 46, 46, 46,
	46, 46, 46, 46, 45, 45, 44, 45, 44, 45, 45, 46, 55, 46, 46, 37, 45, 46, 45, 44, 45, 44, 45, 43, 42,
	46, 45, 45,
];

const DRAGONBALLCN_COVER_COLLECTION: Readonly<Record<string, string>> = {
	DBJP: "dragonball_jp_original",
	DBFCJP: "dragonball_full_color",
	DBKZ: "dragonball_jp_kanzenban",
	DBZ_ANIME_COMICS: "dragonball_anime_z",
	DB_MOVIES: "dragonball_anime_movie",
	ARALE: "arale_cn",
};

/** Vrai quand la ressource peut être rendue par le lecteur public. */
export function isReadableMangaPage(path: string | null | undefined): path is string {
	const value = path?.trim();
	if (!value) return false;
	if (!/^https?:\/\//i.test(value)) return true;

	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

/** Retire seulement les références absentes ou malformées. */
export function readableMangaPages(pages: unknown): string[] {
	if (typeof pages === "string") {
		try {
			const parsed = JSON.parse(pages);
			if (Array.isArray(parsed)) return parsed.filter(isReadableMangaPage);
		} catch {
			return [];
		}
	}
	return Array.isArray(pages) ? pages.filter(isReadableMangaPage) : [];
}

function localDragonBallPageCount(volumeNumber: number): number {
	if (!Number.isSafeInteger(volumeNumber) || volumeNumber <= 0) return 0;
	return DRAGON_BALL_REGULAR_PAGE_COUNTS[volumeNumber - 1] ?? 0;
}

function localDbfcPageCount(chapterNumber: number): number {
	if (
		!Number.isSafeInteger(chapterNumber) ||
		chapterNumber < 0 ||
		chapterNumber >= DRAGON_BALL_FULL_COLOR_PAGE_COUNTS.length
	) {
		return 0;
	}
	return DRAGON_BALL_FULL_COLOR_PAGE_COUNTS[chapterNumber] ?? 0;
}

function localDbsPageCount(chapterNumber: number): number {
	if (
		Number.isSafeInteger(chapterNumber) &&
		chapterNumber >= 1 &&
		chapterNumber <= DRAGON_BALL_SUPER_PAGE_COUNTS.length
	) {
		return DRAGON_BALL_SUPER_PAGE_COUNTS[chapterNumber - 1] ?? 0;
	}
	if (
		Number.isSafeInteger(chapterNumber) &&
		chapterNumber >= 1315 &&
		chapterNumber <= 1314 + DRAGON_BALL_SUPER_PAGE_COUNTS.length
	) {
		return DRAGON_BALL_SUPER_PAGE_COUNTS[chapterNumber - 1315] ?? 0;
	}
	return 0;
}

/**
 * Pages réellement publiables d'un chapitre.
 *
 * On conserve toute source lisible présente en base (DB, DBFC, DBS, etc.).
 * Pour les séries disposant d'un miroir local complet (DB régulier, DBFC Full Color,
 * DBS Super), le miroir local prend le relais de manière déterministe seulement
 * lorsque la base ne contient aucune planche.
 */
export function publishedMangaPages(
	series: string,
	chapterNumber: number,
	pages: unknown,
	limit = Number.POSITIVE_INFINITY
): string[] {
	const readable = readableMangaPages(pages);
	if (readable.length > 0) return readable.slice(0, Math.max(0, limit));

	if (series === "DB") {
		const count = Math.min(localDragonBallPageCount(chapterNumber), Math.max(0, limit));
		return Array.from(
			{ length: count },
			(_, index) =>
				`./assets/manga/DB/regular/vol${chapterNumber}/${String(index + 1).padStart(3, "0")}.webp`
		);
	}

	if (series === "DBFC") {
		const count = Math.min(localDbfcPageCount(chapterNumber), Math.max(0, limit));
		return Array.from(
			{ length: count },
			(_, index) =>
				`./assets/manga/DBFC/ch${chapterNumber}/${String(index + 1).padStart(3, "0")}.jpg`
		);
	}

	if (series === "DBS") {
		const count = Math.min(localDbsPageCount(chapterNumber), Math.max(0, limit));
		const dirNum = chapterNumber >= 1315 ? chapterNumber : 1314 + chapterNumber;
		return Array.from(
			{ length: count },
			(_, index) =>
				`./assets/manga/DBS/ch${dirNum}/${String(index + 1).padStart(3, "0")}.webp`
		);
	}

	return [];
}

/** Compte cohérent avec `publishedMangaPages`, y compris pour un aperçu SQL. */
export function publishedMangaPageCount(
	series: string,
	chapterNumber: number,
	sampledPages: unknown,
	sourcePageCount: number
): number {
	if (readableMangaPages(sampledPages).length > 0) {
		return Math.max(0, sourcePageCount);
	}
	if (series === "DB") return localDragonBallPageCount(chapterNumber);
	if (series === "DBFC") return localDbfcPageCount(chapterNumber);
	if (series === "DBS") return localDbsPageCount(chapterNumber);
	return 0;
}

/**
 * Résout une adresse de planche. Tant que l'adresse est dans 1..N, elle désigne
 * sans ambiguïté le rang de lecture ; le numéro imprimé est un repli historique
 * réservé aux valeurs situées hors de cette plage.
 */
export function resolveMangaPage<T extends { index: number; planche: number }>(
	pages: readonly T[],
	address: number
): T | undefined {
	return pages[address - 1] ?? pages.find((page) => page.planche === address);
}

/**
 * Couverture locale du miroir bibliographique, quand cette édition en possède
 * une. On évite ainsi que les fiches dépendent du hotlink de la source.
 */
export function mangaCoverPath(
	series: string,
	volumeNumber: number,
	fallback: string | null | undefined
): string | null {
	const collection = DRAGONBALLCN_COVER_COLLECTION[series];
	if (!collection || !Number.isSafeInteger(volumeNumber) || volumeNumber <= 0) {
		return fallback?.trim() || null;
	}
	return `./assets/dragonballcn/${collection}/${String(volumeNumber).padStart(3, "0")}.webp`;
}
