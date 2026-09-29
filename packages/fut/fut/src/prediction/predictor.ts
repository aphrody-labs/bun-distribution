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

import { FutDatabaseRepository } from "../repository/FutDatabaseRepository.ts";
import { MarketStore } from "../repository/MarketStore.ts";
import type { PlayerRecord } from "../repository/types.ts";
import type { DetailedCardStats } from "../squad/metaRating.ts";
import {
	predictPlayerFuturePrice,
	predictPlayerDualPlatform,
} from "./timeSeriesPredictor.ts";
import type {
	DualPlatformPrediction,
	FutPlatform,
	MarketOpportunityScanOptions,
	PlayerPricePrediction,
	TimeHorizon,
} from "./types.ts";

import type { PlayerCommunitySentiment } from "../social/types.ts";
import { scrapeFutGgPlayer } from "../futgg.ts";
import { scrapeFutbinPlayer } from "../futbin.ts";
import type { FutPlayer } from "../types.ts";

function extractPlayerNameFromUrl(url: string): string {
	try {
		const u = new URL(url);
		const segments = u.pathname.split("/").filter(Boolean);
		for (let i = segments.length - 1; i >= 0; i--) {
			const seg = segments[i];
			if (/^(?:player|players|\d+)$/i.test(seg)) continue;
			const cleaned = seg.replace(/^\d+[-_]/, "").replace(/[-_]/g, " ").trim();
			if (cleaned.length >= 3 && /[a-z]/i.test(cleaned)) {
				return cleaned;
			}
		}
	} catch {
		// Fallback regex
		const m = url.match(/([a-z-]+)(?:\/|\?|$)/i);
		if (m) return m[1].replace(/-/g, " ");
	}
	return url;
}

export class FutPricePredictor {
	private repo: FutDatabaseRepository;
	private market: MarketStore | null;

	/**
	 * @param dbPath  Player database to read cards from.
	 * @param market  Observed prices. Without one, a forecast has no live price
	 *                to anchor on and falls back to the model's own fair value,
	 *                which makes every ROI self-referential. Pass a store (or
	 *                leave the default) so opportunities are scored against what
	 *                the market actually showed.
	 */
	constructor(dbPath?: string, market?: MarketStore | null) {
		this.repo = new FutDatabaseRepository(dbPath);
		this.market = market === undefined ? new MarketStore() : market;
	}

	/** Observed buy-now floor for a card, or undefined when nothing was recorded. */
	private observedPrice(
		record: PlayerRecord,
		platform: FutPlatform,
	): number | undefined {
		if (!this.market) return undefined;
		const defId = Number(record.id);
		if (!Number.isFinite(defId)) return undefined;
		const summary = this.market.getBinSummary(defId, {
			platform: platform === "pc" ? "pc" : "console",
		});
		return summary?.floor;
	}


	/**
	 * Converts a database player record into DetailedCardStats.
	 */
	public recordToDetailedStats(player: PlayerRecord): DetailedCardStats {
		return {
			id: player.id,
			name: player.name,
			overallRating: player.overallRating,
			position: player.position,
			alternativePositions: player.alternativePositions,
			pac: player.pac,
			sho: player.sho,
			pas: player.pas,
			dri: player.dri,
			def: player.def,
			phy: player.phy,
			skillMoves: player.skillMoves,
			weakFoot: player.weakFoot,
			accelerateType: player.accelerateType,
			playstyles: player.playstyles,
			playstylesPlus: player.playstylesPlus,
		};
	}

	/**
	 * Predicts price for a specific player by name or ID, with optional live market price and platform.
	 */
	public predictPlayer(
		nameOrId: string,
		livePrice?: number,
		options: {
			referenceDate?: Date;
			platform?: FutPlatform;
			communitySentiment?: PlayerCommunitySentiment;
		} = {},
	): PlayerPricePrediction | null {
		const searchKey =
			nameOrId.startsWith("http://") || nameOrId.startsWith("https://")
				? extractPlayerNameFromUrl(nameOrId)
				: nameOrId;
		const matches = this.repo.queryPlayers({ name: searchKey, limit: 5 });
		if (matches.length === 0) return null;

		const target = matches[0];
		const cardStats = this.recordToDetailedStats(target);
		return predictPlayerFuturePrice(cardStats, livePrice, options);
	}

	/**
	 * Predicts prices and computes side-by-side disparity metrics across both Console (PS5/Xbox) and PC.
	 * Supports player name, ID, or direct player URL (e.g. fut.gg).
	 */
	public async predictPlayerDual(
		nameOrUrlOrId: string,
		options: {
			livePriceConsole?: number;
			livePricePc?: number;
			referenceDate?: Date;
			communitySentiment?: PlayerCommunitySentiment;
		} = {},
	): Promise<DualPlatformPrediction | null> {
		let cardStats: DetailedCardStats | null = null;

		// 1. If direct URL supplied, scrape directly via scrapeFutGgPlayer or scrapeFutbinPlayer
		if (nameOrUrlOrId.startsWith("http://") || nameOrUrlOrId.startsWith("https://")) {
			try {
				let p: FutPlayer | null = null;
				if (nameOrUrlOrId.includes("futbin.com")) {
					p = await scrapeFutbinPlayer(nameOrUrlOrId);
				} else {
					p = await scrapeFutGgPlayer(nameOrUrlOrId);
				}
				if (!p && !nameOrUrlOrId.includes("futbin.com")) {
					p = await scrapeFutbinPlayer(nameOrUrlOrId);
				}
				if (p && p.name) {
					if (!options.livePriceConsole && p.price) {
						const num = parseInt(p.price.replace(/[^0-9]/g, ""), 10);
						if (num > 0) options.livePriceConsole = num;
					}
					const stats: DetailedCardStats = {
						id: String(p.overallRating ? `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${p.overallRating}` : Date.now()),
						name: p.name,
						overallRating: p.overallRating ?? p.rating ?? 80,
						position: p.position ?? "CM",
						alternativePositions: p.alternativePositions,
						pac: p.pac ?? 70,
						sho: p.sho ?? 70,
						pas: p.pas ?? 70,
						dri: p.dri ?? 70,
						def: p.def ?? 70,
						phy: p.phy ?? 70,
						acceleration: p.acceleration,
						sprintSpeed: p.sprintSpeed,
						finishing: p.finishing,
						shotPower: p.shotPower,
						composure: p.composure,
						reactions: p.reactions,
						skillMoves: p.skillMoves ?? 3,
						weakFoot: p.weakFoot ?? 3,
						accelerateType: p.accelerateType,
						playstyles: p.playstyles,
						playstylesPlus: p.playstylesPlus,
					};
					cardStats = stats;
					// Upsert into local database cache
					this.repo.upsertPlayer({
						id: stats.id,
						name: stats.name,
						overallRating: stats.overallRating,
						position: stats.position,
						alternativePositions: stats.alternativePositions,
						club: p.club,
						nation: p.nation,
						league: p.league,
						pac: stats.pac,
						sho: stats.sho,
						pas: stats.pas,
						dri: stats.dri,
						def: stats.def,
						phy: stats.phy,
						skillMoves: stats.skillMoves,
						weakFoot: stats.weakFoot,
						accelerateType: stats.accelerateType,
						playstyles: stats.playstyles,
						playstylesPlus: stats.playstylesPlus,
						url: nameOrUrlOrId,
					});
				}
			} catch {
				// Fallback to name search
			}
		}

		if (!cardStats) {
			const searchKey =
				nameOrUrlOrId.startsWith("http://") || nameOrUrlOrId.startsWith("https://")
					? extractPlayerNameFromUrl(nameOrUrlOrId)
					: nameOrUrlOrId;
			const matches = this.repo.queryPlayers({ name: searchKey, limit: 5 });
			if (matches.length > 0) {
				cardStats = this.recordToDetailedStats(matches[0]);
			}
		}

		if (!cardStats) return null;

		return predictPlayerDualPlatform(cardStats, options);
	}

	/**
	 * Scans the database for highest ROI market investment opportunities
	 * based on multi-factor prediction.
	 */
	public scanMarketOpportunities(
		options: MarketOpportunityScanOptions = {},
	): Array<{
		prediction: PlayerPricePrediction;
		maxPurchaseQuantity: number;
		totalInvested: number;
		projectedNetProfitTotal: number;
	}> {
		const horizon: TimeHorizon = options.horizon ?? "3d";
		const minRoi = options.minNetRoiPercent ?? 8.0;
		const maxBudget = options.budgetCoins ?? 100000;
		const limit = options.limit ?? 15;

		// 1. Fetch relevant candidates from database based on category and budget
		const candidates: PlayerRecord[] = [];

		let targetMaxRating = 99;
		let targetMinRating = 78;

		if (maxBudget < 30000) {
			targetMaxRating = 83;
			targetMinRating = 76;
		} else if (maxBudget < 100000) {
			targetMaxRating = 86;
			targetMinRating = 78;
		} else if (maxBudget < 500000) {
			targetMaxRating = 89;
			targetMinRating = 82;
		}

		if (options.category === "FODDER") {
			// Query 83-88 rated players
			const fodder = this.repo.queryPlayers({
				minRating: Math.max(83, targetMinRating),
				maxRating: Math.min(89, targetMaxRating),
				limit: 80,
			});
			candidates.push(...fodder);
		} else if (options.category === "META") {
			// Query high pace players in key positions
			const meta = this.repo.queryPlayers({
				minPace: 84,
				minRating: targetMinRating,
				maxRating: targetMaxRating,
				limit: 80,
			});
			candidates.push(...meta);
		} else {
			// Query a broad mix of meta and fodder
			const meta = this.repo.queryPlayers({
				minPace: 84,
				minRating: targetMinRating,
				maxRating: targetMaxRating,
				limit: 40,
			});
			const fodder = this.repo.queryPlayers({
				minRating: Math.max(83, targetMinRating),
				maxRating: Math.min(88, targetMaxRating),
				limit: 40,
			});
			candidates.push(...meta, ...fodder);
		}

		const results: Array<{
			prediction: PlayerPricePrediction;
			maxPurchaseQuantity: number;
			totalInvested: number;
			projectedNetProfitTotal: number;
		}> = [];

		const platform = options.platform ?? "console";
		for (const rec of candidates) {
			const stats = this.recordToDetailedStats(rec);
			// Anchor on an observed price when one exists; otherwise the forecast
			// compares the model against itself and every ROI reads as neutral.
			const livePrice = this.observedPrice(rec, platform);
			const pred = predictPlayerFuturePrice(stats, livePrice, {
				platform,
			});

			const forecast = pred.forecasts[horizon];
			if (!forecast) continue;

			// Filter by minimum ROI and risk
			if (forecast.expectedNetRoiPercent < minRoi) continue;

			if (options.maxRisk === "LOW" && pred.riskLevel !== "LOW") continue;
			if (options.maxRisk === "MEDIUM" && (pred.riskLevel === "HIGH" || pred.riskLevel === "VERY_HIGH")) continue;

			if (pred.currentLivePrice > maxBudget) continue;

			// Allocate quantity based on budget (max 5 of any single card for diversification)
			const affordableQty = Math.max(1, Math.min(5, Math.floor(maxBudget / pred.currentLivePrice)));
			const totalInvested = affordableQty * pred.currentLivePrice;
			const projectedProfit = affordableQty * forecast.projectedProfitPerCard;

			results.push({
				prediction: pred,
				maxPurchaseQuantity: affordableQty,
				totalInvested,
				projectedNetProfitTotal: projectedProfit,
			});
		}

		// Sort by expected Net ROI descending
		results.sort(
			(a, b) =>
				b.prediction.forecasts[horizon].expectedNetRoiPercent -
				a.prediction.forecasts[horizon].expectedNetRoiPercent,
		);

		return results.slice(0, limit);
	}

	/** Releases the database and price-store handles. */
	public close(): void {
		this.repo.close();
		this.market?.close();
		this.market = null;
	}
}
