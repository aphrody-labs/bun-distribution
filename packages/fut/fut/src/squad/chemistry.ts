/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
	ChemistryThresholdProgress,
	FormationDefinition,
	PitchPosition,
	SquadManager,
	SquadPlayerItem,
	SquadChemistryReport,
} from "./types.ts";

/**
 * Default chemistry thresholds: how many in-position team-mates sharing a
 * club / nation / league are needed for 1, 2 and 3 chemistry points.
 *
 * EA serves the authoritative values from `/ut/game/fc<year>/chemistry/profiles`
 * and retunes them between titles. Fetch them with
 * `EaUtasClient.getChemistryProfiles()` and pass the result through
 * `thresholdsFromEaProfiles()` into `calculateSquadChemistry()` rather than
 * relying on these constants.
 */
export const THRESHOLDS = {
	CLUB: [2, 4, 7],
	NATION: [2, 5, 8],
	LEAGUE: [3, 5, 8],
} as const;

/** The three threshold ladders used by a chemistry calculation. */
export interface ChemistryThresholds {
	CLUB: readonly number[];
	NATION: readonly number[];
	LEAGUE: readonly number[];
}

/**
 * Converts EA's live chemistry profiles into threshold ladders. Falls back to
 * {@link THRESHOLDS} for any ladder EA does not provide, so a partial payload
 * still yields a usable result.
 */
export function thresholdsFromEaProfiles(profiles: {
	profiles?: Array<{
		clubThresholds?: number[];
		leagueThresholds?: number[];
		nationThresholds?: number[];
	}>;
}): ChemistryThresholds {
	const valid = (t?: number[]): t is number[] => Array.isArray(t) && t.length === 3;
	const first = <K extends "clubThresholds" | "leagueThresholds" | "nationThresholds">(
		key: K,
	): number[] | undefined => profiles.profiles?.map((p) => p[key]).find(valid);

	return {
		CLUB: first("clubThresholds") ?? THRESHOLDS.CLUB,
		NATION: first("nationThresholds") ?? THRESHOLDS.NATION,
		LEAGUE: first("leagueThresholds") ?? THRESHOLDS.LEAGUE,
	};
}

function calculatePoints(count: number, thresholds: readonly number[]): { points: number; nextThreshold: number | null } {
	if (count >= thresholds[2]) return { points: 3, nextThreshold: null };
	if (count >= thresholds[1]) return { points: 2, nextThreshold: thresholds[2] };
	if (count >= thresholds[0]) return { points: 1, nextThreshold: thresholds[1] };
	return { points: 0, nextThreshold: thresholds[0] };
}

export function isPlayerInPosition(player: SquadPlayerItem, slotPosition: PitchPosition, allowedPositions: PitchPosition[]): boolean {
	if (player.primaryPosition === slotPosition) return true;
	if (player.alternativePositions?.includes(slotPosition)) return true;
	if (allowedPositions.includes(player.primaryPosition)) return true;
	return false;
}

export function calculateSquadChemistry(
	formation: FormationDefinition,
	starters: Array<{ slotIndex: number; player?: SquadPlayerItem }>,
	manager?: SquadManager,
	thresholds: ChemistryThresholds = THRESHOLDS,
): SquadChemistryReport {
	const clubCounts: Record<string, number> = {};
	const nationCounts: Record<string, number> = {};
	const leagueCounts: Record<string, number> = {};

	const inPositionMap: Map<number, boolean> = new Map();
	const distinctLeagues = new Set<string>();

	// 1. First pass: tally contributions from all valid in-position players
	for (const slotDef of formation.slots) {
		const entry = starters.find((s) => s.slotIndex === slotDef.slotIndex);
		const player = entry?.player;

		if (!player) {
			inPositionMap.set(slotDef.slotIndex, false);
			continue;
		}

		const inPos = isPlayerInPosition(player, slotDef.defaultPosition, slotDef.allowedPositions);
		inPositionMap.set(slotDef.slotIndex, inPos);

		if (!inPos) {
			continue; // Out of position players do not contribute to chemistry
		}

		// Track distinct leagues for Icon global boost
		if (player.league && !player.isIcon) {
			distinctLeagues.add(player.league);
		}

		// Club
		if (player.club && !player.isIcon) {
			clubCounts[player.club] = (clubCounts[player.club] ?? 0) + 1;
		}

		// Nation
		if (player.nation) {
			const nationBoost = player.isIcon ? 2 : 1;
			nationCounts[player.nation] = (nationCounts[player.nation] ?? 0) + nationBoost;
		}

		// League
		if (player.league) {
			if (player.isHero) {
				leagueCounts[player.league] = (leagueCounts[player.league] ?? 0) + 2;
			} else if (!player.isIcon) {
				leagueCounts[player.league] = (leagueCounts[player.league] ?? 0) + 1;
			}
		}
	}

	// 2. Add Icon league bonus: each in-position Icon contributes +1 to ALL leagues present in the squad
	let iconCount = 0;
	for (const slotDef of formation.slots) {
		const entry = starters.find((s) => s.slotIndex === slotDef.slotIndex);
		const player = entry?.player;
		if (player?.isIcon && inPositionMap.get(slotDef.slotIndex)) {
			iconCount++;
		}
	}

	if (iconCount > 0) {
		for (const league of distinctLeagues) {
			leagueCounts[league] = (leagueCounts[league] ?? 0) + iconCount;
		}
	}

	// 3. Manager contributions
	if (manager) {
		if (manager.nation) {
			nationCounts[manager.nation] = (nationCounts[manager.nation] ?? 0) + 1;
		}
		if (manager.league) {
			leagueCounts[manager.league] = (leagueCounts[manager.league] ?? 0) + 1;
		}
	}

	// 4. Calculate threshold progress
	const clubsReport: Record<string, ChemistryThresholdProgress> = {};
	for (const [club, count] of Object.entries(clubCounts)) {
		const res = calculatePoints(count, thresholds.CLUB);
		clubsReport[club] = { name: club, count, ...res };
	}

	const nationsReport: Record<string, ChemistryThresholdProgress> = {};
	for (const [nation, count] of Object.entries(nationCounts)) {
		const res = calculatePoints(count, thresholds.NATION);
		nationsReport[nation] = { name: nation, count, ...res };
	}

	const leaguesReport: Record<string, ChemistryThresholdProgress> = {};
	for (const [league, count] of Object.entries(leagueCounts)) {
		const res = calculatePoints(count, thresholds.LEAGUE);
		leaguesReport[league] = { name: league, count, ...res };
	}

	// 5. Individual player chemistry
	let totalSquadChem = 0;
	const playerBreakdowns: SquadChemistryReport["playerBreakdowns"] = [];

	for (const slotDef of formation.slots) {
		const entry = starters.find((s) => s.slotIndex === slotDef.slotIndex);
		const player = entry?.player;

		if (!player) {
			continue;
		}

		const inPos = inPositionMap.get(slotDef.slotIndex) ?? false;

		if (!inPos) {
			playerBreakdowns.push({
				slotIndex: slotDef.slotIndex,
				playerName: player.name,
				inPosition: false,
				clubPoints: 0,
				nationPoints: 0,
				leaguePoints: 0,
				totalPoints: 0,
			});
			continue;
		}

		// Icons and Heroes always receive 3/3 chemistry if in position
		if (player.isIcon || player.isHero) {
			totalSquadChem += 3;
			playerBreakdowns.push({
				slotIndex: slotDef.slotIndex,
				playerName: player.name,
				inPosition: true,
				clubPoints: 0,
				nationPoints: 2,
				leaguePoints: 1,
				totalPoints: 3,
			});
			continue;
		}

		const clubPts = player.club ? (clubsReport[player.club]?.points ?? 0) : 0;
		const nationPts = player.nation ? (nationsReport[player.nation]?.points ?? 0) : 0;
		const leaguePts = player.league ? (leaguesReport[player.league]?.points ?? 0) : 0;

		const totalPlayerPts = Math.min(3, clubPts + nationPts + leaguePts);
		totalSquadChem += totalPlayerPts;

		playerBreakdowns.push({
			slotIndex: slotDef.slotIndex,
			playerName: player.name,
			inPosition: true,
			clubPoints: clubPts,
			nationPoints: nationPts,
			leaguePoints: leaguePts,
			totalPoints: totalPlayerPts,
		});
	}

	return {
		totalChemistry: totalSquadChem,
		maxPossibleChemistry: 33,
		isFullChemistry: totalSquadChem === 33,
		clubs: clubsReport,
		nations: nationsReport,
		leagues: leaguesReport,
		playerBreakdowns,
	};
}
