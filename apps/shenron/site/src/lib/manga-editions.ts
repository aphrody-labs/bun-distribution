/**
 * manga-editions.ts — Ce qui distingue une édition de manga d'une autre.
 *
 * Client-safe (aucun accès base, aucun `server-only`) : la grille de l'index,
 * la fiche tome et le lecteur s'en servent tous les trois, et deux d'entre eux
 * sont des composants client.
 *
 * DEUX DIMENSIONS, PAS UNE
 * ------------------------
 * Une édition se définit par sa **langue** ET sa **colorisation** : « Dragon
 * Ball en français noir et blanc » et « Dragon Ball en japonais noir et blanc »
 * sont deux éditions distinctes du même chapitre. Ce module ne connaissait que
 * la colorisation — la langue n'existait nulle part dans le code, ce qui rendait
 * impossible d'annoncer, et donc de compléter, un catalogue à quatre versions.
 *
 * L'édition ne se devine pas au TITRE (`/full\s*color|couleur/i`) : un titre est
 * un support fragile pour une décision structurelle — il suffit qu'un chapitre
 * s'appelle « Les couleurs de Boo » pour basculer d'édition. La source de vérité
 * est la SÉRIE, qui règle du même coup la navigation : `dbUniverse.mangaChapter`
 * calcule le précédent/suivant sur `(series, chapter_number)`, donc des chapitres
 * couleur rangés sous `DB` s'intercaleraient dans les tomes noir et blanc.
 * La détection par titre survit en repli pour les quelques chapitres couleur
 * antérieurs, rangés sous `DB`.
 *
 * CE QUI EXISTE CHEZ L'ÉDITEUR N'EST PAS CE QU'ON POSSÈDE
 * ------------------------------------------------------
 * Les deux se mesurent séparément, et les confondre fait courir après des
 * éditions qui n'ont jamais été publiées : *Dragon Ball Super* n'a **pas**
 * d'édition en couleur, ni en français ni en japonais. Réclamer quatre versions
 * pour Super, c'est en réclamer deux qui n'existent pas.
 */

/** Les deux langues du catalogue de lecture. */
export type Langue = "fr" | "ja";

/** Les deux colorisations. Le noir et blanc est l'édition d'origine. */
export type Colorisation = "nb" | "couleur";

/** Une édition, sous une forme utilisable en clé de regroupement et en URL. */
export type CodeEdition = `${Langue}-${Colorisation}`;

export const CODES_EDITION: readonly CodeEdition[] = ["fr-nb", "fr-couleur", "ja-nb", "ja-couleur"];

export function codeEdition(langue: Langue, colorisation: Colorisation): CodeEdition {
	return `${langue}-${colorisation}`;
}

export function decodeEdition(code: string): { langue: Langue; colorisation: Colorisation } | null {
	if (!(CODES_EDITION as readonly string[]).includes(code)) return null;
	const [langue, colorisation] = code.split("-") as [Langue, Colorisation];
	return { langue, colorisation };
}

/** La série réservée à l'édition Full Color française (forum scan-db, 520 chapitres). */
export const SERIE_COULEUR = "DBFC";

/**
 * Le repli par titre a été RETIRÉ, sur mesure : au 2026-09-04, **0 chapitre sur
 * les 665** de `bot.db_manga_chapters` porte « couleur » ou « full color » dans
 * son titre. Il ne protégeait donc plus aucune ligne, et il exposait au faux
 * positif exact que la bascule vers la série visait à supprimer — un chapitre
 * intitulé « Les couleurs de Boo » basculait d'édition.
 */

/**
 * Quelle édition porte quelle série.
 *
 * Les séries japonaises n'existent pas encore en base ; leurs codes sont posés
 * ici pour que l'ingest du jour où ait une place déterminée, plutôt qu'une
 * convention réinventée sur le moment.
 */
export const EDITION_PAR_SERIE: Record<string, { langue: Langue; colorisation: Colorisation }> = {
	DB: { langue: "fr", colorisation: "nb" },
	DBS: { langue: "fr", colorisation: "nb" },
	DBZ: { langue: "fr", colorisation: "nb" },
	[SERIE_COULEUR]: { langue: "fr", colorisation: "couleur" },
	DBJP: { langue: "ja", colorisation: "nb" },
	DBSJP: { langue: "ja", colorisation: "nb" },
	DBFCJP: { langue: "ja", colorisation: "couleur" },
	DBKZ: { langue: "ja", colorisation: "couleur" },
	SOSH: { langue: "ja", colorisation: "couleur" },
	DB_SOSH: { langue: "ja", colorisation: "couleur" },
	DBZ_ANIME_COMICS: { langue: "ja", colorisation: "couleur" },
	DBGT_ANIME_COMICS: { langue: "ja", colorisation: "couleur" },
	DBS_ANIME_COMICS: { langue: "ja", colorisation: "couleur" },
	DB_MOVIES: { langue: "ja", colorisation: "couleur" },
	DB_LIGHT_NOVELS: { langue: "fr", colorisation: "nb" },
	ARALE: { langue: "ja", colorisation: "nb" },
	DB_SD: { langue: "ja", colorisation: "nb" },
	DB_GAIDEN_YAMCHA: { langue: "ja", colorisation: "nb" },
	SDBH_DARK_DEMON_REALM: { langue: "ja", colorisation: "nb" },
	SDBH_UNIVERSE: { langue: "ja", colorisation: "nb" },
	SDBH_BIG_BANG: { langue: "ja", colorisation: "nb" },
	SDBH_ULTRA_GOD: { langue: "ja", colorisation: "nb" },
	SDBH_METEOR: { langue: "ja", colorisation: "nb" },
	SDBH_AVATARS: { langue: "ja", colorisation: "nb" },
};

/** Le minimum qu'il faut connaître d'un chapitre pour trancher son édition. */
export interface ChapitreEdition {
	readonly series: string;
	readonly title?: string | null;
}

/** Vrai si le chapitre relève d'une édition en couleur. La série seule tranche. */
export function estChapitreCouleur(chapitre: ChapitreEdition): boolean {
	return EDITION_PAR_SERIE[chapitre.series]?.colorisation === "couleur";
}

/** La langue d'un chapitre. Le français est le défaut : c'est ce que le site publie. */
export function langueDe(chapitre: ChapitreEdition): Langue {
	return EDITION_PAR_SERIE[chapitre.series]?.langue ?? "fr";
}

/**
 * L'édition d'un chapitre, colorisation seule.
 *
 * Conservée telle quelle : la fiche tome et la grille regroupent par
 * colorisation, la langue n'y ajoute rien tant qu'une seule est publiée.
 */
export type Edition = Colorisation;

export function editionDe(chapitre: ChapitreEdition): Edition {
	return estChapitreCouleur(chapitre) ? "couleur" : "nb";
}

/** L'édition complète d'un chapitre, les deux dimensions. */
export function editionCompleteDe(chapitre: ChapitreEdition): CodeEdition {
	return codeEdition(langueDe(chapitre), editionDe(chapitre));
}

/** Libellés de colorisation, pour les sélecteurs et les intitulés. */
export const LIBELLE_EDITION: Record<Edition, string> = {
	nb: "Noir & blanc",
	couleur: "Couleur",
};

const LIBELLE_LANGUE: Record<Langue, string> = {
	fr: "Français",
	ja: "Japonais",
};

/** Libellé complet d'une édition : « Français · Couleur ». */
export function libelleEdition(code: CodeEdition): string {
	const decode = decodeEdition(code);
	if (!decode) return code;
	return `${LIBELLE_LANGUE[decode.langue]} · ${LIBELLE_EDITION[decode.colorisation]}`;
}

/**
 * Les éditions RÉELLEMENT publiées par l'éditeur, par œuvre.
 *
 * *Dragon Ball* a bien ses quatre versions : l'originale japonaise, sa reprise
 * en couleur (フルカラー版, Shueisha), et les deux équivalents français chez
 * Glénat. *Dragon Ball Super* n'a jamais été colorisé — deux cases sur quatre
 * n'y existent pas, et aucune source ne les fera apparaître.
 */
export const EDITIONS_PUBLIEES: Record<string, readonly CodeEdition[]> = {
	DB: ["fr-nb", "fr-couleur", "ja-nb", "ja-couleur"],
	DBS: ["fr-nb", "ja-nb"],
};

/** Vrai si cette édition de cette œuvre existe chez un éditeur. */
export function editionPubliee(oeuvre: string, code: CodeEdition): boolean {
	return EDITIONS_PUBLIEES[oeuvre]?.includes(code) ?? false;
}

/**
 * La série « d'œuvre » d'un chapitre, éditions confondues.
 *
 * `DBFC` reste du Dragon Ball : partout où l'on raisonne en œuvre (libellé,
 * JSON-LD, fil d'Ariane) et non en édition, c'est cette valeur qu'il faut.
 */
export function serieOeuvre(series: string): string {
	if (
		series === SERIE_COULEUR ||
		series === "DBJP" ||
		series === "DBFCJP" ||
		series === "DBKZ" ||
		series === "SOSH" ||
		series === "DB_SOSH" ||
		series === "DBZ_ANIME_COMICS" ||
		series === "DB_MOVIES"
	) {
		return "DB";
	}
	if (series === "DBSJP") return "DBS";
	if (series === "ARALE") return "ARALE";
	return series;
}

/** Libellé lisible d'une série, éditions comprises. */
export const LIBELLE_SERIE: Record<string, string> = {
	DB: "Dragon Ball",
	DBS: "Dragon Ball Super",
	DBZ: "Dragon Ball Z",
	[SERIE_COULEUR]: "Dragon Ball Full Color",
	DBJP: "Dragon Ball (Édition Japonaise)",
	DBSJP: "ドラゴンボール超",
	DBFCJP: "ドラゴンボール フルカラー",
	DBKZ: "Dragon Ball Kanzenban",
	SOSH: "Dragon Ball Sōshūhen (Digest Edition)",
	DB_SOSH: "Dragon Ball Sōshūhen (Digest Edition)",
	DBZ_ANIME_COMICS: "Dragon Ball Z Anime Comics",
	DBGT_ANIME_COMICS: "Dragon Ball GT Anime Comics",
	DBS_ANIME_COMICS: "Dragon Ball Super Films Anime Comics",
	DB_MOVIES: "Dragon Ball Films Anime Comics",
	DB_LIGHT_NOVELS: "Dragon Ball — Romans & Light Novels",
	ARALE: "Dr. Slump",
	DB_SD: "Dragon Ball SD",
	DB_GAIDEN_YAMCHA: "Dragon Ball Gaiden : That Time I Got Reincarnated as Yamcha",
	SDBH_DARK_DEMON_REALM: "Super Dragon Ball Heroes : Dark Demon Realm Mission!",
	SDBH_UNIVERSE: "Super Dragon Ball Heroes : Universe Mission!!",
	SDBH_BIG_BANG: "Super Dragon Ball Heroes : Big Bang Mission!!!",
	SDBH_ULTRA_GOD: "Super Dragon Ball Heroes : Ultra God Mission!!!!",
	SDBH_METEOR: "Super Dragon Ball Heroes : Meteor Mission!",
	SDBH_AVATARS: "Super Dragon Ball Heroes : Avatars!!",
};

export function libelleSerie(series: string): string {
	return LIBELLE_SERIE[series] ?? series;
}
