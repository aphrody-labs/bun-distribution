// Best-of des sagas — curation éditoriale **client-safe** de la section
// « bestof » de la home (sélecteur de sagas façon écran d'arc d'un jeu DBZ).
//
// Comme `home-scenes.ts` (scènes curées à la main), ce module fige des FAITS
// CANON stables — bornes d'épisodes et de tomes par saga dans la numérotation
// officielle — pas des comptages DB (qui, eux, restent calculés côté serveur
// depuis le Postgres `bot.*`, cf. `home-bestof-data.ts`). Zéro import
// server-only : types + constantes consommés par le RSC (assemblage des
// view-models) ET par le composant client `SagaBestOf`.
import { ERA_ACCENT, type Era } from "@/lib/home-scenes";

/** Libellés/années des séries — dupliqués de `wiki/episodes/_shared.ts` qui est
 *  server-only (il importe dbUniverse) et ne peut donc pas être importé ici. */
export const BESTOF_SERIES_LABELS: Record<string, string> = {
	DB: "Dragon Ball",
	DBZ: "Dragon Ball Z",
	DBGT: "Dragon Ball GT",
	DBS: "Dragon Ball Super",
	DB_DAIMA: "Dragon Ball Daima",
};

export const BESTOF_SERIES_YEARS: Record<string, string> = {
	DB: "1986–1989",
	DBZ: "1989–1996",
	DBGT: "1996–1997",
	DBS: "2015–2018",
	DB_DAIMA: "2024–2025",
};

/** Une carte du rail média (épisode, film ou tome) — liens 100 % routes
 *  publiques bêta (/wiki/episodes, /wiki/films, /wiki/manga). */
export interface BestOfMediaItem {
	kind: "episode" | "film" | "tome";
	href: string;
	/** URL absolue (déjà passée par assetUrl côté serveur). */
	image: string;
	label: string;
	/** Sur-titre court de la carte (« Épisode 32 », « Film · 1993 », « Tome 21 »). */
	badge: string;
}

/** View-model d'une saga, assemblé côté serveur (SSR) et rendu côté client. */
export interface BestOfSagaView {
	slug: string;
	name: string;
	seriesLabel: string;
	years: string | null;
	tagline: string;
	description: string | null;
	/** URL absolue de l'artwork de la saga (assetUrl appliqué serveur). */
	image: string;
	era: Era;
	accent: string;
	/** Comptages réels (lignes effectivement présentes en DB, pas les bornes). */
	stats: { episodes: number; films: number; tomes: number };
	/** CTA principal (1er épisode de la saga, sinon le film, sinon la série). */
	watchHref: string;
	watchLabel: string;
	media: BestOfMediaItem[];
}

/** Curation d'une saga : bornes canon + films associés + ton. */
export interface BestOfCuration {
	slug: string;
	era: Era;
	/** Punchline courte façon écran de sélection de jeu. */
	tagline: string;
	/** Bornes d'épisodes dans la numérotation officielle de la série. */
	episodes?: { series: string; from: number; to: number };
	/** Bornes de tomes (numérotation Glénat/Shueisha) dans le manga. */
	tomes?: { series: string; from: number; to: number };
	/** Slugs `bot.db_movies` des films/téléfilms liés à l'arc. */
	movieSlugs?: string[];
}

/**
 * Les sagas mises en avant, dans l'ordre du voyage chronologique. Les bornes
 * épisodes/tomes sont des faits canon stables (elles ne bougent jamais) ; tout
 * le contenu affiché (titres, images, descriptions, comptages) vient de la DB.
 */
export const BESTOF_CURATION: readonly BestOfCuration[] = [
	{
		slug: "pilaf",
		era: "origin",
		tagline: "Là où tout commence : sept boules, un vœu.",
		episodes: { series: "DB", from: 1, to: 13 },
		tomes: { series: "DB", from: 1, to: 2 },
		movieSlugs: ["curse-blood-rubies"],
	},
	{
		slug: "red-ribbon",
		era: "origin",
		tagline: "Un enfant seul contre une armée entière.",
		episodes: { series: "DB", from: 29, to: 68 },
		tomes: { series: "DB", from: 5, to: 8 },
		movieSlugs: ["mystical-adventure", "path-to-power"],
	},
	{
		slug: "piccolo-daimao",
		era: "origin",
		tagline: "Le premier démon, la première vraie peur.",
		episodes: { series: "DB", from: 102, to: 132 },
		tomes: { series: "DB", from: 12, to: 14 },
	},
	{
		slug: "tournament-23",
		era: "origin",
		tagline: "Goku vs Piccolo Jr. — la fin du commencement.",
		episodes: { series: "DB", from: 133, to: 153 },
		tomes: { series: "DB", from: 15, to: 17 },
	},
	{
		slug: "saiyan",
		era: "saiyan",
		tagline: "Deux Saiyans arrivent. La Terre ne sera plus jamais la même.",
		episodes: { series: "DBZ", from: 1, to: 35 },
		tomes: { series: "DB", from: 17, to: 21 },
		movieSlugs: ["dragon-ball-z-special-1-tatta-hitori-no-saishuu-kessen", "tree-of-might"],
	},
	{
		slug: "namek",
		era: "namek",
		tagline: "L'empereur de l'univers face au légendaire Super Saiyan.",
		episodes: { series: "DBZ", from: 36, to: 107 },
		tomes: { series: "DB", from: 21, to: 28 },
		movieSlugs: ["coolers-revenge", "lord-slug"],
	},
	{
		slug: "androids",
		era: "android",
		tagline: "Le futur envoie un avertissement : les cyborgs arrivent.",
		episodes: { series: "DBZ", from: 126, to: 139 },
		tomes: { series: "DB", from: 29, to: 31 },
		movieSlugs: ["history-of-trunks", "super-android-13"],
	},
	{
		slug: "cell",
		era: "android",
		tagline: "L'être parfait organise son propre tournoi de l'apocalypse.",
		episodes: { series: "DBZ", from: 140, to: 194 },
		tomes: { series: "DB", from: 31, to: 35 },
		movieSlugs: ["broly-legendary-ssj", "bojack-unbound"],
	},
	{
		slug: "buu",
		era: "buu",
		tagline: "La terreur née de la magie — et l'ultime Genkidama.",
		episodes: { series: "DBZ", from: 220, to: 291 },
		tomes: { series: "DB", from: 36, to: 42 },
		movieSlugs: ["fusion-reborn", "wrath-of-dragon"],
	},
	{
		slug: "gt-baby",
		era: "android",
		tagline: "La vengeance des Tuffles s'empare du prince des Saiyans.",
		episodes: { series: "DBGT", from: 17, to: 40 },
	},
	{
		slug: "gt-shadow-dragons",
		era: "divine",
		tagline: "Les vœux ont un prix : les dragons maléfiques se réveillent.",
		episodes: { series: "DBGT", from: 48, to: 64 },
	},
	{
		slug: "god",
		era: "divine",
		tagline: "Un dieu de la destruction se réveille — et s'ennuie.",
		episodes: { series: "DBS", from: 1, to: 14 },
		tomes: { series: "DBS", from: 1, to: 1 },
		movieSlugs: ["dragon-ball-z-movie-14-kami-to-kami"],
	},
	{
		slug: "golden-frieza",
		era: "divine",
		tagline: "Le tyran s'entraîne pour la première fois de sa vie.",
		episodes: { series: "DBS", from: 15, to: 27 },
		movieSlugs: ["dragon-ball-z-movie-15-fukkatsu-no-f"],
	},
	{
		slug: "future-trunks",
		era: "divine",
		tagline: "Un dieu a volé le corps de Goku — et raye les mortels.",
		episodes: { series: "DBS", from: 47, to: 76 },
		tomes: { series: "DBS", from: 2, to: 5 },
		movieSlugs: ["history-of-trunks"],
	},
	{
		slug: "tournament-of-power",
		era: "divine",
		tagline: "80 guerriers, 8 univers, une seule règle : survivre.",
		episodes: { series: "DBS", from: 77, to: 131 },
		tomes: { series: "DBS", from: 6, to: 9 },
	},
	{
		slug: "broly",
		era: "saiyan",
		tagline: "Le Saiyan légendaire existe — et il est incontrôlable.",
		movieSlugs: ["dragon-ball-super-broly"],
	},
	{
		slug: "super-hero",
		era: "android",
		tagline: "L'heure de Gohan et Piccolo face au Red Ribbon ressuscité.",
		movieSlugs: ["dragon-ball-super-super-hero"],
	},
	{
		slug: "daima",
		era: "buu",
		tagline: "Miniaturisés, direction le monde des démons.",
		episodes: { series: "DB_DAIMA", from: 1, to: 20 },
	},
];

/** Accent OKLCH d'une curation (dérivé de l'ère, comme les scènes). */
export const bestofAccent = (era: Era): string => ERA_ACCENT[era];

/** Nombre d'épisodes échantillonnés par saga dans le rail média. */
export const BESTOF_EPISODES_PER_SAGA = 5;
/** Nombre max de tomes affichés par saga dans le rail média. */
export const BESTOF_TOMES_PER_SAGA = 4;
