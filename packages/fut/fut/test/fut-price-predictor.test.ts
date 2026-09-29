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

import { describe, expect, it } from "bun:test";
import { hasFutDataset } from "./helpers/fut-dataset.ts";
import {
	FutPricePredictor,
	calculateMetaFairValue,
	getCurrentMarketPhase,
	getHistoricalTrajectoryFactor,
	getIntraWeekDay,
	predictPlayerFuturePrice,
	predictPlayerDualPlatform,
	INTRA_WEEK_MULTIPLIERS,
	roundToMarketTick,
} from "../src/prediction/index.ts";
import type { DetailedCardStats } from "../src/squad/metaRating.ts";

describe("FUT Multi-Factor Price Prediction Engine (FC 27 & FC 26 Cycles)", () => {
	it("correctly models market phases from calendar date", () => {
		const sept22 = new Date(2026, 8, 22);
		const phaseInfo = getCurrentMarketPhase(sept22);
		expect(phaseInfo.phase).toBe("PRE_LAUNCH");
		expect(phaseInfo.dayInCycle).toBeGreaterThanOrEqual(1);
		expect(getIntraWeekDay(sept22)).toBe("TUESDAY");
		expect(getHistoricalTrajectoryFactor("ELITE_META_90_PLUS", 1, 7)).toBeGreaterThan(1.0);

		const oct5 = new Date(2026, 9, 5);
		const octPhase = getCurrentMarketPhase(oct5);
		expect(octPhase.phase).toBe("FIRST_WL");
	});

	it("reflects intra-week liquidity cycles with Friday peak and Monday trough", () => {
		const mondayMult = INTRA_WEEK_MULTIPLIERS["MONDAY"].metaMultiplier;
		const fridayMult = INTRA_WEEK_MULTIPLIERS["FRIDAY"].metaMultiplier;

		expect(fridayMult).toBeGreaterThan(mondayMult);
		expect(fridayMult).toBeGreaterThan(1.0);
		expect(mondayMult).toBeLessThan(1.0);
	});

	it("computes econometric fair value with meta premium for meta cards and fodder floor for slow cards", () => {
		const metaAttacker: DetailedCardStats = {
			id: "attacker",
			name: "Top Striker",
			overallRating: 91,
			position: "ST",
			pac: 97,
			sho: 91,
			pas: 82,
			dri: 92,
			def: 36,
			phy: 78,
			skillMoves: 5,
			weakFoot: 5,
			playstylesPlus: ["Quick Step+"],
		};
		const metaValuation = calculateMetaFairValue(metaAttacker);
		expect(metaValuation.fairValuePrice).toBeGreaterThan(3000000);
		expect(metaValuation.isFodderPriced).toBe(false);

		const slowFodder: DetailedCardStats = {
			id: "fodder",
			name: "Slow Center Back",
			overallRating: 88,
			position: "CB",
			pac: 52,
			sho: 40,
			pas: 65,
			dri: 60,
			def: 89,
			phy: 75,
			skillMoves: 2,
			weakFoot: 2,
		};
		const fodderValuation = calculateMetaFairValue(slowFodder);
		expect(fodderValuation.isFodderPriced).toBe(true);
		expect(fodderValuation.fairValuePrice).toBe(fodderValuation.fodderFloorPrice);
	});

	it("rounds coin prices to exact EA market tick increments", () => {
		expect(roundToMarketTick(432)).toBe(450);
		expect(roundToMarketTick(2341)).toBe(2300);
		expect(roundToMarketTick(24890)).toBe(25000);
		expect(roundToMarketTick(78200)).toBe(78000);
		expect(roundToMarketTick(1458200)).toBe(1458000);
	});

	it("generates 12h, 24h, 3d, 7d and 14d forecasts with confidence intervals and trade signals", () => {
		const card: DetailedCardStats = {
			id: "mendy-test",
			name: "Ferland Mendy",
			overallRating: 82,
			position: "LB",
			pac: 91,
			sho: 64,
			pas: 75,
			dri: 78,
			def: 81,
			phy: 86,
			skillMoves: 4,
			weakFoot: 5,
		};

		// Buy at 40,000
		const pred = predictPlayerFuturePrice(card, 40000);
		expect(pred.currentLivePrice).toBe(40000);
		expect(pred.forecasts["12h"]).toBeDefined();
		expect(pred.forecasts["24h"]).toBeDefined();
		expect(pred.forecasts["3d"]).toBeDefined();
		expect(pred.forecasts["7d"]).toBeDefined();
		expect(pred.forecasts["14d"]).toBeDefined();

		// Confidence interval: lower < predicted < upper
		const f3d = pred.forecasts["3d"];
		expect(f3d.confidenceInterval[0]).toBeLessThan(f3d.predictedPrice);
		expect(f3d.confidenceInterval[1]).toBeGreaterThan(f3d.predictedPrice);

		// Net profit must account for 5% EA tax
		const expectedNet = Math.floor(f3d.predictedPrice * 0.95) - 40000;
		expect(f3d.projectedProfitPerCard).toBe(expectedNet);
	});

	it.skipIf(!hasFutDataset)("scans market opportunities in database for a given budget", () => {
		const predictor = new FutPricePredictor();
		const opps = predictor.scanMarketOpportunities({
			budgetCoins: 100000,
			minNetRoiPercent: 5.0,
			limit: 5,
		});

		expect(Array.isArray(opps)).toBe(true);
		if (opps.length > 0) {
			const first = opps[0];
			expect(first.totalInvested).toBeLessThanOrEqual(100000);
			expect(first.prediction.forecasts["3d"].expectedNetRoiPercent).toBeGreaterThanOrEqual(5.0);
			expect(first.projectedNetProfitTotal).toBeGreaterThan(0);
		}
		predictor.close();
	});

	it("accurately differentiates Console (PS5/Xbox) and PC prices with scarcity premium", () => {
		const mbappe: DetailedCardStats = {
			id: "231747",
			name: "Kylian Mbappé",
			overallRating: 91,
			position: "ST",
			pac: 97,
			sho: 90,
			pas: 80,
			dri: 92,
			def: 36,
			phy: 78,
			skillMoves: 5,
			weakFoot: 4,
			playstyles: ["Rapid", "Quick Step"],
			playstylesPlus: ["Quick Step"],
		};

		const consolePred = predictPlayerFuturePrice(mbappe, undefined, { platform: "console" });
		const pcPred = predictPlayerFuturePrice(mbappe, undefined, { platform: "pc" });

		expect(consolePred.platform).toBe("console");
		expect(pcPred.platform).toBe("pc");
		// PC market has higher scarcity for 91+ elite cards
		expect(pcPred.fairValuePrice).toBeGreaterThan(consolePred.fairValuePrice);

		const dual = predictPlayerDualPlatform(mbappe);
		expect(dual.console.platform).toBe("console");
		expect(dual.pc.platform).toBe("pc");
		expect(dual.platformDisparity.pcPrice).toBeGreaterThan(dual.platformDisparity.consolePrice);
		expect(dual.platformDisparity.pcPremiumPercent).toBeGreaterThan(15);
		expect(dual.platformDisparity.liquidityAdvantage).toBe("CONSOLE");
	});

	it("extracts and parses separate Console and PC prices from HTML", async () => {
		const { parseFutPlatformPrices } = await import("../src/parser/native.ts");
		const htmlSample = `
			<div class="player-card">
				<div class="price-box ps" data-price-console="85000">
					<span class="ps-price">85,000</span>
				</div>
				<div class="price-box pc" data-price-pc="105000">
					<span class="pc-price">105,000</span>
				</div>
			</div>
		`;

		const parsed = parseFutPlatformPrices(htmlSample);
		expect(parsed.console).toBe(85000);
		expect(parsed.pc).toBe(105000);
		expect(parsed.pcPremiumPercent).toBeGreaterThan(20);
	});
});

