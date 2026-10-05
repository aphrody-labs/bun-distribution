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

import type { DualPlatformPrediction, MarketAnomalyReport } from "../prediction/types.ts";
import type { MetaRatingReport } from "../squad/metaRating.ts";
import type { SbcChallenge, FodderPriceTier } from "../sbc/types.ts";
import type { EvolutionSimulationResult } from "../evolutions/types.ts";

export type FutPageType =
	| "PLAYER"
	| "SBC"
	| "SQUAD"
	| "EVOLUTION"
	| "FODDER"
	| "MARKET_LISTING"
	| "UNKNOWN";

export type FutProvider = "FUTBIN" | "FUTGG" | "EA" | "UNKNOWN";

export interface DetectedUrlInfo {
	rawUrl: string;
	provider: FutProvider;
	pageType: FutPageType;
	gameYear: string;
	identifier?: string;
	slug?: string;
	queryParams: Record<string, string>;
}

export type ActionUrgency = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface RecommendedAction {
	verdict: string;
	urgency: ActionUrgency;
	headline: string;
	summaryFr: string;
	explanation: string;
	concreteSteps: string[];
	financialImpactCoins?: number;
}

export interface PlayerUrlResult {
	playerData: {
		id: string;
		name: string;
		overallRating: number;
		position: string;
		club?: string;
		nation?: string;
		league?: string;
		playstyles: string[];
		playstylesPlus: string[];
		faceStats: { pac: number; sho: number; pas: number; dri: number; def: number; phy: number };
	};
	metaReport: MetaRatingReport;
	prediction: DualPlatformPrediction;
	anomalyReport?: MarketAnomalyReport;
}

export interface SbcUrlResult {
	sbcData: {
		name: string;
		slug: string;
		description: string;
		endTime?: string;
		estimatedCostConsole: number;
		estimatedCostPc: number;
		challenges: Array<{ name: string; requirements: string[]; costCoins?: number }>;
	};
	profitabilityAnalysis: {
		isProfitable: boolean;
		expectedRewardValueCoins: number;
		netProfitMarginCoins: number;
		verdictFr: string;
	};
	cheapestFodderStructure: {
		recommendedRatings: Array<{ rating: number; count: number; avgCostPerCard: number }>;
		estimatedOptimalCost: number;
	};
}

export interface SquadUrlResult {
	squadData: {
		name?: string;
		formation: string;
		totalRating: number;
		totalChemistry: number;
		totalCostConsole: number;
		totalCostPc: number;
		starters: Array<{ slot: string; playerName: string; rating: number; position: string; chemistry: number; metaRating?: number }>;
	};
	weakLinks: Array<{ slot: string; playerName: string; reason: string; priority: "CRITICAL" | "MODERATE" }>;
	recommendedUpgrades: Array<{ slot: string; currentCard: string; suggestedCard: string; costCoins: number; metaGain: number }>;
	tacticalAdviceFr: string;
}

export interface EvolutionUrlResult {
	evolutionData: {
		name: string;
		slug: string;
		coinsCost: number;
		pointsCost: number;
		endTime?: string;
		requirements: Array<{ label: string; value: string }>;
		upgrades: Array<{ statName: string; boost: number }>;
	};
	topDatabaseCandidates: Array<{
		id: string;
		name: string;
		currentRating: number;
		projectedRating: number;
		currentMetaRating: number;
		projectedMetaRating: number;
		metaGain: number;
		marketPriceCoins: number;
		tradingInvestmentPotential: "EXTREME" | "HIGH" | "MEDIUM";
	}>;
	bestCandidateSimulation?: EvolutionSimulationResult;
}

export interface FodderUrlResult {
	marketPhase: string;
	fodderTiers: FodderPriceTier[];
	disparityConsoleVsPc: {
		averagePcPremiumPercent: number;
		highestArbitrageTier: number;
	};
	timingStrategyFr: string;
}

export interface MarketListingUrlResult {
	totalCardsFound: number;
	filtersApplied: Record<string, string>;
	topBargains: Array<{
		name: string;
		rating: number;
		position: string;
		currentPrice: number;
		fairValue: number;
		discountPercent: number;
		roiPotential: number;
	}>;
}

export interface OmniUrlResult {
	url: string;
	detectedInfo: DetectedUrlInfo;
	pageType: FutPageType;
	provider: FutProvider;
	extractedData: PlayerUrlResult | SbcUrlResult | SquadUrlResult | EvolutionUrlResult | FodderUrlResult | MarketListingUrlResult | Record<string, unknown>;
	action: RecommendedAction;
}
