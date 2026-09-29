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
	PlayerImporter,
	SbcImporter,
	SquadImporter,
	EvolutionImporter,
	FodderImporter,
	MarketListingImporter,
	FutImporterRegistry,
	calculateEaSquadRating,
	computeCheapestFodderComposition,
} from "../src/importers/index.ts";
import { detectFutUrlType } from "../src/router/urlDetector.ts";

describe("FUT Dedicated Page Importers & Analyzers", () => {
	describe("PlayerImporter", () => {
		it.skipIf(!hasFutDataset)("imports and analyzes a player URL with real face stats and dual prediction", async () => {
			const importer = new PlayerImporter();
			const url = "https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves";
			const detected = detectFutUrlType(url);
			expect(importer.canHandle(detected)).toBe(true);

			const { result, action } = await importer.importAndAnalyze(url, detected, {
				livePriceConsole: 17000,
				livePricePc: 22000,
				referenceDate: new Date("2026-09-18T12:00:00Z"),
			});

			expect(result.playerData.name).toContain("Neves");
			expect(result.playerData.overallRating).toBeGreaterThanOrEqual(80);
			expect(result.metaReport).toBeDefined();
			expect(result.prediction.console.forecasts["3d"]).toBeDefined();
			expect(action.verdict).toBeDefined();
			expect(action.concreteSteps.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("SbcImporter & Mathematical Excess Rating", () => {
		it("calculates EA squad rating with excess rating formula accurately", () => {
			// 11 cards of 85 -> exactly 85
			expect(calculateEaSquadRating([85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85])).toBe(85);

			// 2x 88 + 9x 84 -> RawAvg = 932/11 = 84.72. Excess = (88-84.72)*2 = 6.54. Final = round(84.72 + 6.54/11) = round(85.32) = 85
			expect(calculateEaSquadRating([88, 88, 84, 84, 84, 84, 84, 84, 84, 84, 84])).toBe(85);
		});

		it("computes the cheapest fodder composition for target ratings", () => {
			const comp86 = computeCheapestFodderComposition(86);
			expect(comp86.distribution.length).toBeGreaterThan(0);
			expect(comp86.totalCost).toBeGreaterThan(0);
		});

		it("imports and analyzes an SBC challenge URL", async () => {
			const importer = new SbcImporter();
			const url = "https://www.futbin.com/27/squad-building-challenges/ea/123/potm-mbappe";
			const detected = detectFutUrlType(url);
			expect(importer.canHandle(detected)).toBe(true);

			const { result, action } = await importer.importAndAnalyze(url, detected);
			expect(result.sbcData.name).toBeDefined();
			expect(result.profitabilityAnalysis).toBeDefined();
			expect(result.cheapestFodderStructure.recommendedRatings.length).toBeGreaterThan(0);
			expect(action.verdict).toBeDefined();
		});
	});

	describe("SquadImporter", () => {
		it.skipIf(!hasFutDataset)("imports a squad URL, pinpoints weak links and provides tiered upgrades", async () => {
			const importer = new SquadImporter();
			const url = "https://www.futbin.com/27/squad/987654";
			const detected = detectFutUrlType(url);
			expect(importer.canHandle(detected)).toBe(true);

			const { result, action } = await importer.importAndAnalyze(url, detected);
			expect(result.squadData.starters.length).toBe(11);
			expect(result.weakLinks.length).toBeGreaterThan(0);
			expect(result.recommendedUpgrades.length).toBeGreaterThan(0);
			expect(action.verdict).toBe("UPGRADE_WEAK_LINK");
			expect(action.concreteSteps.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("EvolutionImporter", () => {
		it.skipIf(!hasFutDataset)("imports an evolution URL and scans database for best candidates", async () => {
			const importer = new EvolutionImporter();
			const url = "https://www.fut.gg/evolutions/27-relentless-winger/";
			const detected = detectFutUrlType(url);
			expect(importer.canHandle(detected)).toBe(true);

			const { result, action } = await importer.importAndAnalyze(url, detected);
			expect(result.topDatabaseCandidates.length).toBeGreaterThanOrEqual(1);
			expect(result.topDatabaseCandidates[0].metaGain).toBeGreaterThan(0);
			expect(action.verdict).toBe("TOP_EVO_CANDIDATE_IDENTIFIED");
		});
	});

	describe("FodderImporter", () => {
		it("imports fodder index and outputs market cycle phase and price tiers", async () => {
			const importer = new FodderImporter();
			const url = "https://www.futbin.com/market/fodder";
			const detected = detectFutUrlType(url);
			expect(importer.canHandle(detected)).toBe(true);

			const { result, action } = await importer.importAndAnalyze(url, detected);
			expect(result.fodderTiers.length).toBeGreaterThan(5);
			expect(result.disparityConsoleVsPc.averagePcPremiumPercent).toBeGreaterThan(0);
			expect(action.verdict).toBe("ACCUMULATE_FODDER_NOW");
		});
	});

	describe("MarketListingImporter", () => {
		it.skipIf(!hasFutDataset)("imports market search URL and identifies bargain snipes", async () => {
			const importer = new MarketListingImporter();
			const url = "https://www.futbin.com/27/players?position=CM";
			const detected = detectFutUrlType(url);
			expect(importer.canHandle(detected)).toBe(true);

			const { result, action } = await importer.importAndAnalyze(url, detected);
			expect(result.topBargains.length).toBeGreaterThan(0);
			expect(result.topBargains[0].roiPotential).toBeGreaterThan(0);
			expect(action.verdict).toBe("TOP_BARGAINS_AVAILABLE");
		});
	});

	describe("FutImporterRegistry", () => {
		it("dispatches URLs automatically to the appropriate importer", async () => {
			const detected = detectFutUrlType("https://www.futbin.com/market/fodder");
			const omni = await FutImporterRegistry.dispatch("https://www.futbin.com/market/fodder", detected);
			expect(omni.pageType).toBe("FODDER");
			expect(omni.action.verdict).toBe("ACCUMULATE_FODDER_NOW");
		});
	});
});
