import {
	ASTRAL_FORMAT,
	ASTRAL_S1_DETAILS,
	ASYTRAL_CHAMPION,
	ASYTRAL_LEAGUE_META,
	ASYTRAL_PLAYOFF_RESULTS,
	ASYTRAL_POINTS,
	ASYTRAL_REGULAR_RESULTS,
	ASYTRAL_TEAMS,
	computeLeagueTable,
	generateSingleRoundRobin,
} from "@rosegriffon/achillea-core";

export abstract class LeagueService {
	static getAstralSeason() {
		const teamIds = ASYTRAL_TEAMS.map((team) => team.tag);
		return {
			meta: { ...ASYTRAL_LEAGUE_META, champion: ASYTRAL_CHAMPION, aliases: [...ASYTRAL_LEAGUE_META.aliases] },
			format: ASTRAL_FORMAT,
			teams: ASYTRAL_TEAMS.map((team) => ({ ...team })),
			pointsConfig: { ...ASYTRAL_POINTS },
			standings: [...computeLeagueTable(teamIds, ASYTRAL_REGULAR_RESULTS, ASYTRAL_POINTS)],
			results: [...ASYTRAL_REGULAR_RESULTS],
			playoffs: [...ASYTRAL_PLAYOFF_RESULTS],
			schedule: [...generateSingleRoundRobin(teamIds)],
			details: ASTRAL_S1_DETAILS,
		};
	}
}
