/**
 * Top 3 communautaires basés sur le système de notes (1–5 ★).
 * Client-safe : catalogue des classements + types de view-model.
 * Les requêtes Postgres vivent dans `community-tops-data.ts` (server-only).
 */

export const COMMUNITY_TOP_LIMIT = 3;

/** Confiance bayésienne : lisse les moyennes avec peu de votes. */
const COMMUNITY_TOP_PRIOR_VOTES = 2;
const COMMUNITY_TOP_PRIOR_MEAN = 3.5;

export type CommunityTopKind = "episode" | "movie" | "game" | "arc";

type CommunityTopBoardId =
	| "episodes-db"
	| "episodes-dbz"
	| "episodes-dbs"
	| "episodes-gt"
	| "episodes-daima"
	| "episodes-kai"
	| "arcs"
	| "games"
	| "movies";

export type CommunityTopBoardDef = {
	id: CommunityTopBoardId;
	/** Libellé court (tabs). */
	label: string;
	/** Titre complet (podium). */
	title: string;
	/** Sous-titre d'incitation. */
	teaser: string;
	kind: CommunityTopKind;
	/** Codes `db_episodes.series` (vide = tous / N/A pour game-movie-arc). */
	series: readonly string[];
	/** Lien « voir tout / noter ». */
	browseHref: string;
	/** Accent CSS (oklch ou token). */
	accent: string;
	/** Kanji décoratif. */
	kanji: string;
};

/**
 * Classements communautaires — ordre d'affichage fixe.
 * Kai = DBZ_KAI + DBZ_KAI_FINAL (The Final Chapters).
 * DB classique en tête : la saga originelle n'était pas dans la 1ʳᵉ vague Omar.
 */
export const COMMUNITY_TOP_BOARDS: readonly CommunityTopBoardDef[] = [
	{
		id: "episodes-db",
		label: "DB",
		title: "Top 3 épisodes — Dragon Ball",
		teaser: "Tournois, Pilaf, Piccolo… le classic qui a tout lancé.",
		kind: "episode",
		series: ["DB"],
		browseHref: "/wiki/episodes/serie/DB",
		accent: "oklch(0.78 0.17 65)",
		kanji: "球",
	},
	{
		id: "episodes-dbz",
		label: "DBZ",
		title: "Top 3 épisodes — Dragon Ball Z",
		teaser: "Note tes combats préférés pour les propulser sur le podium.",
		kind: "episode",
		series: ["DBZ"],
		browseHref: "/wiki/episodes/serie/DBZ",
		accent: "oklch(0.72 0.2 35)",
		kanji: "Z",
	},
	{
		id: "episodes-dbs",
		label: "DBS",
		title: "Top 3 épisodes — Dragon Ball Super",
		teaser: "Tournoi du Pouvoir, Goku Black, Broly… qui gagne le vote ?",
		kind: "episode",
		series: ["DBS"],
		browseHref: "/wiki/episodes/serie/DBS",
		accent: "oklch(0.75 0.17 300)",
		kanji: "超",
	},
	{
		id: "episodes-gt",
		label: "GT",
		title: "Top 3 épisodes — Dragon Ball GT",
		teaser: "Baby, Super 17, dragons maléfiques — le ranking de la communauté.",
		kind: "episode",
		series: ["DBGT"],
		browseHref: "/wiki/episodes/serie/DBGT",
		accent: "oklch(0.7 0.18 145)",
		kanji: "GT",
	},
	{
		id: "episodes-daima",
		label: "Daima",
		title: "Top 3 épisodes — Dragon Ball Daima",
		teaser: "La nouvelle aventure — fais monter ton épisode préféré.",
		kind: "episode",
		series: ["DB_DAIMA"],
		browseHref: "/wiki/episodes/serie/DB_DAIMA",
		accent: "oklch(0.78 0.17 65)",
		kanji: "大",
	},
	{
		id: "episodes-kai",
		label: "Kai",
		title: "Top 3 épisodes — Dragon Ball Z Kai",
		teaser: "La version remasterisée — vote pour les arcs qui claquent.",
		kind: "episode",
		series: ["DBZ_KAI", "DBZ_KAI_FINAL"],
		browseHref: "/wiki/episodes/serie/DBZ_KAI",
		accent: "oklch(0.72 0.16 250)",
		kanji: "改",
	},
	{
		id: "arcs",
		label: "Arcs",
		title: "Top 3 arcs narratifs",
		teaser: "Namek, Cell, Boo… les arcs les mieux notés de la communauté.",
		kind: "arc",
		series: [],
		browseHref: "/wiki/sagas",
		accent: "oklch(0.72 0.18 25)",
		kanji: "弧",
	},
	{
		id: "games",
		label: "Jeux",
		title: "Top 3 jeux vidéo",
		teaser: "Sparking ZERO, Kakarot, FighterZ… le podium des joueurs DBFR.",
		kind: "game",
		series: [],
		browseHref: "/wiki/jeux",
		accent: "oklch(0.8 0.18 150)",
		kanji: "遊",
	},
	{
		id: "movies",
		label: "Films",
		title: "Top 3 films",
		teaser: "Broly, Super Hero, La Résurrection de F — note les longs-métrages.",
		kind: "movie",
		series: [],
		browseHref: "/wiki/films",
		accent: "oklch(0.7 0.22 350)",
		kanji: "映",
	},
] as const;

export type CommunityTopEntry = {
	rank: 1 | 2 | 3;
	id: string;
	title: string;
	subtitle: string | null;
	image: string | null;
	href: string;
	average: number;
	count: number;
	/** Score bayésien utilisé pour le tri (exposé pour debug/tests). */
	bayes: number;
};

export type CommunityTopBoard = {
	def: CommunityTopBoardDef;
	entries: CommunityTopEntry[];
	/** Total de notes dans ce board (tous les items notés, pas seulement top 3). */
	totalVotes: number;
	/** Nombre d'items ayant au moins 1 note. */
	ratedCount: number;
};

export type CommunityTopsPayload = {
	boards: CommunityTopBoard[];
	/** Notes totales sur le site (tous types confondus dans les boards). */
	globalVotes: number;
	generatedAt: string;
};

/** Badge podium pour une fiche (serveur). */
export type CommunityRankInfo = {
	rank: 1 | 2 | 3;
	boardId: CommunityTopBoardId;
	boardLabel: string;
	boardTitle: string;
	average: number;
	count: number;
	href: string;
};

/** Score bayésien : (v·R + C·m) / (v + C). */
export function bayesianScore(
	average: number,
	count: number,
	priorMean = COMMUNITY_TOP_PRIOR_MEAN,
	priorVotes = COMMUNITY_TOP_PRIOR_VOTES
): number {
	if (count <= 0) return 0;
	return (count * average + priorVotes * priorMean) / (count + priorVotes);
}

export function boardById(id: string): CommunityTopBoardDef | undefined {
	return COMMUNITY_TOP_BOARDS.find((b) => b.id === id);
}

/** Médaille visuelle selon le rang. */
export function rankMedal(rank: 1 | 2 | 3): { emoji: string; label: string; className: string } {
	if (rank === 1) {
		return {
			emoji: "🥇",
			label: "#1",
			className: "border-amber-400/50 bg-amber-400/15 text-amber-200",
		};
	}
	if (rank === 2) {
		return {
			emoji: "🥈",
			label: "#2",
			className: "border-slate-300/40 bg-slate-300/10 text-slate-200",
		};
	}
	return {
		emoji: "🥉",
		label: "#3",
		className: "border-orange-400/40 bg-orange-400/10 text-orange-300",
	};
}
