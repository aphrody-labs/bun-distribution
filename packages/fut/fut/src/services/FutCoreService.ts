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

import { handleAnyFutUrl, type OmniRouterOptions } from "../router/omniRouter.ts";
import type { OmniUrlResult, PlayerUrlResult, SbcUrlResult, SquadUrlResult, EvolutionUrlResult, FodderUrlResult, MarketListingUrlResult } from "../router/types.ts";
import { FutDatabaseRepository } from "../repository/FutDatabaseRepository.ts";

import { FODDER_PRICE_INDEX } from "../sbc/bpm.ts";
import { getCurrentMarketPhase } from "../prediction/index.ts";
import { computeCheapestFodderComposition } from "../importers/sbcImporter.ts";
import { EaUtasClient } from "../ea/client.ts";
import type {
	UtasSessionConfig,
	UtUserMassInfo,
	UtTradeItemsResult,
	UtClubPlayerItem,
	UtBidResult,
	UtListAuctionParams,
	UtListAuctionResult,
	UtItemMoveResult,
	UtQuickSellResult,
	UtAuctionItem,
	UtMarketSearchParams,
} from "../ea/types.ts";

export interface FutCoreOptions extends OmniRouterOptions {
	apiKey?: string;
}

/**
 * Unified Core Service for all FUT operations.
 * Single source of truth consumed identically by:
 * 1. CLI (`bxc fut ...`)
 * 2. REST & GraphQL APIs (`/api/fut/...`)
 * 3. EA Web App Chrome Extension
 * 4. Improved FUT.GG Web Platform
 * 5. Live Discord & X News Bots
 */
export class FutCoreService {
	private repo: FutDatabaseRepository;

	constructor() {
		this.repo = new FutDatabaseRepository();
	}

	public close(): void {
		this.repo.close();
	}

	/**
	 * Parse and route any FUT URL (FUTBin, FUT.GG, EA) into structured data and recommended actions.
	 */
	public async parseAnyUrl(url: string, options: FutCoreOptions = {}): Promise<OmniUrlResult> {
		return handleAnyFutUrl(url, options);
	}

	/**
	 * Get full player analysis, meta rating, and dual platform prediction.
	 */
	public async getPlayerAnalysis(urlOrName: string, options: FutCoreOptions = {}): Promise<PlayerUrlResult> {
		const url = urlOrName.startsWith("http")
			? urlOrName
			: `https://www.futbin.com/27/player/1/${encodeURIComponent(urlOrName.toLowerCase().replace(/\s+/g, "-"))}`;
		const omni = await handleAnyFutUrl(url, options);
		return omni.extractedData as PlayerUrlResult;
	}

	/**
	 * Solve SBC challenge with cheapest mathematical fodder distribution.
	 */
	public async getSbcSolution(targetRatingOrUrl: number | string, options: FutCoreOptions = {}): Promise<SbcUrlResult> {
		if (typeof targetRatingOrUrl === "string" && targetRatingOrUrl.startsWith("http")) {
			const omni = await handleAnyFutUrl(targetRatingOrUrl, options);
			return omni.extractedData as SbcUrlResult;
		}

		const rating = typeof targetRatingOrUrl === "number" ? targetRatingOrUrl : 85;
		const composition = computeCheapestFodderComposition(rating);
		return {
			sbcData: {
				name: `Défi Équipe ${rating} OVR`,
				slug: `equipe-${rating}-ovr`,
				description: `Solution mathématique la moins chère pour note ${rating}`,
				estimatedCostConsole: composition.totalCost,
				estimatedCostPc: Math.round(composition.totalCost * 1.15),
				challenges: [
					{
						name: `Note ${rating} min`,
						requirements: [`Note générale de l'équipe : ${rating} min`],
						costCoins: composition.totalCost,
					},
				],
			},
			profitabilityAnalysis: {
				isProfitable: true,
				expectedRewardValueCoins: Math.round(composition.totalCost * 1.25),
				netProfitMarginCoins: Math.round(composition.totalCost * 0.25),
				verdictFr: "Solution optimisée par surcote EA",
			},
			cheapestFodderStructure: {
				recommendedRatings: composition.distribution,
				estimatedOptimalCost: composition.totalCost,
			},
		};
	}

	/**
	 * Analyze 11-player squad for chemistry, weak links, and tactical FC IQ balance.
	 */
	public async getSquadAnalysis(url: string, options: FutCoreOptions = {}): Promise<SquadUrlResult> {
		const omni = await handleAnyFutUrl(url, options);
		return omni.extractedData as SquadUrlResult;
	}

	/**
	 * Get Evolution analysis and find top database candidates.
	 */
	public async getEvolutionCandidates(url: string, options: FutCoreOptions = {}): Promise<EvolutionUrlResult> {
		const omni = await handleAnyFutUrl(url, options);
		return omni.extractedData as EvolutionUrlResult;
	}

	/**
	 * Get live Fodder Index and market cycle timing.
	 */
	public getFodderMarket(referenceDate?: Date): FodderUrlResult {
		const phase = getCurrentMarketPhase(referenceDate);
		return {
			marketPhase: phase.phase,
			fodderTiers: FODDER_PRICE_INDEX,
			disparityConsoleVsPc: {
				averagePcPremiumPercent: 15.0,
				highestArbitrageTier: 88,
			},
			timingStrategyFr:
				"Acheter en enchères massives avant 17h30 CET et revendre lors du pic d'achats entre 19h15 et 20h30 CET.",
		};
	}

	/**
	 * Scan transfer market for underpriced cards and high-margin flips.
	 */
	public async scanBargains(filters: { position?: string; minRating?: number; maxRating?: number }): Promise<MarketListingUrlResult> {
		const url = `https://www.futbin.com/27/players?position=${filters.position || "CM"}`;
		const omni = await handleAnyFutUrl(url);
		return omni.extractedData as MarketListingUrlResult;
	}

	// -------------------------------------------------------------------------
	// Native EA Sports FC Web App / UTAS Controls
	// -------------------------------------------------------------------------

	private utasClient?: EaUtasClient;

	public getUtasClient(config?: UtasSessionConfig, customClient?: any): EaUtasClient {
		if (!this.utasClient || config || customClient) {
			this.utasClient = new EaUtasClient(config, customClient);
		}
		return this.utasClient;
	}

	public getUtasSessionStatus(config?: UtasSessionConfig) {
		return this.getUtasClient(config).getSessionStatus();
	}

	public async authenticateUtas(config?: UtasSessionConfig): Promise<string> {
		return this.getUtasClient(config).authenticate();
	}

	public async getUserMassInfo(): Promise<UtUserMassInfo> {
		return this.getUtasClient().getUserMassInfo();
	}

	public async getTradePile(): Promise<UtTradeItemsResult> {
		return this.getUtasClient().getTradePile();
	}

	public async getWatchList(): Promise<UtTradeItemsResult> {
		return this.getUtasClient().getWatchList();
	}

	public async getUnassignedItems(): Promise<UtClubPlayerItem[]> {
		return this.getUtasClient().getUnassignedItems();
	}

	public async bidOnTrade(tradeId: number, amount: number): Promise<UtBidResult> {
		return this.getUtasClient().bid(tradeId, amount);
	}

	public async buyNow(tradeId: number, buyNowPrice: number): Promise<UtBidResult> {
		return this.getUtasClient().buyNow(tradeId, buyNowPrice);
	}

	public async listOnMarket(params: UtListAuctionParams): Promise<UtListAuctionResult> {
		return this.getUtasClient().listOnMarket(params);
	}

	public async relistAll(): Promise<{ tradeIdList: number[] }> {
		return this.getUtasClient().relistAll();
	}

	public async sendItemToClub(itemId: number): Promise<UtItemMoveResult> {
		return this.getUtasClient().sendToClub(itemId);
	}

	public async sendItemToTradepile(itemId: number): Promise<UtItemMoveResult> {
		return this.getUtasClient().sendToTradepile(itemId);
	}

	public async quickSellItem(itemId: number): Promise<UtQuickSellResult> {
		return this.getUtasClient().quickSellItem(itemId);
	}

	public async quickSellItems(itemIds: number[]): Promise<UtQuickSellResult> {
		return this.getUtasClient().quickSell(itemIds);
	}

	public async searchUtasMarket(params: UtMarketSearchParams = {}): Promise<UtAuctionItem[]> {
		return this.getUtasClient().searchMarket(params);
	}
}
