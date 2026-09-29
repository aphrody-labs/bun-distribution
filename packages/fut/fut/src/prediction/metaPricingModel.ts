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

import {
	calculateFactualMetaRating,
	type DetailedCardStats,
	type MetaRatingReport,
} from "../squad/metaRating.ts";
import { FODDER_PRICE_INDEX } from "../sbc/index.ts";
import type { FutPlatform } from "./types.ts";

/**
 * Standard minimum SBC fodder floor price by card rating.
 */
export const FODDER_FLOOR_BY_RATING: Record<number, number> = {
	75: 450,
	76: 450,
	77: 500,
	78: 550,
	79: 600,
	80: 700,
	81: 850,
	82: 1200,
	83: 2200,
	84: 3800,
	85: 6500,
	86: 10500,
	87: 15500,
	88: 22000,
	89: 32000,
	90: 45000,
	91: 58000,
	92: 75000,
	93: 110000,
	94: 160000,
	95: 250000,
};

export interface MetaPricingResult {
	cardReport: MetaRatingReport;
	platform: FutPlatform;
	fodderFloorPrice: number;
	fairValuePrice: number;
	metaPremiumAmount: number;
	metaPremiumPercent: number;
	isFodderPriced: boolean;
	primaryPricingDriver: "META_DEMAND" | "SBC_FODDER_FLOOR" | "EVO_SPECULATION" | "DISCARD_VALUE";
}

/**
 * Calculates the econometric fair value of a card based on its factual meta rating,
 * attributes, animations, competitive demand, and platform market dynamics (Console vs PC).
 */
export function calculateMetaFairValue(
	card: DetailedCardStats,
	options: {
		marketPhaseMultiplier?: number;
		evoDemandMultiplier?: number;
		platform?: FutPlatform;
	} = {},
): MetaPricingResult {
	const platform: FutPlatform = options.platform ?? "console";
	const report = calculateFactualMetaRating(card);
	const ovr = card.overallRating;
	const meta = report.factualMetaRating;
	const pos = card.position.toUpperCase();

	// 1. Determine baseline fodder floor (slightly higher on PC for 84+ during active cycles)
	const rawFloor = FODDER_FLOOR_BY_RATING[ovr] ?? FODDER_PRICE_INDEX[ovr] ?? 700;
	const fodderFloor = platform === "pc" && ovr >= 84 ? roundToMarketTick(rawFloor * 1.06) : rawFloor;

	// 2. Classify if this card is primarily fodder or competitive meta
	const isPureFodder =
		(meta < 81 && ovr >= 83) ||
		(card.pac < 75 && (pos === "ST" || pos === "LW" || pos === "RW" || pos === "CB"));

	if (isPureFodder) {
		return {
			cardReport: report,
			platform,
			fodderFloorPrice: fodderFloor,
			fairValuePrice: fodderFloor,
			metaPremiumAmount: 0,
			metaPremiumPercent: 0,
			isFodderPriced: true,
			primaryPricingDriver: "SBC_FODDER_FLOOR",
		};
	}

	// 3. Econometric Meta Valuation Function with Supply Scarcity Curves
	// In FUT, drop rate is an inverse exponential function of face rating (OVR).
	// Therefore, price is jointly determined by Competitive Meta Demand AND Pack Drop Scarcity.
	const isIcon = (card.name ?? "").includes("Icon") || (card.id ?? "").includes("icon");
	const isHero = (card.name ?? "").includes("Hero") || (card.id ?? "").includes("hero");

	let baseMetaPrice = fodderFloor;

	if (isIcon || isHero) {
		if (ovr >= 93) baseMetaPrice = 1800000 + (meta - 90) * 450000;
		else if (ovr >= 90) baseMetaPrice = 650000 + (meta - 88) * 150000;
		else if (ovr >= 87) baseMetaPrice = 280000 + (meta - 86) * 60000;
		else baseMetaPrice = 110000 + (meta - 84) * 35000;
	} else if (ovr >= 91) {
		// Elite 91+ (Mbappé, Haaland, Rodri)
		if (meta >= 95) baseMetaPrice = 3200000 + (meta - 95) * 400000;
		else baseMetaPrice = 350000 + (meta - 88) * 90000;
	} else if (ovr >= 89) {
		// 89-90 (Vini Jr, Hansen, Bellingham, Kane)
		if (meta >= 92) baseMetaPrice = 850000 + (meta - 92) * 220000;
		else baseMetaPrice = 75000 + (meta - 86) * 45000;
	} else if (ovr >= 87) {
		// 87-88 (Valverde, Lautaro, Saliba IF)
		if (meta >= 89) baseMetaPrice = 180000 + (meta - 89) * 85000;
		else baseMetaPrice = fodderFloor + (meta - 83) * 12000;
	} else if (ovr >= 85) {
		// 85-86 (Saliba, Leão, Alvarez, Kelly, Bacha)
		if (meta >= 88) baseMetaPrice = 45000 + (meta - 88) * 15000;
		else baseMetaPrice = fodderFloor + (meta - 82) * 4500;
	} else if (ovr >= 82) {
		// 82-84 (Ferland Mendy, Walker, Davies)
		if (meta >= 86) baseMetaPrice = 35000 + (meta - 86) * 12000;
		else baseMetaPrice = fodderFloor + (meta - 80) * 1500;
	} else {
		// 75-81 starter meta
		if (meta >= 84) baseMetaPrice = 8500 + (meta - 84) * 3500;
		else baseMetaPrice = fodderFloor + Math.max(0, meta - 77) * 400;
	}

	// 4. PC Transfer Market Scarcity Adjustment
	// PC player base is ~15-20% of Console, causing severe pack supply scarcity on high meta cards.
	let pcScarcityMultiplier = 1.0;
	if (platform === "pc") {
		if (meta >= 94 || ovr >= 91) {
			pcScarcityMultiplier = 1.28; // Elite cards command +28% premium on PC
		} else if (meta >= 88 || ovr >= 87) {
			pcScarcityMultiplier = 1.20; // High competitive meta commands +20%
		} else if (meta >= 84) {
			pcScarcityMultiplier = 1.12; // Starter meta commands +12%
		} else {
			pcScarcityMultiplier = 1.04;
		}
	}
	baseMetaPrice *= pcScarcityMultiplier;

	// 5. Multipliers for Rare Attributes (WF 5★, SM 5★, Body Type Unique, Top Leagues)
	let attributeMultiplier = 1.0;

	// Weak Foot 5★ bonus
	if (card.weakFoot === 5 && (pos === "ST" || pos === "CF" || pos === "CAM" || pos === "LW" || pos === "RW")) {
		attributeMultiplier *= 1.25;
	}

	// Skill Moves 5★ bonus
	if (card.skillMoves === 5 && (pos === "ST" || pos === "CF" || pos === "CAM" || pos === "LW" || pos === "RW")) {
		attributeMultiplier *= 1.18;
	}

	// Body Type Unique
	const body = (card.bodyType ?? "").toLowerCase();
	if (body.includes("unique")) {
		attributeMultiplier *= 1.30;
	}

	// AcceleRATE Lengthy on CB / ST
	const acc = (card.accelerateType ?? "").toLowerCase();
	if (acc.includes("lengthy") && (pos === "CB" || pos === "ST")) {
		attributeMultiplier *= 1.15;
	}

	// League / Nation Links Premium (Premier League, Real Madrid, France)
	const topLeagues = ["Premier League", "LALIGA EA SPORTS", "Serie A Enilive"];
	if (card.position && topLeagues.some((l) => card.id?.includes(l))) {
		attributeMultiplier *= 1.10;
	}

	// Apply market phase adjustments
	const phaseMult = options.marketPhaseMultiplier ?? 1.0;
	const evoMult = options.evoDemandMultiplier ?? 1.0;

	let calculatedPrice = baseMetaPrice * attributeMultiplier * phaseMult * evoMult;

	// Floor check: can never trade below fodder floor or 450 discard
	calculatedPrice = Math.max(calculatedPrice, fodderFloor, 450);

	// Round to FIFA Market Price Increment (Tick Sizes)
	calculatedPrice = roundToMarketTick(calculatedPrice);

	const metaPremium = Math.max(0, calculatedPrice - fodderFloor);
	const metaPremiumPct = Math.round((metaPremium / (fodderFloor || 1)) * 100);

	return {
		cardReport: report,
		platform,
		fodderFloorPrice: fodderFloor,
		fairValuePrice: calculatedPrice,
		metaPremiumAmount: metaPremium,
		metaPremiumPercent: metaPremiumPct,
		isFodderPriced: calculatedPrice <= fodderFloor * 1.1,
		primaryPricingDriver: calculatedPrice > fodderFloor * 1.5 ? "META_DEMAND" : "SBC_FODDER_FLOOR",
	};
}

/**
 * Rounds a coin value to the exact EA Transfer Market tick size.
 * Up to 1k: 50 increments
 * 1k - 10k: 100 increments
 * 10k - 50k: 250 increments
 * 50k - 100k: 500 increments
 * 100k+: 1,000 increments
 */
export function roundToMarketTick(price: number): number {
	if (price <= 1000) return Math.round(price / 50) * 50;
	if (price <= 10000) return Math.round(price / 100) * 100;
	if (price <= 50000) return Math.round(price / 250) * 250;
	if (price <= 100000) return Math.round(price / 500) * 500;
	return Math.round(price / 1000) * 1000;
}
