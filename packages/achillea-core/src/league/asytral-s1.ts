/**
 * Astral League (parfois orthographié « Asytral ») — Saison 1.
 *
 * Règlement officiel :
 * https://docs.google.com/document/d/144jD-tQ9Bo63GqufcfsQ5hBukaW6gwBIdjSZARJyDK8
 * Résultats :
 * https://docs.google.com/spreadsheets/d/1wsPYdS0B93Hdkw6E3FOJM08-9M2rzfM62RhjoGHfBEc
 *
 * Structure :
 *  - 8 clans, 6 joueurs / équipe (3 par match)
 *  - Phase 1 : championnat RR simple, rencontres BO3 (les 3 manches jouées) + 4e but en or si 1-1
 *  - Phase 2 : play-offs top 4, double élimination, BO5
 *  - 10 semaines (7 championnat + 3 play-offs)
 *
 * Les scores stockés sont des **manches d'équipe** (ex. 2-1).
 * `overtime: true` = 4e match but en or après BO3 égal.
 */

import type { LeagueMatchResult } from "./types";

/** Règlement format (doc officiel Achillea). */
export const ASTRAL_FORMAT = {
	game: "Inazuma Eleven Victory Road",
	startsAt: "2026-04-03",
	clans: 8,
	playersPerTeam: 6,
	playersPerMatch: 3,
	regularSeries: "bo3_all_games" as const,
	/** Les 3 manches du BO3 sont toujours jouées (même si 2-0). */
	mustPlayAllBo3Games: true,
	/** 4e manche si égalité 1-1 après BO3 ; host = équipe avec 1 seul host sur les 3. */
	overtimeMatch: true,
	/** 0-0 sur le 4e → « Jugement d'Avantage ». */
	advantageJudgment: true,
	points: {
		winRegulation: 3,
		lossRegulation: 0,
		winOvertime: 2,
		lossOvertime: 1,
	},
	tiebreakers: ["map_diff", "head_to_head", "tiebreak_matches"] as const,
	playoffs: {
		teams: 4,
		format: "double_elimination" as const,
		series: "bo5" as const,
		/** 1er choisit entre 3e et 4e. */
		firstPickOpponent: true,
		/** 6e manche si 2-2-1 après BO5 ; joueur n'ayant pas joué 2 fois ; 7e but en or. */
		extraGamesOnDraw: true,
	},
	durationWeeks: 10,
	regularWeeks: 7,
	playoffWeeks: 3,
} as const;

export const ASYTRAL_LEAGUE_META = {
	id: "astral-s1",
	/** Alias historique d'URL / API. */
	aliases: ["asytral-s1", "astral", "asytral"] as const,
	name: "Astral League",
	season: "Saison 1",
	format: "league" as const,
	description:
		"Championnat Inazuma Eleven Victory Road organisé par Achillea après l'Astral Cup Qualifier : " +
		"phase régulière en single round-robin (BO3) puis play-offs double élimination (BO5) pour le top 4.",
	sourceRulesUrl: "https://docs.google.com/document/d/144jD-tQ9Bo63GqufcfsQ5hBukaW6gwBIdjSZARJyDK8",
	sourceSheetUrl:
		"https://docs.google.com/spreadsheets/d/1wsPYdS0B93Hdkw6E3FOJM08-9M2rzfM62RhjoGHfBEc",
	teamCount: 8,
	matchdays: 7,
	playoffTeams: 4,
	formatDetail: ASTRAL_FORMAT,
} as const;

/** Alias orthographe sheet « Asytral ». */
export const ASTRAL_LEAGUE_META = ASYTRAL_LEAGUE_META;

/** Équipes (tags officiels du sheet). */
export const ASYTRAL_TEAMS: ReadonlyArray<{ tag: string; name: string }> = [
	{ tag: "GKO", name: "GKO" },
	{ tag: "OMP", name: "OMP" },
	{ tag: "ASE", name: "ASE" },
	{ tag: "DR", name: "DR" },
	{ tag: "FGS", name: "FGS" },
	{ tag: "LMS", name: "LMS" },
	{ tag: "KOM", name: "KOM" },
	{ tag: "ZOO", name: "ZOO" },
];

/**
 * Résultats phase régulière (onglet « classement » du sheet, lignes de calcul).
 * Ordre ≈ chronologique des journées du sheet « match ».
 */
export const ASYTRAL_REGULAR_RESULTS: readonly LeagueMatchResult[] = [
	// J1 — 10 avril
	{ matchday: 1, homeId: "LMS", awayId: "DR", homeScore: 0, awayScore: 3 },
	{ matchday: 1, homeId: "ZOO", awayId: "GKO", homeScore: 0, awayScore: 3 },
	{ matchday: 1, homeId: "OMP", awayId: "ASE", homeScore: 2, awayScore: 1 },
	// But en or (1-1) : vainqueur via winnerId (sheet Pts T1/T2)
	{
		matchday: 1,
		homeId: "FGS",
		awayId: "KOM",
		homeScore: 1,
		awayScore: 1,
		overtime: true,
		winnerId: "FGS",
	},
	// J2 — 17 avril
	{ matchday: 2, homeId: "FGS", awayId: "OMP", homeScore: 0, awayScore: 2 },
	{ matchday: 2, homeId: "ASE", awayId: "KOM", homeScore: 3, awayScore: 0 },
	{ matchday: 2, homeId: "ZOO", awayId: "LMS", homeScore: 0, awayScore: 3 },
	{ matchday: 2, homeId: "DR", awayId: "GKO", homeScore: 2, awayScore: 1 },
	// J3 — 24 avril
	{
		matchday: 3,
		homeId: "ASE",
		awayId: "FGS",
		homeScore: 1,
		awayScore: 1,
		overtime: true,
		winnerId: "ASE",
	},
	{
		matchday: 3,
		homeId: "LMS",
		awayId: "GKO",
		homeScore: 1,
		awayScore: 1,
		overtime: true,
		winnerId: "GKO",
	},
	{ matchday: 3, homeId: "KOM", awayId: "OMP", homeScore: 0, awayScore: 2 },
	{ matchday: 3, homeId: "DR", awayId: "ZOO", homeScore: 3, awayScore: 0 },
	// J4 — 1 mai
	{ matchday: 4, homeId: "GKO", awayId: "KOM", homeScore: 2, awayScore: 0 },
	{ matchday: 4, homeId: "DR", awayId: "ASE", homeScore: 1, awayScore: 2 },
	{ matchday: 4, homeId: "LMS", awayId: "OMP", homeScore: 2, awayScore: 1 },
	{ matchday: 4, homeId: "ZOO", awayId: "FGS", homeScore: 0, awayScore: 3 },
	// J5 — 8 mai
	{ matchday: 5, homeId: "GKO", awayId: "FGS", homeScore: 3, awayScore: 0 },
	{
		matchday: 5,
		homeId: "ZOO",
		awayId: "KOM",
		homeScore: 1,
		awayScore: 1,
		overtime: true,
		winnerId: "ZOO",
	},
	{ matchday: 5, homeId: "DR", awayId: "OMP", homeScore: 0, awayScore: 2 },
	{ matchday: 5, homeId: "LMS", awayId: "ASE", homeScore: 1, awayScore: 2 },
	// J6 — 15 mai
	{ matchday: 6, homeId: "GKO", awayId: "ASE", homeScore: 2, awayScore: 1 },
	{ matchday: 6, homeId: "OMP", awayId: "ZOO", homeScore: 2, awayScore: 0 },
	{ matchday: 6, homeId: "KOM", awayId: "DR", homeScore: 1, awayScore: 2 },
	{
		matchday: 6,
		homeId: "FGS",
		awayId: "LMS",
		homeScore: 1,
		awayScore: 1,
		overtime: true,
		winnerId: "FGS",
	},
	// J7 — 22 mai
	{ matchday: 7, homeId: "FGS", awayId: "DR", homeScore: 2, awayScore: 1 },
	{ matchday: 7, homeId: "GKO", awayId: "OMP", homeScore: 2, awayScore: 1 },
	{ matchday: 7, homeId: "KOM", awayId: "LMS", homeScore: 3, awayScore: 0 },
	{ matchday: 7, homeId: "ASE", awayId: "ZOO", homeScore: 3, awayScore: 0 },
];

/**
 * Play-offs (onglet « Play-off ») — scores d'équipes uniquement.
 * Structure double-elim allégée d'après le sheet (demi, WB final, LB, grande finale).
 */
export const ASYTRAL_PLAYOFF_RESULTS = [
	// 29 mai — demies
	{
		round: "semi",
		label: "Demi 1",
		homeId: "OMP",
		awayId: "ASE",
		homeScore: 3,
		awayScore: 1,
	},
	{
		round: "semi",
		label: "Demi 2",
		homeId: "GKO",
		awayId: "DR",
		homeScore: 3,
		awayScore: 0,
	},
	// 5 juin — winners final + losers demi
	{
		round: "wb_final",
		label: "Finale winners",
		homeId: "GKO",
		awayId: "OMP",
		homeScore: 3,
		awayScore: 1,
	},
	{
		round: "lb_semi",
		label: "Demi losers",
		homeId: "ASE",
		awayId: "DR",
		homeScore: 3,
		awayScore: 0,
	},
	// 6 juin — losers final (OMP vs ASE)
	{
		round: "lb_final",
		label: "Finale losers",
		homeId: "OMP",
		awayId: "ASE",
		homeScore: 3,
		awayScore: 2,
	},
	// Grande finale GKO vs OMP
	{
		round: "grand_final",
		label: "Grande finale",
		homeId: "GKO",
		awayId: "OMP",
		homeScore: 3,
		awayScore: 0,
	},
] as const;

/** Champion S1 d'après la grande finale du sheet. */
export const ASYTRAL_CHAMPION = "GKO" as const;
