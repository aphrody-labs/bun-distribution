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

import type { MasterPlayer } from "../db/types.ts";
import type { FcIqTacticalSetup, MatchSimulationResult, SimulatedMatchEvent } from "./types.ts";

export interface TeamLineup {
	name: string;
	players: MasterPlayer[]; // 11 players
	tactics?: FcIqTacticalSetup;
}

export class MatchSimulator {
	/**
	 * Simulates a full 90-minute stochastic match between two squads.
	 */
	public static simulate(home: TeamLineup, away: TeamLineup): MatchSimulationResult {
		const homeOvr = MatchSimulator.calcAverageOvr(home.players);
		const awayOvr = MatchSimulator.calcAverageOvr(away.players);

		const homeAttack = MatchSimulator.calcSectorRating(home.players, ["ST", "RW", "LW", "CF", "CAM"]);
		const awayAttack = MatchSimulator.calcSectorRating(away.players, ["ST", "RW", "LW", "CF", "CAM"]);
		const homeDefense = MatchSimulator.calcSectorRating(home.players, ["CB", "LB", "RB", "GK", "CDM"]);
		const awayDefense = MatchSimulator.calcSectorRating(away.players, ["CB", "LB", "RB", "GK", "CDM"]);

		// Expected goals baseline (Home advantage + difference between attack and defense)
		const homeAdvantage = 0.15;
		const homePower = (homeAttack - awayDefense) / 25 + homeAdvantage;
		const awayPower = (awayAttack - homeDefense) / 25;

		const homeBaseXg = Math.max(0.4, 1.4 + homePower);
		const awayBaseXg = Math.max(0.3, 1.2 + awayPower);

		// Possession calculation influenced by midfield passing and tactics
		const homeMid = MatchSimulator.calcSectorRating(home.players, ["CM", "CAM", "CDM"]);
		const awayMid = MatchSimulator.calcSectorRating(away.players, ["CM", "CAM", "CDM"]);
		const midDiff = homeMid - awayMid;
		const homePossession = Math.min(75, Math.max(25, Math.round(50 + midDiff * 1.5)));
		const awayPossession = 100 - homePossession;

		const events: SimulatedMatchEvent[] = [];
		let homeScore = 0;
		let awayScore = 0;
		let homeShots = 0;
		let awayShots = 0;
		let homeOnTarget = 0;
		let awayOnTarget = 0;

		// 90 minutes simulation tick in 15 minute segments
		for (let minute = 1; minute <= 90; minute++) {
			const isHomeAction = Math.random() * 100 < homePossession;
			const attackingTeam = isHomeAction ? home : away;
			const defendingTeam = isHomeAction ? away : home;
			const teamTag = isHomeAction ? "Home" : "Away";

			// Chance probability per minute ~ 12%
			if (Math.random() < 0.12) {
				const isShot = Math.random() < 0.70;
				const shooter = MatchSimulator.pickAttackingPlayer(attackingTeam.players);

				if (isShot) {
					if (isHomeAction) homeShots++; else awayShots++;
					const onTarget = Math.random() < 0.45 + (shooter.stats.shooting / 200);

					if (onTarget) {
						if (isHomeAction) homeOnTarget++; else awayOnTarget++;
						const gk = MatchSimulator.pickGk(defendingTeam.players);
						const gkQuality = gk.stats.gkReflexes ?? gk.stats.overallRating;
						const goalProb = (shooter.stats.finishing / (shooter.stats.finishing + gkQuality)) * 0.75;

						if (Math.random() < goalProb) {
							if (isHomeAction) homeScore++; else awayScore++;
							events.push({
								minute,
								type: "Goal",
								team: teamTag,
								playerName: shooter.commonName,
								detail: `Precision finish into bottom corner (${homeScore}-${awayScore})`,
							});
						} else {
							events.push({
								minute,
								type: "Save",
								team: isHomeAction ? "Away" : "Home",
								playerName: gk.commonName,
								detail: `Crucial stop against ${shooter.commonName}`,
							});
						}
					}
				} else {
					// Foul or Card
					if (Math.random() < 0.15) {
						const defender = MatchSimulator.pickDefendingPlayer(defendingTeam.players);
						const isYellow = Math.random() < 0.30;
						events.push({
							minute,
							type: isYellow ? "YellowCard" : "Foul",
							team: isHomeAction ? "Away" : "Home",
							playerName: defender.commonName,
							detail: isYellow ? "Tactical foul stopping counter" : "Late challenge",
						});
					}
				}
			}
		}

		return {
			homeScore,
			awayScore,
			homeXg: Number(homeBaseXg.toFixed(2)),
			awayXg: Number(awayBaseXg.toFixed(2)),
			homePossession,
			awayPossession,
			homeShots,
			awayShots,
			homeShotsOnTarget: homeOnTarget,
			awayShotsOnTarget: awayOnTarget,
			events,
			durationMinutes: 90,
		};
	}

	private static calcAverageOvr(players: MasterPlayer[]): number {
		if (players.length === 0) return 75;
		const sum = players.reduce((acc, p) => acc + p.stats.overallRating, 0);
		return Math.round(sum / players.length);
	}

	private static calcSectorRating(players: MasterPlayer[], positions: string[]): number {
		const matched = players.filter((p) => positions.includes(p.position));
		if (matched.length === 0) return 75;
		const sum = matched.reduce((acc, p) => acc + p.stats.overallRating, 0);
		return Math.round(sum / matched.length);
	}

	private static pickAttackingPlayer(players: MasterPlayer[]): MasterPlayer {
		const attackers = players.filter((p) => ["ST", "CF", "RW", "LW", "CAM"].includes(p.position));
		if (attackers.length > 0) {
			return attackers[Math.floor(Math.random() * attackers.length)];
		}
		return players[Math.floor(Math.random() * players.length)];
	}

	private static pickDefendingPlayer(players: MasterPlayer[]): MasterPlayer {
		const defenders = players.filter((p) => ["CB", "LB", "RB", "CDM"].includes(p.position));
		if (defenders.length > 0) {
			return defenders[Math.floor(Math.random() * defenders.length)];
		}
		return players[0];
	}

	private static pickGk(players: MasterPlayer[]): MasterPlayer {
		const gk = players.find((p) => p.position === "GK");
		return gk ?? players[0];
	}
}
