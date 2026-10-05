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

import type { DetailedCardStats } from "../squad/metaRating.ts";
import type { PlayerCommunitySentiment } from "../social/types.ts";
import {
	calculateMetaFairValue,
	roundToMarketTick,
} from "./metaPricingModel.ts";
import {
	getCurrentMarketPhase,
	getHistoricalTrajectoryFactor,
	getIntraWeekDay,
	getIntraWeekMultipliers,
	FC26_CONSOLE_BENCHMARKS,
	FC26_PC_BENCHMARKS,
	type MarketArchetypeKey,
} from "./historicalCycles.ts";
import type {
	DualPlatformPrediction,
	ForecastHorizonData,
	FutPlatform,
	PlayerPricePrediction,
	TimeHorizon,
	TradeSignal,
	TrendDirection,
} from "./types.ts";
import { detectMarketAnomaly } from "./anomalyDetector.ts";

export const HORIZON_DAYS_MAP: Record<TimeHorizon, number> = {
	"12h": 0.5,
	"24h": 1.0,
	"3d": 3.0,
	"7d": 7.0,
	"14d": 14.0,
};

/**
 * Predicts the future price trajectory of any player card combining
 * live FC 27 market price, econometric meta value, and FC 26 seasonality.
 */
export function predictPlayerFuturePrice(
	card: DetailedCardStats,
	currentLivePrice?: number,
	options: {
		referenceDate?: Date;
		marketVolatility?: number; // default 0.08 console, 0.11 pc
		platform?: FutPlatform;
		communitySentiment?: PlayerCommunitySentiment;
	} = {},
): PlayerPricePrediction {
	const platform: FutPlatform = options.platform ?? "console";
	const refDate = options.referenceDate ?? new Date();
	const currentDayOfWeek = getIntraWeekDay(refDate);
	const { phase, dayInCycle } = getCurrentMarketPhase(refDate);

	// 1. Calculate fundamental fair value based on meta rating and platform
	const fairValueResult = calculateMetaFairValue(card, { platform });
	const fairValue = fairValueResult.fairValuePrice;

	// 2. Resolve live price (fallback to fair value if not supplied)
	const livePrice = currentLivePrice && currentLivePrice > 0 ? currentLivePrice : fairValue;
	const isFodder = fairValueResult.isFodderPriced;

	// 3. Determine Player Archetype Tier for FC 26 Historical Matching
	let archetypeKey: MarketArchetypeKey = "DISCARD_GOLDS_75_82";
	if (fairValueResult.cardReport.factualMetaRating >= 92) {
		archetypeKey = "ELITE_META_90_PLUS";
	} else if (fairValueResult.cardReport.factualMetaRating >= 85) {
		archetypeKey = "MID_META_83_87";
	} else if (isFodder && card.overallRating >= 88) {
		archetypeKey = "HIGH_FODDER_88_90";
	} else if (isFodder && card.overallRating >= 84) {
		archetypeKey = "MID_FODDER_84_86";
	}

	const benchmark = platform === "pc" ? FC26_PC_BENCHMARKS[archetypeKey] : FC26_CONSOLE_BENCHMARKS[archetypeKey];
	const vol = options.marketVolatility ?? (platform === "pc" ? 0.11 : 0.08);

	// 4. Calculate predictions across each time horizon
	const horizons: TimeHorizon[] = ["12h", "24h", "3d", "7d", "14d"];
	const forecasts: Record<TimeHorizon, ForecastHorizonData> = {} as any;

	const nowMs = refDate.getTime();
	const currentIntraMap = getIntraWeekMultipliers(currentDayOfWeek, platform);
	const currentIntraMultiplier = isFodder
		? currentIntraMap.fodderMultiplier
		: currentIntraMap.metaMultiplier;

	for (const h of horizons) {
		const hDays = HORIZON_DAYS_MAP[h];
		const targetTimestamp = nowMs + hDays * 24 * 60 * 60 * 1000;
		const targetDate = new Date(targetTimestamp);
		const targetDayOfWeek = getIntraWeekDay(targetDate);
		const targetIntraMap = getIntraWeekMultipliers(targetDayOfWeek, platform);

		const targetIntraMultiplier = isFodder
			? targetIntraMap.fodderMultiplier
			: targetIntraMap.metaMultiplier;

		// Intra-week shift factor
		const intraShift = targetIntraMultiplier / (currentIntraMultiplier || 1);

		// FC 26 Historical Seasonality Shift
		const historicalShift = getHistoricalTrajectoryFactor(archetypeKey, dayInCycle, hDays, platform);

		// Mean-reversion weight (kappa): live price decays towards fair value over longer horizons
		// For 12h: 88% live, 12% fair. For 7d: 40% live, 60% fair.
		const liveWeight = Math.exp(-0.15 * hDays);
		const blendedBase = liveWeight * livePrice + (1 - liveWeight) * fairValue;

		// Community sentiment multiplier from X (strongest in 12h-3d, fading over 14d)
		const sentimentMult = options.communitySentiment?.pricePredictionMultiplier ?? 1.0;
		const sentimentWeight = Math.max(0.1, 1 - (hDays / 14) * 0.8);
		const effectiveSentimentMult = 1 + (sentimentMult - 1) * sentimentWeight;

		// Projected Price
		let predicted = blendedBase * historicalShift * intraShift * effectiveSentimentMult;
		predicted = Math.max(predicted, fairValueResult.fodderFloorPrice, 450);
		predicted = roundToMarketTick(predicted);

		// Confidence Interval (95% log-normal dispersion)
		const stdDev = vol * Math.sqrt(hDays);
		const low95 = roundToMarketTick(predicted * (1 - 1.96 * stdDev));
		const high95 = roundToMarketTick(predicted * (1 + 1.96 * stdDev));

		// Net ROI calculation after EA 5% tax
		const netRevenue = Math.floor(predicted * 0.95);
		const netProfit = netRevenue - livePrice;
		const expectedNetRoi = Math.round((netProfit / (livePrice || 1)) * 1000) / 10;

		let trend: TrendDirection = "STABLE";
		if (expectedNetRoi >= 15) trend = "STRONG_UP";
		else if (expectedNetRoi >= 5) trend = "UP";
		else if (expectedNetRoi <= -15) trend = "CRASH";
		else if (expectedNetRoi <= -5) trend = "DOWN";

		forecasts[h] = {
			horizon: h,
			targetTimestamp,
			predictedPrice: predicted,
			confidenceInterval: [low95, high95],
			expectedNetRoiPercent: expectedNetRoi,
			projectedProfitPerCard: netProfit,
			trend,
		};
	}

	// 5. Compute primary trading recommendation based on 3-day and 7-day horizon
	const roi3d = forecasts["3d"].expectedNetRoiPercent;
	const roi7d = forecasts["7d"].expectedNetRoiPercent;

	let signal: TradeSignal = "HOLD";
	if (roi3d >= 16 || roi7d >= 22) signal = "STRONG_BUY";
	else if (roi3d >= 7 || roi7d >= 10) signal = "BUY";
	else if (roi3d <= -14 || roi7d <= -20) signal = "PANIC_SELL";
	else if (roi3d <= -6 || roi7d <= -8) signal = "SELL";

	// 6. Set strategic price levels
	const targetBuyPrice = roundToMarketTick(livePrice * 0.96); // Buy 4% under current market (bid/snipe)
	const targetSellPrice = forecasts["3d"].predictedPrice;
	const stopLossPrice = roundToMarketTick(livePrice * 0.90); // 10% stop loss

	// 7. Determine risk level
	let riskLevel: PlayerPricePrediction["riskLevel"] = "MEDIUM";
	if (livePrice >= 1000000) riskLevel = "HIGH";
	if (card.overallRating <= 82 && !isFodder) riskLevel = "HIGH"; // Low-rated meta cards depreciate fast
	if (isFodder && livePrice <= fairValueResult.fodderFloorPrice * 1.05) riskLevel = "LOW"; // Fodder at floor has zero downside!

	// 8. Identify Catalysts & Risks
	const catalysts: string[] = [];
	const risks: string[] = [];

	if (currentDayOfWeek === "MONDAY" || currentDayOfWeek === "TUESDAY") {
		catalysts.push("Achat optimal en creux de marché post-Weekend League.");
	}
	if (forecasts["3d"].trend === "STRONG_UP" || forecasts["3d"].trend === "UP") {
		catalysts.push("Surcote compétitive attendue lors des qualifications Weekend League du vendredi.");
	}
	if (fairValueResult.cardReport.tier === "S+" || fairValueResult.cardReport.tier === "S") {
		catalysts.push(`Statut Méta ${fairValueResult.cardReport.tier} garantissant une liquidité continue.`);
	}
	if (isFodder) {
		catalysts.push("Appel d'air massif à 19h00 lors de la sortie de SBCs Icône/Héros répétables.");
	}

	if (phase === "LAUNCH_WEEK") {
		risks.push("Afflux massif d'offres lors des ouvertures de packs 4600 FC Points.");
	}
	if (livePrice > fairValue * 1.25) {
		risks.push("Prix actuel surévalué par rapport à la valeur intrinsèque (risque de correction baissière).");
	}
	if (currentDayOfWeek === "FRIDAY" || currentDayOfWeek === "SATURDAY") {
		risks.push("Sommet hebdomadaire : risque élevé de revente massive dimanche soir.");
	}

	if (platform === "pc") {
		if (fairValueResult.cardReport.factualMetaRating >= 90) {
			catalysts.push("Surcote PC forte (+20% à +45%) causée par la rareté mathématique des cartes sur le marché PC.");
		}
		risks.push("Liquidité PC réduite : attention au Price Range maximum et au risque d'extinction.");
	} else {
		catalysts.push("Marché Console partagé (PS5/Xbox) : volume maximal d'échanges et liquidité instantanée.");
	}

	if (options.communitySentiment?.sentimentCatalysts) {
		catalysts.push(...options.communitySentiment.sentimentCatalysts);
	}
	if (options.communitySentiment?.sentimentRisks) {
		risks.push(...options.communitySentiment.sentimentRisks);
	}

	const priceVsFair = Math.round(((livePrice - fairValue) / (fairValue || 1)) * 1000) / 10;

	return {
		playerId: card.id,
		playerName: card.name,
		overallRating: card.overallRating,
		position: card.position,
		factualMetaRating: fairValueResult.cardReport.factualMetaRating,
		metaTier: fairValueResult.cardReport.tier,
		platform,
		currentLivePrice: livePrice,
		fairValuePrice: fairValue,
		priceVsFairValuePercent: priceVsFair,
		currentMarketPhase: phase,
		dayOfWeek: currentDayOfWeek,
		forecasts,
		factors: {
			platform,
			metaPremiumPercent: fairValueResult.metaPremiumPercent,
			fc26SeasonalTrendPercent: Math.round((getHistoricalTrajectoryFactor(archetypeKey, dayInCycle, 7, platform) - 1) * 100),
			intraWeekCycleMultiplier: currentIntraMultiplier,
			fodderAnchorRatio: isFodder ? 1.0 : 0.0,
			evoHypeBonusPercent: card.overallRating <= 80 ? 15 : 0,
			marketLiquidityScore: platform === "pc" ? (livePrice > 500000 ? 55 : 75) : (livePrice > 500000 ? 75 : 95),
			pcPremiumPercent: platform === "pc" ? 25 : undefined,
			communitySentimentBonusPercent: options.communitySentiment
				? Math.round((options.communitySentiment.pricePredictionMultiplier - 1) * 100)
				: undefined,
		},
		signal,
		targetBuyPrice,
		targetSellPrice,
		stopLossPrice,
		riskLevel,
		catalysts,
		risks,
		communitySentiment: options.communitySentiment,
		fc26HistoricalComparison: {
			equivalentPlayerName: benchmark.examplePlayersFC26[0] ?? card.name,
			fc26PriceAtSameDay: benchmark.fc26Day0Price,
			fc26Price7DaysLater: benchmark.fc26Day7Price,
			fc26ObservedTrendPercent: Math.round(((benchmark.fc26Day7Price - benchmark.fc26Day0Price) / benchmark.fc26Day0Price) * 100),
		},
	};
}

/**
 * Predicts future prices and computes comparative arbitrage / disparity metrics
 * across both Console (PlayStation 4/5 & Xbox One/Series) and PC (EA App / Steam / Epic).
 */
export function predictPlayerDualPlatform(
	card: DetailedCardStats,
	options: {
		livePriceConsole?: number;
		livePricePc?: number;
		referenceDate?: Date;
		communitySentiment?: PlayerCommunitySentiment;
	} = {},
): DualPlatformPrediction {
	const consolePred = predictPlayerFuturePrice(card, options.livePriceConsole, {
		referenceDate: options.referenceDate,
		platform: "console",
		communitySentiment: options.communitySentiment,
	});

	// If PC price is not explicitly supplied, estimate it through econometric PC scarcity curve
	let pcLive = options.livePricePc;
	if (!pcLive || pcLive <= 0) {
		const meta = consolePred.factualMetaRating;
		const ovr = card.overallRating;
		let pcMultiplier = 1.05;
		if (meta >= 92 || ovr >= 91) pcMultiplier = 1.28;
		else if (meta >= 86 || ovr >= 87) pcMultiplier = 1.20;
		else if (meta >= 82) pcMultiplier = 1.12;
		pcLive = roundToMarketTick(consolePred.currentLivePrice * pcMultiplier);
	}

	const pcPred = predictPlayerFuturePrice(card, pcLive, {
		referenceDate: options.referenceDate,
		platform: "pc",
		communitySentiment: options.communitySentiment,
	});

	const priceDiff = pcPred.currentLivePrice - consolePred.currentLivePrice;
	const pcPremium = Math.round(((priceDiff) / (consolePred.currentLivePrice || 1)) * 1000) / 10;

	// Populate platformComparison in both predictions
	consolePred.platformComparison = {
		consolePrice: consolePred.currentLivePrice,
		pcPrice: pcPred.currentLivePrice,
		pcPremiumPercent: pcPremium,
	};
	pcPred.platformComparison = {
		consolePrice: consolePred.currentLivePrice,
		pcPrice: pcPred.currentLivePrice,
		pcPremiumPercent: pcPremium,
	};

	let arbitrageOrExtinctionRisk = "Écart standard habituel entre Console et PC.";
	if (pcPremium >= 30) {
		arbitrageOrExtinctionRisk = "Alerte Extinction PC : la carte est 30%+ plus chère sur PC, risque élevé d'atteindre le Price Range maximum.";
	} else if (pcPremium <= 5) {
		arbitrageOrExtinctionRisk = "Parité quasi-totale entre marchés Console et PC (typique du fodder de note standard).";
	}

	const anomalyReport = detectMarketAnomaly(consolePred);

	return {
		playerId: card.id,
		playerName: card.name,
		overallRating: card.overallRating,
		position: card.position,
		factualMetaRating: consolePred.factualMetaRating,
		metaTier: consolePred.metaTier,
		console: consolePred,
		pc: pcPred,
		platformDisparity: {
			consolePrice: consolePred.currentLivePrice,
			pcPrice: pcPred.currentLivePrice,
			priceDifferenceCoins: priceDiff,
			pcPremiumPercent: pcPremium,
			liquidityAdvantage: "CONSOLE",
			arbitrageOrExtinctionRisk,
		},
		anomalyReport,
	};
}
