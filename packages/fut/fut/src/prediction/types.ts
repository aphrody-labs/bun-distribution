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

import type { FutPlatform } from "../types.ts";

import type { PlayerCommunitySentiment } from "../social/types.ts";
export type { FutPlatform };

export type MarketPhase =
	| "PRE_LAUNCH" // Early WebApp / Pre-order access: high inflation on elite meta
	| "LAUNCH_WEEK" // Global release: mass pack opening, cheap cards crash, elite meta spikes
	| "FIRST_WL" // First Weekend League: maximum competitive demand for meta cards
	| "EARLY_CYCLE" // Weeks 2-6: steady supply growth, mid-tier meta gradual deflation
	| "PRE_BLACK_FRIDAY" // Panic selling in anticipation of promo packs
	| "MID_CYCLE" // Post-Black Friday through Winter Wildcards
	| "TOTY_CRASH" // Team of the Year market-wide deflation
	| "LATE_CYCLE"; // Post-TOTS / Endgame

export type IntraWeekDay =
	| "MONDAY"
	| "TUESDAY"
	| "WEDNESDAY"
	| "THURSDAY"
	| "FRIDAY"
	| "SATURDAY"
	| "SUNDAY";

export type TimeHorizon = "12h" | "24h" | "3d" | "7d" | "14d";

export type TrendDirection =
	| "STRONG_UP" // Expected gain > +15%
	| "UP" // Expected gain +5% to +15%
	| "STABLE" // Expected variation -5% to +5%
	| "DOWN" // Expected drop -5% to -15%
	| "CRASH"; // Expected drop > -15%

export type TradeSignal =
	| "STRONG_BUY"
	| "BUY"
	| "HOLD"
	| "SELL"
	| "PANIC_SELL";

export interface ForecastHorizonData {
	horizon: TimeHorizon;
	targetTimestamp: number;
	predictedPrice: number;
	confidenceInterval: [number, number]; // [low95, high95]
	expectedNetRoiPercent: number; // Net ROI after 5% EA tax
	projectedProfitPerCard: number;
	trend: TrendDirection;
}

export interface FactorBreakdown {
	platform: FutPlatform;
	metaPremiumPercent: number; // Contribution of factual meta rating (vs OVR)
	fc26SeasonalTrendPercent: number; // Seasonal trajectory delta based on FC 26 history
	intraWeekCycleMultiplier: number; // Day-of-week multiplier (e.g. 1.08 on Friday, 0.94 on Monday)
	fodderAnchorRatio: number; // 0.0 = pure meta pricing, 1.0 = 100% tied to SBC fodder floor
	evoHypeBonusPercent: number; // Potential price bump from active/upcoming evolutions
	marketLiquidityScore: number; // 0-100 liquidity score
	pcPremiumPercent?: number; // Historical / empirical premium on PC vs Console (+15% to +45%)
	communitySentimentBonusPercent?: number; // Price impact percentage driven by X community sentiment/hype
}

export interface PlayerPricePrediction {
	playerId: string;
	playerName: string;
	overallRating: number;
	position: string;
	factualMetaRating: number;
	metaTier: string;
	platform: FutPlatform;
	currentLivePrice: number;
	fairValuePrice: number; // Intrinsic mathematical value based on current game state
	priceVsFairValuePercent: number; // < 0 means underpriced/undervalued!
	currentMarketPhase: MarketPhase;
	dayOfWeek: IntraWeekDay;
	forecasts: Record<TimeHorizon, ForecastHorizonData>;
	factors: FactorBreakdown;
	signal: TradeSignal;
	targetBuyPrice: number;
	targetSellPrice: number;
	stopLossPrice: number;
	riskLevel: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
	catalysts: string[];
	risks: string[];
	communitySentiment?: PlayerCommunitySentiment;
	fc26HistoricalComparison: {
		equivalentPlayerName: string;
		fc26PriceAtSameDay: number;
		fc26Price7DaysLater: number;
		fc26ObservedTrendPercent: number;
	};
	platformComparison?: {
		consolePrice: number;
		pcPrice: number;
		pcPremiumPercent: number;
	};
}

export type AnomalyType =
	| "EARLY_APP_CREDIT_FREEZE"
	| "BELOW_FODDER_FLOOR"
	| "PANIC_DUMP_DISCOUNT"
	| "OVERPRICED_HYPE"
	| "NONE";

export type AdvisoryAction =
	| "HOLD_ABSOLUTE"
	| "STRONG_BUY"
	| "SELL_URGENT"
	| "SELL_AT_PEAK"
	| "HOLD";

export interface MarketAnomalyReport {
	hasAnomaly: boolean;
	anomalyType: AnomalyType;
	advisoryAction: AdvisoryAction;
	headline: string;
	urgency: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
	summaryFr: string;
	explanation: string;
	discountVsFairValuePercent: number;
	fodderFloor: number;
	isBelowFodderFloor: boolean;
	recoveryMilestones: Array<{
		milestoneName: string;
		timeframe: string;
		projectedPrice: number;
		multiplierVsLive: number;
		expectedProfitPerCard: number;
	}>;
}

export interface DualPlatformPrediction {
	playerId: string;
	playerName: string;
	overallRating: number;
	position: string;
	factualMetaRating: number;
	metaTier: string;
	console: PlayerPricePrediction; // PlayStation 4, PlayStation 5, Xbox One, Xbox Series X|S
	pc: PlayerPricePrediction; // PC (EA App, Steam, Epic)
	platformDisparity: {
		consolePrice: number;
		pcPrice: number;
		priceDifferenceCoins: number;
		pcPremiumPercent: number;
		liquidityAdvantage: "CONSOLE" | "PC";
		arbitrageOrExtinctionRisk: string;
	};
	anomalyReport?: MarketAnomalyReport;
}

export interface MarketOpportunityScanOptions {
	budgetCoins?: number;
	minNetRoiPercent?: number;
	maxRisk?: "LOW" | "MEDIUM" | "HIGH";
	horizon?: TimeHorizon;
	category?: "ALL" | "META" | "FODDER" | "EVO_TARGETS";
	platform?: FutPlatform;
	limit?: number;
}
