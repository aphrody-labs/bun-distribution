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

import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { MarketOpportunity, TradingPlan } from "./types.ts";

export const EA_TAX_RATE = 0.05;

/**
 * Calculates net profit after EA 5% sales tax.
 */
export function calculateNetProfit(buyPrice: number, sellPrice: number): number {
	const revenueAfterTax = Math.floor(sellPrice * (1 - EA_TAX_RATE));
	return revenueAfterTax - buyPrice;
}

/**
 * Autonomous Transfer Market Flipping Algorithm for FC 27.
 * Discovers mathematical bid-ask spread opportunities from local indexed database.
 */
export class MarketTrader {
	private db: Database;

	constructor(dbPath: string = join(import.meta.dir, "../data/fut_extracted_database.sqlite")) {
		this.db = new Database(dbPath, { readonly: true });
	}

	/**
	 * Builds an optimal multi-step trading plan from a given bankroll.
	 */
	public generateTradingPlan(currentBudget: number = 10000, targetBudget: number = 50000): TradingPlan {
		const opportunities: MarketOpportunity[] = [];
		let allocatedCoins = 0;

		if (currentBudget <= 15000) {
			// Phase 1: Mass Bid on Meta Underpriced Golds & Fast Fullbacks
			const phase1Opps = this.findMetaLowBudgetOpportunities(currentBudget);
			opportunities.push(...phase1Opps);
		} else if (currentBudget <= 30000) {
			// Phase 2: Fodder 83/84 Spikes & Pre-SBC Positioning
			const phase2Opps = this.findFodderOpportunities(currentBudget);
			opportunities.push(...phase2Opps);
		} else {
			// Phase 3: Higher tier flips & position-specific meta cards
			const phase3Opps = this.findHighMarginOpportunities(currentBudget);
			opportunities.push(...phase3Opps);
		}

		for (const opp of opportunities) {
			allocatedCoins += opp.maxBidPrice * opp.recommendedQuantity;
		}

		const expectedProfitTotal = opportunities.reduce(
			(acc, opp) => acc + opp.estimatedNetProfit * opp.recommendedQuantity,
			0,
		);

		return {
			startingBudget: currentBudget,
			targetBudget,
			currentStep: currentBudget < 25000 ? "Phase 1: Mass Enchères Rapides (Rotation 1h)" : "Phase 2: Fodder 83+ & Sniping Méta",
			allocatedCoins,
			cashReserve: Math.max(0, currentBudget - allocatedCoins),
			expectedProfitTotal,
			opportunities,
			executionRules: [
				"Ne jamais enchérir au-delà du maxBidPrice calculé.",
				"Toujours relister sur une durée de 1 HEURE (ne jamais lister sur 6h ou 24h).",
				"Relister à l'achat immédiat cible immédiatement après avoir remporté la carte.",
				"Conserver 5 à 10% de réserve pour éviter d'être bloqué en cas de non-vente immédiate.",
				"Réinvestir 100% des gains dès qu'une vente est validée.",
			],
		};
	}

	/**
	 * Phase 1: Search players with high pace or meta positions listed near discard.
	 */
	public findMetaLowBudgetOpportunities(budget: number): MarketOpportunity[] {
		// Target fast Fullbacks (RB, LB) and Wingers from top leagues (Premier League, LaLiga, Serie A, Bundesliga, Ligue 1)
		const query = `
			SELECT id, name, overall_rating, position, club, league, pac, sho, pas, dri, def, phy, playstyles
			FROM players
			WHERE overall_rating BETWEEN 75 AND 81
			  AND pac >= 83
			  AND position IN ('RB', 'LB', 'RWB', 'LWB', 'RW', 'LW', 'RM', 'LM', 'CB')
			  AND league IN ('Premier League', 'LALIGA EA SPORTS', 'Serie A Enilive', 'Bundesliga', 'Ligue 1 McDonald’s')
			ORDER BY pac DESC, def DESC
			LIMIT 8
		`;

		const rows = this.db.query(query).all() as any[];
		const list: MarketOpportunity[] = [];
		const maxCardsToBuy = Math.floor((budget * 0.9) / 450); // ~450 coins per card max bid

		for (const row of rows) {
			const maxBid = 400; // Enchère max cible
			const targetSell = 750; // Prix de revente achat immédiat prudent
			const netProfit = calculateNetProfit(maxBid, targetSell);
			const quantity = Math.max(1, Math.min(3, Math.floor(maxCardsToBuy / rows.length)));

			list.push({
				playerId: row.id,
				name: row.name,
				overall: row.overall_rating,
				position: row.position,
				club: row.club || "Club",
				league: row.league || "Ligue",
				strategy: "meta_low_budget",
				maxBidPrice: maxBid,
				targetSellPrice: targetSell,
				estimatedNetProfit: netProfit,
				roiPercent: Math.round((netProfit / maxBid) * 100),
				recommendedQuantity: quantity,
				confidenceScore: 92,
				reason: `Pace ${row.pac} au poste ${row.position} dans ${row.league}. Très recherché pour starter teams.`,
			});
		}

		return list;
	}

	/**
	 * Phase 2: Fodder 83 & 84 opportunities for SBC daily resets (19h CET).
	 */
	public findFodderOpportunities(budget: number): MarketOpportunity[] {
		const query = `
			SELECT id, name, overall_rating, position, club, league
			FROM players
			WHERE overall_rating IN (83, 84)
			ORDER BY overall_rating ASC, pac DESC
			LIMIT 6
		`;

		const rows = this.db.query(query).all() as any[];
		const list: MarketOpportunity[] = [];
		const budgetPerTarget = Math.floor((budget * 0.9) / Math.max(1, rows.length));

		for (const row of rows) {
			const is83 = row.overall_rating === 83;
			const maxBid = is83 ? 850 : 2100;
			const targetSell = is83 ? 1250 : 2850;
			const netProfit = calculateNetProfit(maxBid, targetSell);
			const quantity = Math.max(1, Math.floor(budgetPerTarget / maxBid));

			list.push({
				playerId: row.id,
				name: row.name,
				overall: row.overall_rating,
				position: row.position,
				club: row.club || "Club",
				league: row.league || "Ligue",
				strategy: "fodder_83_84",
				maxBidPrice: maxBid,
				targetSellPrice: targetSell,
				estimatedNetProfit: netProfit,
				roiPercent: Math.round((netProfit / maxBid) * 100),
				recommendedQuantity: quantity,
				confidenceScore: 95,
				reason: `Fodder ${row.overall_rating} indispensable pour les segments SBC quotidiens à 19h CET.`,
			});
		}

		return list;
	}

	/**
	 * Phase 3: High Margin Flips for budgets > 30k.
	 */
	public findHighMarginOpportunities(budget: number): MarketOpportunity[] {
		const query = `
			SELECT id, name, overall_rating, position, club, league, pac, def, phy
			FROM players
			WHERE overall_rating BETWEEN 82 AND 85
			  AND pac >= 80
			ORDER BY overall_rating DESC
			LIMIT 5
		`;

		const rows = this.db.query(query).all() as any[];
		const list: MarketOpportunity[] = [];

		for (const row of rows) {
			const maxBid = 1400;
			const targetSell = 2200;
			const netProfit = calculateNetProfit(maxBid, targetSell);
			const quantity = Math.max(1, Math.floor((budget * 0.4) / maxBid));

			list.push({
				playerId: row.id,
				name: row.name,
				overall: row.overall_rating,
				position: row.position,
				club: row.club || "Club",
				league: row.league || "Ligue",
				strategy: "shadow_hunter_flip",
				maxBidPrice: maxBid,
				targetSellPrice: targetSell,
				estimatedNetProfit: netProfit,
				roiPercent: Math.round((netProfit / maxBid) * 100),
				recommendedQuantity: quantity,
				confidenceScore: 88,
				reason: `Carte méta avec forte demande le soir et week-end. Flips avec styles recommandés.`,
			});
		}

		return list;
	}

	public close(): void {
		this.db.close();
	}
}
