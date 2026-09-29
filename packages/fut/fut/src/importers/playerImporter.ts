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

import type { FutPageImporter, ImporterOptions } from "./types.ts";
import type { DetectedUrlInfo, PlayerUrlResult, RecommendedAction } from "../router/types.ts";
import { FutPricePredictor } from "../prediction/predictor.ts";
import { calculateFactualMetaRating } from "../squad/metaRating.ts";
import { FutDatabaseRepository } from "../repository/FutDatabaseRepository.ts";

export class PlayerImporter implements FutPageImporter<PlayerUrlResult> {
	public canHandle(detected: DetectedUrlInfo): boolean {
		return detected.pageType === "PLAYER";
	}

	public async importAndAnalyze(
		url: string,
		detected: DetectedUrlInfo,
		options: ImporterOptions = {},
	): Promise<{ result: PlayerUrlResult; action: RecommendedAction }> {
		const predictor = new FutPricePredictor();
		const repo = new FutDatabaseRepository();

		try {
			const dual = await predictor.predictPlayerDual(url, {
				livePriceConsole: options.livePriceConsole,
				livePricePc: options.livePricePc,
				referenceDate: options.referenceDate,
				communitySentiment: options.communitySentiment,
			});

			if (!dual) {
				throw new Error(`Could not parse or resolve player from URL: ${url}`);
			}

			// Query local database for full stats and playstyles enrichment
			let faceStats = {
				pac: 80,
				sho: 75,
				pas: 75,
				dri: 80,
				def: 70,
				phy: 75,
			};
			let playstyles: string[] = [];
			let playstylesPlus: string[] = [];
			let club = "Unknown Club";
			let nation = "Unknown Nation";
			let league = "Unknown League";

			const dbPlayers = repo.queryPlayers({
				name: dual.playerName,
				limit: 1,
			});

			if (dbPlayers.length > 0) {
				const p = dbPlayers[0];
				faceStats = {
					pac: p.pac || faceStats.pac,
					sho: p.sho || faceStats.sho,
					pas: p.pas || faceStats.pas,
					dri: p.dri || faceStats.dri,
					def: p.def || faceStats.def,
					phy: p.phy || faceStats.phy,
				};
				club = p.club || club;
				nation = p.nation || nation;
				league = p.league || league;
				if (Array.isArray(p.playstyles)) {
					playstyles = p.playstyles;
					playstylesPlus = p.playstyles.filter((ps: string) => ps.includes("+"));
				}
			}

			const metaReport = calculateFactualMetaRating({
				id: dual.playerId,
				name: dual.playerName,
				overallRating: dual.overallRating,
				position: dual.position,
				pac: faceStats.pac,
				sho: faceStats.sho,
				pas: faceStats.pas,
				dri: faceStats.dri,
				def: faceStats.def,
				phy: faceStats.phy,
				skillMoves: 3,
				weakFoot: 3,
			});

			const anomaly = dual.anomalyReport;
			let action: RecommendedAction;

			if (anomaly && anomaly.hasAnomaly) {
				action = {
					verdict: anomaly.advisoryAction,
					urgency: anomaly.urgency,
					headline: anomaly.headline,
					summaryFr: anomaly.summaryFr,
					explanation: anomaly.explanation,
					concreteSteps: [
						"Ne pas brader la carte aux enchères ou en achat immédiat actuel.",
						`Conserver la carte jusqu'au jalon ${anomaly.recoveryMilestones[0]?.milestoneName ?? "du week-end"}.`,
						`Objectif de revente : ${dual.console.forecasts["3d"].predictedPrice.toLocaleString()} 🪙 (Console) / ${dual.pc.forecasts["3d"].predictedPrice.toLocaleString()} 🪙 (PC).`,
					],
					financialImpactCoins: dual.console.forecasts["3d"].projectedProfitPerCard,
				};
			} else {
				const isBuy = dual.console.signal === "BUY" || dual.console.signal === "STRONG_BUY";
				action = {
					verdict: dual.console.signal,
					urgency: isBuy ? "HIGH" : "MEDIUM",
					headline: isBuy ? "🟢 SIGNAL D'ACHAT FORT DÉTECTÉ" : "🟡 PRIX PROCHE DU FAIR VALUE",
					summaryFr: isBuy
						? `Opportunité d'investissement : la carte est sous-cotée de ${Math.abs(dual.console.priceVsFairValuePercent)}% sur Console.`
						: "La carte s'échange à sa valeur d'équilibre de marché.",
					explanation: dual.platformDisparity.arbitrageOrExtinctionRisk,
					concreteSteps: isBuy
						? [
								`Acheter sous ${dual.console.targetBuyPrice.toLocaleString()} 🪙.`,
								`Placer un stop-loss à ${dual.console.stopLossPrice.toLocaleString()} 🪙.`,
								`Prendre ses profits à ${dual.console.targetSellPrice.toLocaleString()} 🪙.`,
							]
						: ["Surveiller les fluctuations hebdomadaires avant d'acheter."],
					financialImpactCoins: dual.console.forecasts["3d"].projectedProfitPerCard,
				};
			}

			const result: PlayerUrlResult = {
				playerData: {
					id: dual.playerId,
					name: dual.playerName,
					overallRating: dual.overallRating,
					position: dual.position,
					club,
					nation,
					league,
					playstyles,
					playstylesPlus,
					faceStats,
				},
				metaReport,
				prediction: dual,
				anomalyReport: anomaly,
			};

			return { result, action };
		} finally {
			predictor.close();
			repo.close();
		}
	}
}
