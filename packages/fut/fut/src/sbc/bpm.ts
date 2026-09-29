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

import type { BpmSimulationResult, FodderPriceTier } from "./types.ts";

export const FODDER_PRICE_INDEX: FodderPriceTier[] = [
	{ rating: 82, averagePriceConsole: 850, averagePricePc: 900, utilityComment: "Remplissage SBC légers (82-83) et renforts" },
	{ rating: 83, averagePriceConsole: 1300, averagePricePc: 1400, utilityComment: "Pilier des équipes 83+ et totw picks" },
	{ rating: 84, averagePriceConsole: 2800, averagePricePc: 3100, utilityComment: "Très demandé pour les équipes 84 avec 1x 86" },
	{ rating: 85, averagePriceConsole: 5200, averagePricePc: 5600, utilityComment: "Seuil charnière des SBC Joueurs du mois / Flashback" },
	{ rating: 86, averagePriceConsole: 9000, averagePricePc: 9500, utilityComment: "Gros fodder pour segments 86/87" },
	{ rating: 87, averagePriceConsole: 13500, averagePricePc: 14000, utilityComment: "Composante essentielle des SBC Icônes" },
	{ rating: 88, averagePriceConsole: 21000, averagePricePc: 22500, utilityComment: "Fodder haut de gamme (segments 88)" },
	{ rating: 89, averagePriceConsole: 42000, averagePricePc: 45000, utilityComment: "Top tier fodder pour gros segments" },
	{ rating: 90, averagePriceConsole: 85000, averagePricePc: 90000, utilityComment: "Walkout d'élite (De Bruyne, Kane, Bonmatí)" },
	{ rating: 91, averagePriceConsole: 160000, averagePricePc: 175000, utilityComment: "Sommet du marché fodder (Mbappé, Putellas)" },
];

export const BPM_CONSTANTS = {
	PACK_COST: 750,
	AVG_PLAYERS_PER_PACK: 3.5, // 3 to 4 bronze players
	AVG_RECOVERY_COINS: 225, // Discard contracts, kits, badges, quicksell duplicates
	NET_PACK_COST: 525, // 750 - 225
	NET_COST_PER_BRONZE_PLAYER: 150, // 525 / 3.5
};

export function simulateBpm(
	target: "bronze_upgrade" | "silver_upgrade" | "gold_upgrade" | "foundations",
	count: number = 1,
): BpmSimulationResult {
	let bronzePlayersNeeded = 0;
	let silverPlayersYield = 0;
	let commonGoldYield = 0;
	let rareGoldYield = 0;

	if (target === "bronze_upgrade") {
		// 1 Bronze Upgrade = 11 Bronze Players -> 1x x2 Silver Players Pack (2 Silver Players)
		bronzePlayersNeeded = 11 * count;
		silverPlayersYield = 2 * count;
	} else if (target === "silver_upgrade") {
		// In FC 27, 1 Silver Upgrade = 11 Silver Players -> 1x "75+ Gold Player Pack" (EXACTLY 1 Gold Player)
		// 11 Silvers requires 5.5 Bronze Upgrades = 5.5 * 11 = 60.5 Bronzes
		bronzePlayersNeeded = Math.ceil(60.5 * count);
		silverPlayersYield = 11 * count;
		commonGoldYield = 1 * count; // 1 Gold Player 75+
	} else if (target === "gold_upgrade") {
		// In FC 27, Gold Upgrade requires 11 Gold items (min 75) -> 1x Small Gold Players Pack
		// 11 Golds requires 11 Silver Upgrades = 11 * 11 = 121 Silver Players
		// 121 Silver Players requires 60.5 Bronze Upgrades = 60.5 * 11 = 665.5 Bronze Players
		bronzePlayersNeeded = Math.ceil(665.5 * count);
		silverPlayersYield = 121 * count;
		commonGoldYield = 11 * count;
		rareGoldYield = 6 * count;
	} else if (target === "foundations") {
		// Foundations & Advanced Hybrid SBCs typically need ~15 bronzes, ~25 silvers, ~40 golds
		// Complete bootstrap loop requires ~120 packs
		bronzePlayersNeeded = 420;
		silverPlayersYield = 60;
		commonGoldYield = 18;
		rareGoldYield = 4;
	}

	const packsNeeded = Math.ceil(bronzePlayersNeeded / BPM_CONSTANTS.AVG_PLAYERS_PER_PACK);
	const grossCostCoins = packsNeeded * BPM_CONSTANTS.PACK_COST;
	const recoveredCoins = packsNeeded * BPM_CONSTANTS.AVG_RECOVERY_COINS;
	const netCostCoins = grossCostCoins - recoveredCoins;

	const breakdownSummary = [
		`Objectif : ${count}x ${target.toUpperCase()}`,
		`Joueurs Bronze requis : ${bronzePlayersNeeded}`,
		`Packs Bronze à ouvrir : ${packsNeeded} packs (à 750 crédits)`,
		`Dépense brute : ${grossCostCoins.toLocaleString()} 🪙`,
		`Crédits remboursés (vente rapide/consommables) : ${recoveredCoins.toLocaleString()} 🪙`,
		`Coût NET réel : ${netCostCoins.toLocaleString()} 🪙`,
		`Production estimée : ${silverPlayersYield} Joueurs Argent, ${commonGoldYield} Joueurs Or Communs, ${rareGoldYield} Joueurs Or Rares`,
	].join(" | ");

	return {
		packsNeeded,
		grossCostCoins,
		recoveredCoins,
		netCostCoins,
		bronzePlayersYield: bronzePlayersNeeded,
		silverPlayersYield,
		commonGoldYield,
		rareGoldYield,
		breakdownSummary,
	};
}
