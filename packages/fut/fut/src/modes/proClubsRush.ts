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

export interface ProClubsBuild {
	archetype: "Poacher" | "Playmaker" | "Anchor" | "Sweeper" | "Sniper";
	position: "ST" | "CAM" | "CM" | "CB" | "GK";
	heightCm: number;
	weightKg: number;
	allocatedPoints: {
		pace: number;       // 0 to 25
		shooting: number;   // 0 to 25
		passing: number;    // 0 to 25
		dribbling: number;  // 0 to 25
		defending: number;  // 0 to 25
		physical: number;   // 0 to 25
	};
	activePerks: string[]; // up to 3 perks
}

export interface RushShootoutResult {
	homeGoals: number;
	awayGoals: number;
	rounds: Array<{
		roundNumber: number;
		homeScored: boolean;
		awayScored: boolean;
	}>;
	winner: "Home" | "Away";
}

export class ProClubsRushEngine {
	public static readonly MAX_SKILL_POINTS = 110;

	/**
	 * Computes Pro Clubs Avatar overall rating from base archetype and allocated points.
	 */
	public static computeAvatarOverall(build: ProClubsBuild): number {
		const totalSpent = Object.values(build.allocatedPoints).reduce((a, b) => a + b, 0);
		if (totalSpent > ProClubsRushEngine.MAX_SKILL_POINTS) {
			throw new Error(`Exceeded max skill points (${totalSpent}/${ProClubsRushEngine.MAX_SKILL_POINTS})`);
		}

		let baseRating = 80;
		switch (build.position) {
			case "ST":
				baseRating += Math.round(
					(build.allocatedPoints.shooting * 0.40) +
					(build.allocatedPoints.pace * 0.35) +
					(build.allocatedPoints.dribbling * 0.25),
				);
				break;
			case "CAM":
			case "CM":
				baseRating += Math.round(
					(build.allocatedPoints.passing * 0.40) +
					(build.allocatedPoints.dribbling * 0.35) +
					(build.allocatedPoints.shooting * 0.25),
				);
				break;
			case "CB":
				baseRating += Math.round(
					(build.allocatedPoints.defending * 0.45) +
					(build.allocatedPoints.physical * 0.35) +
					(build.allocatedPoints.pace * 0.20),
				);
				break;
			case "GK":
				baseRating += Math.round(
					(build.allocatedPoints.defending * 0.50) +
					(build.allocatedPoints.physical * 0.50),
				);
				break;
		}

		return Math.min(96, Math.max(78, baseRating));
	}

	/**
	 * Simulates a 1v1 Rush Shootout (introduced in FC 25 / FC 27).
	 * Unlike standard penalties from the spot, a rush shootout gives 10 seconds to dribble and score 1v1.
	 */
	public static simulateRushShootout(homeShooterOvr = 85, awayShooterOvr = 85): RushShootoutResult {
		const rounds: RushShootoutResult["rounds"] = [];
		let homeGoals = 0;
		let awayGoals = 0;

		// 3 standard rounds, then sudden death if tied
		for (let r = 1; r <= 5; r++) {
			const homeScored = Math.random() < (homeShooterOvr / 130);
			if (homeScored) homeGoals++;

			const awayScored = Math.random() < (awayShooterOvr / 130);
			if (awayScored) awayGoals++;

			rounds.push({
				roundNumber: r,
				homeScored,
				awayScored,
			});

			if (r >= 3 && homeGoals !== awayGoals) {
				break;
			}
		}

		return {
			homeGoals,
			awayGoals,
			rounds,
			winner: homeGoals >= awayGoals ? "Home" : "Away",
		};
	}
}
