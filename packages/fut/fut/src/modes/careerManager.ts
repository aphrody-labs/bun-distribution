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

export interface YouthProspect {
	name: string;
	nationality: string;
	position: string;
	age: number;
	overall: number;
	potentialMin: number;
	potentialMax: number;
	weakFoot: 1 | 2 | 3 | 4 | 5;
	skillMoves: 1 | 2 | 3 | 4 | 5;
	estimatedValueEur: number;
}

export interface ClubFinances {
	clubName: string;
	transferBudgetEur: number;
	weeklyWageBudgetEur: number;
	weeklyWageSpentEur: number;
	merchandisingIncomeWeeklyEur: number;
}

export class CareerManager {
	/**
	 * Computes market transfer value in Euros based on age, OVR, potential, and contract length.
	 */
	public static calculateMarketValue(
		overall: number,
		potential: number,
		age: number,
		contractMonthsLeft = 24,
	): number {
		// Base market valuation scaled to overall tiers
		let baseValue: number;
		if (overall <= 60) {
			baseValue = 100_000 + (overall - 45) * 25_000;
		} else if (overall <= 75) {
			baseValue = 500_000 + Math.pow(overall - 60, 2) * 40_000;
		} else if (overall <= 85) {
			baseValue = 10_000_000 + Math.pow(overall - 75, 2.3) * 350_000;
		} else {
			baseValue = 70_000_000 + (overall - 85) * 15_000_000;
		}

		// Age curve: peak at 23-28, penalty above 30, premium below 22
		let ageMultiplier = 1.0;
		if (age <= 21) {
			ageMultiplier = 1.35 + ((potential - overall) * 0.05);
		} else if (age >= 32) {
			ageMultiplier = Math.max(0.2, 1.0 - (age - 31) * 0.15);
		}

		// Contract remaining multiplier
		const contractMultiplier = Math.min(1.2, Math.max(0.5, contractMonthsLeft / 24));

		return Math.round(baseValue * ageMultiplier * contractMultiplier);
	}

	/**
	 * Predicts player rating growth over an entire season based on age, potential, and game time.
	 */
	public static predictSeasonGrowth(
		currentOverall: number,
		potential: number,
		age: number,
		appearancesPercent = 80, // % of matches played
	): { newOverall: number; growthDelta: number } {
		if (currentOverall >= potential || age >= 33) {
			// Degradation or plateau
			if (age >= 34) {
				const drop = Math.min(3, Math.floor((age - 33) * 1.2));
				return { newOverall: currentOverall - drop, growthDelta: -drop };
			}
			return { newOverall: currentOverall, growthDelta: 0 };
		}

		const roomForGrowth = potential - currentOverall;
		const playingFactor = appearancesPercent / 100;

		let maxPossibleGrowth = 1;
		if (age <= 21) maxPossibleGrowth = 5;
		else if (age <= 24) maxPossibleGrowth = 3;
		else if (age <= 28) maxPossibleGrowth = 2;

		const growthDelta = Math.min(
			roomForGrowth,
			Math.max(0, Math.round(maxPossibleGrowth * playingFactor)),
		);

		return {
			newOverall: currentOverall + growthDelta,
			growthDelta,
		};
	}

	/**
	 * Generates a Youth Academy scouting report for a given nation and scout rating (1 to 5 stars).
	 */
	public static scoutYouthAcademy(
		nation: string,
		scoutStars: 1 | 2 | 3 | 4 | 5,
		preferredPosition?: string,
	): YouthProspect[] {
		const positions = ["ST", "LW", "RW", "CAM", "CM", "CDM", "CB", "LB", "RB", "GK"];
		const count = scoutStars + Math.floor(Math.random() * 2);
		const prospects: YouthProspect[] = [];

		for (let i = 0; i < count; i++) {
			const pos = preferredPosition ?? positions[Math.floor(Math.random() * positions.length)];
			const baseOvr = 50 + scoutStars * 3 + Math.floor(Math.random() * 8);
			const potMin = Math.min(94, baseOvr + 12 + Math.floor(Math.random() * 10));
			const potMax = Math.min(94, potMin + 6 + Math.floor(Math.random() * 8));

			const weakFoot = (Math.min(5, Math.max(1, Math.floor(Math.random() * 5) + 1))) as 1 | 2 | 3 | 4 | 5;
			const skillMoves = (Math.min(5, Math.max(1, Math.floor(Math.random() * 5) + 1))) as 1 | 2 | 3 | 4 | 5;

			const age = 15 + Math.floor(Math.random() * 3); // 15 to 17
			const val = CareerManager.calculateMarketValue(baseOvr, potMax, age, 36);

			prospects.push({
				name: `Youth_${nation}_${i + 1}`,
				nationality: nation,
				position: pos,
				age,
				overall: baseOvr,
				potentialMin: potMin,
				potentialMax: potMax,
				weakFoot,
				skillMoves,
				estimatedValueEur: val,
			});
		}

		return prospects;
	}
}
