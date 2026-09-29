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

export interface MarketOpportunity {
	playerId?: number;
	name: string;
	overall: number;
	position: string;
	club: string;
	league: string;
	strategy: "common_gold_mass_bid" | "meta_low_budget" | "fodder_83_84" | "shadow_hunter_flip";
	maxBidPrice: number;
	targetSellPrice: number;
	estimatedNetProfit: number;
	roiPercent: number;
	recommendedQuantity: number;
	confidenceScore: number;
	reason: string;
}

export interface TradingPlan {
	startingBudget: number;
	targetBudget: number;
	currentStep: string;
	allocatedCoins: number;
	cashReserve: number;
	expectedProfitTotal: number;
	opportunities: MarketOpportunity[];
	executionRules: string[];
}

export interface MarketFilter {
	league?: string;
	position?: string;
	minPace?: number;
	minRating?: number;
	maxRating?: number;
	maxBid?: number;
	targetBin?: number;
}
