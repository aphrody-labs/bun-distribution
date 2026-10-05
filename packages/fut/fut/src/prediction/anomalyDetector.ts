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

import { FODDER_PRICE_INDEX } from "../sbc/index.ts";
import type {
	AnomalyType,
	MarketAnomalyReport,
	PlayerPricePrediction,
} from "./types.ts";

/**
 * Analyzes market prices and predicts anomalies like Day 1 Web App credit shortages
 * or panic sell valleys, outputting clear and urgent trading recommendations.
 */
export function detectMarketAnomaly(
	prediction: PlayerPricePrediction,
): MarketAnomalyReport {
	const live = prediction.currentLivePrice;
	const fairValue = prediction.fairValuePrice;
	const ovr = prediction.overallRating;
	const phase = prediction.currentMarketPhase;
	const platform = prediction.platform;

	const fodderTier = FODDER_PRICE_INDEX.find((f) => f.rating === ovr);
	const baseFodder =
		platform === "pc"
			? (fodderTier?.averagePricePc ?? (ovr >= 88 ? 22500 : 900))
			: (fodderTier?.averagePriceConsole ?? (ovr >= 88 ? 21000 : 850));

	const discountPercent =
		fairValue > 0
			? Math.round(((fairValue - live) / fairValue) * 1000) / 10
			: 0;
	const isBelowFodder = live < baseFodder;

	// Case 1: Early Web App Credit Freeze (Price artificially crushed due to 0 player bankrolls)
	if (
		(phase === "PRE_LAUNCH" || phase === "LAUNCH_WEEK") &&
		(discountPercent >= 35 || isBelowFodder)
	) {
		const m1 = prediction.forecasts["24h"]?.predictedPrice ?? Math.round(live * 1.8);
		const m2 = prediction.forecasts["3d"]?.predictedPrice ?? Math.round(live * 3.0);
		const m3 = prediction.forecasts["7d"]?.predictedPrice ?? Math.round(live * 5.5);
		const m4 = prediction.forecasts["14d"]?.predictedPrice ?? Math.round(live * 8.0);

		return {
			hasAnomaly: true,
			anomalyType: isBelowFodder ? "BELOW_FODDER_FLOOR" : "EARLY_APP_CREDIT_FREEZE",
			advisoryAction: "HOLD_ABSOLUTE",
			headline: isBelowFodder
				? "🚨 ANOMALIE CRITIQUE : CARTE EN DESSOUS DU PRIX FODDER BRUT"
				: "❄️ ANOMALIE DE LIQUIDITÉ DÉTECTÉE (WEB APP CREDIT FREEZE)",
			urgency: "CRITICAL",
			summaryFr: `NE LE VENDEZ SURTOUT PAS ! La carte est bradée à ${live.toLocaleString()} coins (${discountPercent}% sous sa valeur réelle) par manque de crédits global sur la Web App.`,
			explanation:
				"Au tout début de la saison, les joueurs n'ont pas encore de crédits et bradent leurs walkouts pour monter des équipes de départ. Dès que les matchs sont joués et que les premiers gros SBC arrivent, cette carte va mécaniquement rebondir vers son prix d'équilibre.",
			discountVsFairValuePercent: discountPercent,
			fodderFloor: baseFodder,
			isBelowFodderFloor: isBelowFodder,
			recoveryMilestones: [
				{
					milestoneName: "Vendredi soir (Veille premier week-end)",
					timeframe: "24h",
					projectedPrice: m1,
					multiplierVsLive: Math.round((m1 / live) * 10) / 10,
					expectedProfitPerCard: Math.round(m1 * 0.95 - live),
				},
				{
					milestoneName: "Premier week-end complet",
					timeframe: "3 jours",
					projectedPrice: m2,
					multiplierVsLive: Math.round((m2 / live) * 10) / 10,
					expectedProfitPerCard: Math.round(m2 * 0.95 - live),
				},
				{
					milestoneName: "Lancement mondial officiel",
					timeframe: "7 jours",
					projectedPrice: m3,
					multiplierVsLive: Math.round((m3 / live) * 10) / 10,
					expectedProfitPerCard: Math.round(m3 * 0.95 - live),
				},
				{
					milestoneName: "1ère Weekend League FUT Champions",
					timeframe: "14 jours",
					projectedPrice: m4,
					multiplierVsLive: Math.round((m4 / live) * 10) / 10,
					expectedProfitPerCard: Math.round(m4 * 0.95 - live),
				},
			],
		};
	}

	// Case 2: Extreme Hype Bubble (Price 80%+ higher than fair value)
	if (discountPercent <= -75) {
		return {
			hasAnomaly: true,
			anomalyType: "OVERPRICED_HYPE",
			advisoryAction: "SELL_URGENT",
			headline: "🔥 BULLE DE HYPE : CARTE SURÉVALUÉE",
			urgency: "HIGH",
			summaryFr: `OPPORTUNITÉ DE VENTE IMMÉDIATE : La carte est en surcote massive (+${Math.abs(discountPercent)}% vs valeur intrinsèque). Vendez dès maintenant avant la correction !`,
			explanation:
				"Le prix est temporairement propulsé par une demande spéculative excessive. Dès que l'offre de packs augmentera, le prix subira une correction baissière inévitable.",
			discountVsFairValuePercent: discountPercent,
			fodderFloor: baseFodder,
			isBelowFodderFloor: false,
			recoveryMilestones: [],
		};
	}

	// Normal market conditions
	return {
		hasAnomaly: false,
		anomalyType: "NONE",
		advisoryAction: prediction.signal === "BUY" || prediction.signal === "STRONG_BUY" ? "HOLD" : "SELL_AT_PEAK",
		headline: "MARCHÉ STABLE : PRIX PROCHE DE LA VALEUR FONDAMENTALE",
		urgency: "LOW",
		summaryFr: "La carte s'échange à un prix cohérent avec sa note et sa méta.",
		explanation: "Aucune distorsion anormale de liquidité constatée.",
		discountVsFairValuePercent: discountPercent,
		fodderFloor: baseFodder,
		isBelowFodderFloor: false,
		recoveryMilestones: [],
	};
}
