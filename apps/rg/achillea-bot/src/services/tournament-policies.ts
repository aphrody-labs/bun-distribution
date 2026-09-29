import { ScoreReportPolicy, StageType } from "@/utils/enums/eventEnums";

/** Bracket formats handled by brackets-manager. */
export const BRACKET_TOURNAMENT_TYPES: readonly StageType[] = [
	StageType.single_elimination,
	StageType.double_elimination,
	StageType.round_robin,
];

/** League format uses the schedule and points flow. */
export const LEAGUE_TOURNAMENT_TYPES: readonly StageType[] = [StageType.league];

export function isSupportedTournamentType(type: StageType): boolean {
	return BRACKET_TOURNAMENT_TYPES.includes(type) || LEAGUE_TOURNAMENT_TYPES.includes(type);
}

export function isLeagueTournamentType(type: StageType): boolean {
	return LEAGUE_TOURNAMENT_TYPES.includes(type);
}

/** Unknown values fall back before reaching the database CHECK constraint. */
export function parseScoreReportPolicy(
	value: unknown,
	fallback: ScoreReportPolicy = ScoreReportPolicy.PLAYERS
): ScoreReportPolicy {
	if (value === ScoreReportPolicy.STAFF_ONLY) return ScoreReportPolicy.STAFF_ONLY;
	if (value === ScoreReportPolicy.PLAYERS) return ScoreReportPolicy.PLAYERS;
	return fallback;
}
