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

export interface SbcCategory {
	id: number;
	game: string;
	eaId: number;
	name: string;
	slug: string;
	setCount: number;
}

export interface SbcAward {
	id: number;
	count: number;
	isUntradeable: boolean;
	pack?: string | null;
	coins?: number | null;
	playerEaId?: number | null;
}

export interface SbcChallenge {
	id: number;
	eaId: number;
	game: string;
	name: string;
	description: string;
	requirementsText: string[];
	cheapestSolutionPrice?: number;
	cheapestSolutionPricePc?: number;
	cheapestSolutionUrl?: string | null;
	awards: SbcAward[];
}

export interface SbcSet {
	id: number;
	game: string;
	eaId: number;
	slug: string;
	categoryEaId: number;
	name: string;
	description: string;
	endTime: string;
	isRepeatable: boolean;
	challengesCount: number;
	challengeEaIds: number[];
	awards: SbcAward[];
	challenges?: SbcChallenge[];
	cost?: number | null;
	costPc?: number | null;
	isNew?: boolean;
	isExpired?: boolean;
}

export interface FodderPriceTier {
	rating: number;
	averagePriceConsole: number;
	averagePricePc: number;
	utilityComment: string;
}

export interface BpmSimulationResult {
	packsNeeded: number;
	grossCostCoins: number;
	recoveredCoins: number;
	netCostCoins: number;
	bronzePlayersYield: number;
	silverPlayersYield: number;
	commonGoldYield: number;
	rareGoldYield: number;
	breakdownSummary: string;
}
