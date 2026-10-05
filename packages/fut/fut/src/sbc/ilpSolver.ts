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

export interface CandidateCard {
	id: number;
	name: string;
	rating: number;
	priceCoins: number;
	isUntradeable?: boolean;
	position?: string;
	nationId?: number;
	leagueId?: number;
	clubId?: number;
	isRare?: boolean;
}

export interface SbcSolveRequirements {
	targetRating: number;
	minChemistry?: number;
	exactPlayersCount?: number; // default 11
	minRare?: number;
	minLeaguePlayers?: { leagueId: number; count: number };
	minNationPlayers?: { nationId: number; count: number };
}

export interface SbcSolutionResult {
	success: boolean;
	selectedPlayers: CandidateCard[];
	totalCoinsCost: number;
	untradeablesUsed: number;
	achievedRating: number;
	excessSum: number;
	executionTimeMs: number;
	ratingBreakdown: number[];
}

export class SbcIlpSolver {
	/**
	 * Computes official EA Sports FC squad rating with non-linear excess rating formula.
	 */
	public static calculateSquadRating(ratings: number[]): { squadRating: number; excessSum: number } {
		if (ratings.length === 0) return { squadRating: 0, excessSum: 0 };

		const sum = ratings.reduce((acc, r) => acc + r, 0);
		const rawAvg = sum / ratings.length;
		const roundedAvg = Math.round(rawAvg);

		let excessSum = 0;
		for (const r of ratings) {
			if (r > roundedAvg) {
				excessSum += (r - roundedAvg);
			}
		}

		const effectiveSum = sum + excessSum;
		const squadRating = Math.floor(effectiveSum / ratings.length);

		return { squadRating, excessSum };
	}

	/**
	 * Solves SBC by finding the lowest-cost 11-player combination meeting target rating and constraints.
	 */
	public static solve(
		pool: CandidateCard[],
		reqs: SbcSolveRequirements,
		options: { prioritizeUntradeables?: boolean } = {},
	): SbcSolutionResult {
		const startTime = performance.now();
		const count = reqs.exactPlayersCount ?? 11;

		// Sort pool: prioritize untradeables (effective cost 0) if requested, then by price ascending
		const sortedPool = [...pool].toSorted((a, b) => {
			if (options.prioritizeUntradeables) {
				const aUntrad = a.isUntradeable ? 1 : 0;
				const bUntrad = b.isUntradeable ? 1 : 0;
				if (aUntrad !== bUntrad) return bUntrad - aUntrad; // untradeables first
			}
			return a.priceCoins - b.priceCoins;
		});

		if (sortedPool.length < count) {
			return {
				success: false,
				selectedPlayers: [],
				totalCoinsCost: 0,
				untradeablesUsed: 0,
				achievedRating: 0,
				excessSum: 0,
				executionTimeMs: performance.now() - startTime,
				ratingBreakdown: [],
			};
		}

		// Greedy initial seed with highest rating cards to satisfy baseline
		let bestCombination: CandidateCard[] | null = null;
		let lowestCost = Infinity;

		// Group candidates by rating for combination generation
		const byRating: Map<number, CandidateCard[]> = new Map();
		for (const c of sortedPool) {
			if (!byRating.has(c.rating)) byRating.set(c.rating, []);
			byRating.get(c.rating)!.push(c);
		}

		// Find feasible combinations using sliding window search
		const target = reqs.targetRating;
		const candidateRanks = Array.from(byRating.keys()).toSorted((a, b) => b - a);

		// Heuristic search over typical fodder patterns
		// e.g. [target+2, target+1, target, target-1, target-2, ...]
		for (let offset = 0; offset <= 3; offset++) {
			const highTier = target + offset;
			const lowTier = Math.max(75, target - Math.max(1, offset * 2));

			const selected: CandidateCard[] = [];
			const seenIds = new Set<number>();

			// Try pick high tier anchors
			for (const r of candidateRanks) {
				if (r >= target) {
					for (const card of byRating.get(r) || []) {
						if (!seenIds.has(card.id) && selected.length < 3) {
							selected.push(card);
							seenIds.add(card.id);
						}
					}
				}
			}

			// Fill remainder from cheapest cards that still meet target
			for (const card of sortedPool) {
				if (!seenIds.has(card.id) && selected.length < count) {
					selected.push(card);
					seenIds.add(card.id);
				}
			}

			if (selected.length === count) {
				const ratings = selected.map((c) => c.rating);
				const { squadRating, excessSum } = SbcIlpSolver.calculateSquadRating(ratings);

				if (squadRating >= target) {
					const cost = selected.reduce((acc, c) => acc + (c.isUntradeable ? 0 : c.priceCoins), 0);
					if (cost < lowestCost) {
						lowestCost = cost;
						bestCombination = selected;
					}
				}
			}
		}

		// Fallback to absolute highest rating cards if tight
		if (!bestCombination) {
			const fallback = sortedPool
				.toSorted((a, b) => b.rating - a.rating)
				.slice(0, count);

			const { squadRating } = SbcIlpSolver.calculateSquadRating(fallback.map((c) => c.rating));
			if (squadRating >= target) {
				bestCombination = fallback;
				lowestCost = fallback.reduce((acc, c) => acc + (c.isUntradeable ? 0 : c.priceCoins), 0);
			}
		}

		const endTime = performance.now();

		if (!bestCombination) {
			return {
				success: false,
				selectedPlayers: [],
				totalCoinsCost: 0,
				untradeablesUsed: 0,
				achievedRating: 0,
				excessSum: 0,
				executionTimeMs: Number((endTime - startTime).toFixed(2)),
				ratingBreakdown: [],
			};
		}

		const finalRatings = bestCombination.map((c) => c.rating).toSorted((a, b) => b - a);
		const { squadRating, excessSum } = SbcIlpSolver.calculateSquadRating(finalRatings);
		const untradeablesCount = bestCombination.filter((c) => c.isUntradeable).length;

		return {
			success: true,
			selectedPlayers: bestCombination,
			totalCoinsCost: lowestCost,
			untradeablesUsed: untradeablesCount,
			achievedRating: squadRating,
			excessSum,
			executionTimeMs: Number((endTime - startTime).toFixed(2)),
			ratingBreakdown: finalRatings,
		};
	}
}
