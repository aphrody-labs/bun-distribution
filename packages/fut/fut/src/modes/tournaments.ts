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

export interface TwoLeggedTie {
	roundName: string;
	teamA: string;
	teamB: string;
	leg1Score: [number, number]; // [teamA, teamB]
	leg2Score: [number, number]; // [teamB, teamA]
	aggregateScore: [number, number]; // [teamA, teamB]
	winner: string;
}

export class TournamentEngine {
	/**
	 * Simulates a two-legged European knockout tie (e.g. UEFA Champions League).
	 */
	public static simulateTie(
		teamA: string,
		teamARating: number,
		teamB: string,
		teamBRating: number,
		roundName = "Quarter-Final",
	): TwoLeggedTie {
		// Leg 1: Team A at home
		const leg1Home = Math.floor(Math.random() * 3) + (teamARating > teamBRating ? 1 : 0);
		const leg1Away = Math.floor(Math.random() * 2);

		// Leg 2: Team B at home
		const leg2Home = Math.floor(Math.random() * 3) + (teamBRating > teamARating ? 1 : 0);
		const leg2Away = Math.floor(Math.random() * 2);

		const aggA = leg1Home + leg2Away;
		const aggB = leg1Away + leg2Home;

		let winner = aggA > aggB ? teamA : teamB;
		if (aggA === aggB) {
			// Penalty shootout decider if tied on aggregate
			winner = Math.random() < 0.5 ? teamA : teamB;
		}

		return {
			roundName,
			teamA,
			teamB,
			leg1Score: [leg1Home, leg1Away],
			leg2Score: [leg2Home, leg2Away],
			aggregateScore: [aggA, aggB],
			winner,
		};
	}
}
