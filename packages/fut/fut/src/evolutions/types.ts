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

export interface EvolutionRequirement {
	label: string;
	value: string;
}

export interface EvolutionUpgrade {
	label: string;
	value: string;
	maxValue?: string;
}

export interface EvolutionChallenge {
	description: string;
	gameMode?: string;
}

export interface EvolutionLevel {
	levelIndex: number;
	challenges: EvolutionChallenge[];
	upgrades: EvolutionUpgrade[];
}

export interface EvolutionItem {
	id: number;
	slug: string;
	name: string;
	description: string;
	coinsCost: number;
	pointsCost: number;
	isFree: boolean;
	numberOfPlayersEligible: number;
	endTime: string;
	requirements: EvolutionRequirement[];
	levels: EvolutionLevel[];
	totalUpgrades: EvolutionUpgrade[];
	trendingPlayerIds?: string[];
}

export interface EvolutionSimulationResult {
	playerOriginal: {
		name: string;
		rating: number;
		pac: number;
		sho: number;
		pas: number;
		dri: number;
		def: number;
		phy: number;
		playstyles: string[];
	};
	evolutionApplied: string;
	playerUpgraded: {
		name: string;
		rating: number;
		pac: number;
		sho: number;
		pas: number;
		dri: number;
		def: number;
		phy: number;
		playstyles: string[];
	};
	totalStatBoost: number;
	costCoins: number;
}
