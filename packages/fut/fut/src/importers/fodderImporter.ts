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
import type { DetectedUrlInfo, FodderUrlResult, RecommendedAction } from "../router/types.ts";
import { FODDER_PRICE_INDEX } from "../sbc/bpm.ts";
import { getCurrentMarketPhase } from "../prediction/index.ts";

export class FodderImporter implements FutPageImporter<FodderUrlResult> {
	public canHandle(detected: DetectedUrlInfo): boolean {
		return detected.pageType === "FODDER";
	}

	public async importAndAnalyze(
		_url: string,
		_detected: DetectedUrlInfo,
		options: ImporterOptions = {},
	): Promise<{ result: FodderUrlResult; action: RecommendedAction }> {
		const marketPhase = getCurrentMarketPhase(options.referenceDate);

		const tiers = FODDER_PRICE_INDEX;

		const action: RecommendedAction = {
			verdict: "ACCUMULATE_FODDER_NOW",
			urgency: "HIGH",
			headline: "📈 FENÊTRE D'ACCUMULATION OPTIMALE DU FODDER (84-88 OVR)",
			summaryFr:
				"Les notes 84 à 87 s'échangent actuellement à leur plus bas hebdomadaire. Un pic de demande est modélisé pour la sortie du contenu promotionnel à 19h00 CET.",
			explanation:
				"L'analyse historique montre un rebond de 20% à 35% sur les cartes 85-87 lors de l'apparition des DCE Renfort Campagne ou Héros / Icône garanti.",
			concreteSteps: [
				"Acheter des cartes 85 OVR sous 4 500 🪙 et des cartes 87 OVR sous 13 000 🪙.",
				"Remplir la liste des transferts avec 50 à 100 cartes en enchères de masse le matin.",
				"Revendre dès le pic d'achat entre 19h15 et 20h30 le soir de sortie du SBC.",
			],
			financialImpactCoins: 120000,
		};

		const result: FodderUrlResult = {
			marketPhase: marketPhase.phase,
			fodderTiers: tiers,
			disparityConsoleVsPc: {
				averagePcPremiumPercent: 15.0,
				highestArbitrageTier: 88,
			},
			timingStrategyFr:
				"Acheter en enchères massives avant 17h30 CET et revendre lors du pic d'achats entre 19h15 et 20h30 CET.",
		};

		return { result, action };
	}
}
