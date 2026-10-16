/**
 * Moteur de **championnat / ligue** (type Premier League), distinct d'une coupe
 * à élimination.
 *
 * Cas de référence : **Asytral League** (Inazuma Eleven) —
 *  - phase régulière : round-robin simple (chaque équipe joue chaque autre 1 fois)
 *  - points : 3 (victoire) / 0 (défaite) en temps réglementaire
 *  - « But en Or » (prolongation) : 2 pts au vainqueur, 1 pt au perdant
 *  - classement : Points → Diff maps → Victoires → …
 *  - phase finale optionnelle (play-offs) hors de ce module pur
 */

/** Barème de points configurable. */
export interface LeaguePointsConfig {
	/** Victoire en temps réglementaire (défaut 3). */
	win: number;
	/** Nul (défaut 1 ; Asytral n'en a pas → 0). */
	draw: number;
	/** Défaite réglementaire (défaut 0). */
	loss: number;
	/** Victoire en prolongation / but en or (défaut = win). */
	winOvertime: number;
	/** Défaite en prolongation / but en or (défaut = loss). */
	lossOvertime: number;
}

/** Barème Asytral League (validé sur le sheet officiel 2026). */
export const ASYTRAL_POINTS: Readonly<LeaguePointsConfig> = {
	win: 3,
	draw: 0,
	loss: 0,
	winOvertime: 2,
	lossOvertime: 1,
};

/** Barème football classique (Premier League, etc.). */
export const FOOTBALL_POINTS: Readonly<LeaguePointsConfig> = {
	win: 3,
	draw: 1,
	loss: 0,
	winOvertime: 3,
	lossOvertime: 0,
};

export type { LeagueMatchResult } from "./types";
import type { LeagueMatchResult } from "./types";

/** Ligne de classement. */
export interface LeagueStanding {
	teamId: string;
	rank: number;
	played: number;
	wins: number;
	draws: number;
	losses: number;
	/** Victoires en but en or / OT. */
	winsOt: number;
	/** Défaites en but en or / OT. */
	lossesOt: number;
	/** Points de championnat. */
	points: number;
	/** Différentiel de maps (buts pour − buts contre). */
	mapDiff: number;
	mapsFor: number;
	mapsAgainst: number;
}

/** Fixture générée (pas encore jouée). */
export interface LeagueFixture {
	matchday: number;
	homeId: string;
	awayId: string;
}

/**
 * Génère le calendrier d'un **simple** round-robin (chaque paire une fois)
 * via la méthode du cercle.
 *
 * - Si le nombre d'équipes est impair, un « bye » virtuel est injecté (non
 *   exporté dans les fixtures) : l'équipe face au bye est au repos.
 * - `matchday` est 1-indexé.
 * - Ordre des journées stable pour un même ordre d'entrée de `teamIds`.
 */
export function generateSingleRoundRobin(teamIds: readonly string[]): LeagueFixture[] {
	const teams = [...teamIds];
	if (teams.length < 2) return [];

	const bye = "__BYE__";
	const odd = teams.length % 2 === 1;
	if (odd) teams.push(bye);

	const n = teams.length; // pair
	const rounds = n - 1;
	const half = n / 2;
	const rotation = [...teams];
	const fixtures: LeagueFixture[] = [];

	for (let round = 0; round < rounds; round++) {
		for (let i = 0; i < half; i++) {
			const a = rotation[i]!;
			const b = rotation[n - 1 - i]!;
			if (a === bye || b === bye) continue;
			// Alterne domicile pour équilibrer (journée paire ↔ impair)
			const homeFirst = (round + i) % 2 === 0;
			fixtures.push({
				matchday: round + 1,
				homeId: homeFirst ? a : b,
				awayId: homeFirst ? b : a,
			});
		}
		// Rotation : fixe rotation[0], décale le reste d'un cran
		const fixed = rotation[0]!;
		const rest = rotation.slice(1);
		rest.unshift(rest.pop()!);
		rotation.splice(0, rotation.length, fixed, ...rest);
	}

	return fixtures;
}

/**
 * Double round-robin (aller-retour) : chaque paire joue 2 fois (domicile/extérieur).
 */
export function generateDoubleRoundRobin(teamIds: readonly string[]): LeagueFixture[] {
	const first = generateSingleRoundRobin(teamIds);
	const maxDay = first.reduce((m, f) => Math.max(m, f.matchday), 0);
	const returnLeg = first.map((f) => ({
		matchday: f.matchday + maxDay,
		homeId: f.awayId,
		awayId: f.homeId,
	}));
	return [...first, ...returnLeg];
}

/**
 * Détermine le vainqueur d'un match (null si nul pur non départagé).
 */
export function matchWinnerId(m: LeagueMatchResult): string | null {
	if (m.winnerId === m.homeId || m.winnerId === m.awayId) return m.winnerId!;
	if (m.homeScore > m.awayScore) return m.homeId;
	if (m.awayScore > m.homeScore) return m.awayId;
	return null;
}

/**
 * Head-to-head : +1 si `a` a battu `b`, -1 si `b` a battu `a`, 0 sinon.
 * (Astral League — confrontation directe, après points + diff score.)
 */
export function headToHead(
	aId: string,
	bId: string,
	results: readonly LeagueMatchResult[]
): number {
	for (const m of results) {
		const pair = (m.homeId === aId && m.awayId === bId) || (m.homeId === bId && m.awayId === aId);
		if (!pair) continue;
		const w = matchWinnerId(m);
		if (w === aId) return 1;
		if (w === bId) return -1;
	}
	return 0;
}

/**
 * Calcule le classement à partir des résultats.
 *
 * Tie-breakers **Astral League** (doc officiel) :
 * 1. Points
 * 2. Différence de score (maps pour − maps contre)
 * 3. Head-to-head (confrontation directe, 2 équipes)
 * 4. Maps marqués / victoires / teamId (stables, multi-égalité)
 */
export function computeLeagueTable(
	teamIds: readonly string[],
	results: readonly LeagueMatchResult[],
	config: LeaguePointsConfig = ASYTRAL_POINTS
): LeagueStanding[] {
	const table = new Map<string, LeagueStanding>();
	for (const id of teamIds) {
		table.set(id, emptyStanding(id));
	}

	for (const m of results) {
		if (!table.has(m.homeId)) table.set(m.homeId, emptyStanding(m.homeId));
		if (!table.has(m.awayId)) table.set(m.awayId, emptyStanding(m.awayId));
		const home = table.get(m.homeId)!;
		const away = table.get(m.awayId)!;

		home.played += 1;
		away.played += 1;
		home.mapsFor += m.homeScore;
		home.mapsAgainst += m.awayScore;
		away.mapsFor += m.awayScore;
		away.mapsAgainst += m.homeScore;
		home.mapDiff = home.mapsFor - home.mapsAgainst;
		away.mapDiff = away.mapsFor - away.mapsAgainst;

		const ot = Boolean(m.overtime);
		const w = matchWinnerId(m);

		if (w === m.homeId) {
			applyWin(home, away, ot, config);
		} else if (w === m.awayId) {
			applyWin(away, home, ot, config);
		} else {
			// Nul pur (pas de vainqueur, scores égaux) — hors format Astral (toujours un vainqueur)
			home.draws += 1;
			away.draws += 1;
			home.points += config.draw;
			away.points += config.draw;
		}
	}

	const sorted = [...table.values()].sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.mapDiff !== a.mapDiff) return b.mapDiff - a.mapDiff;
		// Head-to-head (doc : si toujours égalité après diff score)
		const h2h = headToHead(a.teamId, b.teamId, results);
		if (h2h !== 0) return -h2h; // a a battu b → a devant → retour négatif pour sort asc?
		// sort (a,b): return <0 ⇒ a before b. Si a a battu b, h2h=+1 → on veut a before b → return -1 → return -h2h
		if (b.mapsFor !== a.mapsFor) return b.mapsFor - a.mapsFor;
		const aWins = a.wins + a.winsOt;
		const bWins = b.wins + b.winsOt;
		if (bWins !== aWins) return bWins - aWins;
		return a.teamId.localeCompare(b.teamId);
	});

	sorted.forEach((row, i) => {
		row.rank = i + 1;
	});
	return sorted;
}

function emptyStanding(teamId: string): LeagueStanding {
	return {
		teamId,
		rank: 0,
		played: 0,
		wins: 0,
		draws: 0,
		losses: 0,
		winsOt: 0,
		lossesOt: 0,
		points: 0,
		mapDiff: 0,
		mapsFor: 0,
		mapsAgainst: 0,
	};
}

function applyWin(
	winner: LeagueStanding,
	loser: LeagueStanding,
	overtime: boolean,
	config: LeaguePointsConfig
): void {
	if (overtime) {
		winner.winsOt += 1;
		loser.lossesOt += 1;
		winner.points += config.winOvertime;
		loser.points += config.lossOvertime;
	} else {
		winner.wins += 1;
		loser.losses += 1;
		winner.points += config.win;
		loser.points += config.loss;
	}
}

/**
 * Nombre de journées d'un simple round-robin (avec bye si impair).
 */
export function matchdayCount(teamCount: number): number {
	if (teamCount < 2) return 0;
	return teamCount % 2 === 0 ? teamCount - 1 : teamCount;
}

export {
	ASTRAL_FORMAT,
	ASTRAL_LEAGUE_META,
	ASYTRAL_LEAGUE_META,
	ASYTRAL_TEAMS,
	ASYTRAL_REGULAR_RESULTS,
	ASYTRAL_PLAYOFF_RESULTS,
	ASYTRAL_CHAMPION,
} from "./asytral-s1";

export type {
	AstralGameLine,
	AstralDetailedMatch,
	AstralMatchday,
	AstralPlayerStats,
	AstralH2HEntry,
	AstralSeasonDetails,
} from "./details-types";

import type { AstralSeasonDetails } from "./details-types";
import astralS1DetailsJson from "./astral-s1-details.json";

/** Détail sheet S1 : manches joueurs, leaderboard, rosters, matrice H2H. */
export const ASTRAL_S1_DETAILS = astralS1DetailsJson as AstralSeasonDetails;
