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

import type { UtMarketSearchParams } from "../ea/types.ts";
import type {
	CardRarityGroup,
	FilterTileDefinition,
	MarketFilterQuery,
	PriceFilterRange,
} from "./types.ts";

export class MarketFilterMatrix {
	private query: MarketFilterQuery;

	constructor(initialQuery: MarketFilterQuery = {}) {
		this.query = {
			category: "player",
			rarity: "all",
			position: "all",
			chemStyle: "all",
			playStyleTier: "any",
			...initialQuery,
		};
	}

	public setPlayerName(name: string, defId?: number): this {
		this.query.name = name;
		if (defId) this.query.defId = defId;
		return this;
	}

	public setRarity(rarity: CardRarityGroup): this {
		this.query.rarity = rarity;
		return this;
	}

	public setPosition(pos: MarketFilterQuery["position"]): this {
		this.query.position = pos;
		return this;
	}

	public setPlayStyle(playStyleId: string, tier: "any" | "regular" | "plus" = "any"): this {
		this.query.playStyleId = playStyleId;
		this.query.playStyleTier = tier;
		return this;
	}

	public setChemistryStyle(chemStyle: MarketFilterQuery["chemStyle"]): this {
		this.query.chemStyle = chemStyle;
		return this;
	}

	public setPricing(pricing: PriceFilterRange): this {
		this.query.pricing = { ...this.query.pricing, ...pricing };
		return this;
	}

	public setHierarchy(nationId?: number, leagueId?: number, teamId?: number): this {
		if (nationId !== undefined) this.query.nationId = nationId;
		if (leagueId !== undefined) this.query.leagueId = leagueId;
		if (teamId !== undefined) this.query.teamId = teamId;
		return this;
	}

	public getQuery(): MarketFilterQuery {
		return { ...this.query };
	}

	/**
	 * Calculates official EA SPORTS FC price step increments.
	 */
	public static roundToValidPriceStep(coins: number): number {
		if (coins <= 1000) {
			return Math.round(coins / 50) * 50;
		}
		if (coins <= 10000) {
			return Math.round(coins / 100) * 100;
		}
		if (coins <= 50000) {
			return Math.round(coins / 250) * 250;
		}
		if (coins <= 100000) {
			return Math.round(coins / 500) * 500;
		}
		return Math.round(coins / 1000) * 1000;
	}

	/**
	 * Converts high-level Frostbite 9-tile matrix filter into native UTAS market params.
	 */
	public toUtasParams(): UtMarketSearchParams {
		let utasType: UtMarketSearchParams["type"] = "player";
		if (this.query.category === "consumables") {
			utasType = "training";
		} else if (this.query.category === "stadium") {
			utasType = "clubInfo";
		} else if (this.query.category === "staff") {
			utasType = "development";
		}

		const params: UtMarketSearchParams = {
			type: utasType,
			start: this.query.page ? (this.query.page - 1) * (this.query.pageSize ?? 20) : 0,
			num: this.query.pageSize ?? 20,
		};

		if (this.query.defId) params.defId = this.query.defId;
		if (this.query.nationId) params.nat = this.query.nationId;
		if (this.query.leagueId) params.leag = this.query.leagueId;
		if (this.query.teamId) params.team = this.query.teamId;

		// Map rarity to UTAS lev
		if (this.query.rarity) {
			switch (this.query.rarity) {
				case "bronze_common":
				case "bronze_rare":
					params.lev = "bronze";
					break;
				case "silver_common":
				case "silver_rare":
					params.lev = "silver";
					break;
				case "gold_common":
				case "gold_rare":
					params.lev = "gold";
					break;
				case "totw":
				case "ucl_rttk":
				case "trailblazers":
				case "centurions":
				case "cornerstones":
				case "heroes":
				case "icons":
				case "evolutions_in_progress":
				case "evolutions_completed":
				case "squad_foundations":
				case "potm":
				case "flashback":
				case "special":
					params.lev = "special";
					break;
			}
		}

		// Map position
		if (this.query.position && this.query.position !== "all") {
			params.pos = this.query.position;
		}

		// Pricing
		if (this.query.pricing) {
			if (this.query.pricing.minBid) params.micr = MarketFilterMatrix.roundToValidPriceStep(this.query.pricing.minBid);
			if (this.query.pricing.maxBid) params.macr = MarketFilterMatrix.roundToValidPriceStep(this.query.pricing.maxBid);
			if (this.query.pricing.minBuyNow) params.minb = MarketFilterMatrix.roundToValidPriceStep(this.query.pricing.minBuyNow);
			if (this.query.pricing.maxBuyNow) params.maxb = MarketFilterMatrix.roundToValidPriceStep(this.query.pricing.maxBuyNow);
		}

		return params;
	}

	/**
	 * Generates the 9 visual filter tiles as represented on screen `tx_ui_ut_transfermarket_search_filters_grid`.
	 */
	public generateGridTiles(): FilterTileDefinition[] {
		return [
			{
				id: "name",
				labelFr: "Nom",
				labelEn: "Name",
				icon: "avatar_silhouette",
				currentDisplayValue: this.query.name || "TOUT",
				shortcutKey: "A",
			},
			{
				id: "rarity",
				labelFr: "Rareté",
				labelEn: "Rarity",
				icon: "shield_crest",
				currentDisplayValue: this.query.rarity === "all" ? "TOUTES RARETÉS" : this.query.rarity?.toUpperCase() ?? "TOUT",
				shortcutKey: "A",
			},
			{
				id: "position",
				labelFr: "Poste",
				labelEn: "Position",
				icon: "player_figure",
				currentDisplayValue: this.query.position === "all" ? "TOUT" : this.query.position ?? "TOUT",
				shortcutKey: "A",
			},
			{
				id: "playstyles",
				labelFr: "Styles de jeu",
				labelEn: "PlayStyles",
				icon: "diamond_playstyle",
				currentDisplayValue: this.query.playStyleId ? `${this.query.playStyleId}${this.query.playStyleTier === "plus" ? "+" : ""}` : "TOUT",
				shortcutKey: "A",
			},
			{
				id: "chemistry_style",
				labelFr: "Style",
				labelEn: "Chemistry Style",
				icon: "card_badge",
				currentDisplayValue: this.query.chemStyle === "all" ? "TOUT" : this.query.chemStyle?.toUpperCase() ?? "TOUT",
				shortcutKey: "A",
			},
			{
				id: "pricing",
				labelFr: "Fixation prix",
				labelEn: "Pricing",
				icon: "coins_stack",
				currentDisplayValue: this.query.pricing?.maxBuyNow ? `BIN Max: ${this.query.pricing.maxBuyNow}` : "TOUT",
				shortcutKey: "A",
			},
			{
				id: "nation",
				labelFr: "Pays/région",
				labelEn: "Nation",
				icon: "flag",
				currentDisplayValue: this.query.nationId ? `ID: ${this.query.nationId}` : "TOUT",
				shortcutKey: "A",
			},
			{
				id: "league",
				labelFr: "Championnat",
				labelEn: "League",
				icon: "globe_shield",
				currentDisplayValue: this.query.leagueId ? `ID: ${this.query.leagueId}` : "TOUT",
				shortcutKey: "A",
			},
			{
				id: "club",
				labelFr: "Club",
				labelEn: "Club",
				icon: "club_shield",
				currentDisplayValue: this.query.teamId ? `ID: ${this.query.teamId}` : "TOUT",
				shortcutKey: "A",
			},
		];
	}

	/**
	 * Pre-configured sniping presets derived from in-game live metas.
	 */
	public static createPreset(preset: "cornerstones" | "shadow_defenders" | "hunter_attackers" | "totw_investing"): MarketFilterMatrix {
		switch (preset) {
			case "cornerstones":
				return new MarketFilterMatrix({
					category: "player",
					rarity: "cornerstones",
					pricing: { maxBuyNow: 15000 },
				});
			case "shadow_defenders":
				return new MarketFilterMatrix({
					category: "player",
					rarity: "gold_rare",
					position: "defenders",
					chemStyle: "shadow",
					pricing: { maxBuyNow: 5000 },
				});
			case "hunter_attackers":
				return new MarketFilterMatrix({
					category: "player",
					rarity: "gold_rare",
					position: "attackers",
					chemStyle: "hunter",
					pricing: { maxBuyNow: 6000 },
				});
			case "totw_investing":
				return new MarketFilterMatrix({
					category: "player",
					rarity: "totw",
					pricing: { maxBuyNow: 12000 },
				});
		}
	}
}
