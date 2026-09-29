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

import type { FutProvider } from "../router/types.ts";

export interface ScrapedPlayer {
	id: string;
	name: string;
	overallRating: number;
	position: string;
	altPositions: string[];
	club: string;
	nation: string;
	league: string;
	faceStats: {
		pac: number;
		sho: number;
		pas: number;
		dri: number;
		def: number;
		phy: number;
	};
	playstyles: string[];
	playstylesPlus: string[];
	roles: string[];
	priceConsole: number;
	pricePc: number;
	provider: FutProvider;
	sourceUrl: string;
}

export interface ScrapedSbc {
	id: string;
	name: string;
	slug: string;
	description: string;
	endTime?: string;
	estimatedCostConsole: number;
	estimatedCostPc: number;
	challenges: Array<{
		name: string;
		requirements: string[];
		costCoins?: number;
	}>;
	provider: FutProvider;
	sourceUrl: string;
}

export interface ScrapedEvolution {
	id: string;
	name: string;
	slug: string;
	coinsCost: number;
	pointsCost: number;
	endTime?: string;
	requirements: Array<{ label: string; value: string }>;
	upgrades: Array<{ statName: string; boost: number }>;
	provider: FutProvider;
	sourceUrl: string;
}

export interface ScrapedSquad {
	id: string;
	name: string;
	formation: string;
	totalRating: number;
	totalChemistry: number;
	totalCostConsole: number;
	totalCostPc: number;
	starters: Array<{
		slot: string;
		playerName: string;
		rating: number;
		position: string;
		chemistry: number;
	}>;
	provider: FutProvider;
	sourceUrl: string;
}

export interface ScrapedFodder {
	tiers: Array<{
		rating: number;
		priceConsole: number;
		pricePc: number;
		utilityComment: string;
	}>;
	provider: FutProvider;
	sourceUrl: string;
}
