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
	detectFutUrlType,
	handleAnyFutUrl,
} from "../src/router/index.ts";

describe("Omni-URL Router & Universal FUT Page Analyzer", () => {
	describe("URL Type Detection & Pattern Matching (detectFutUrlType)", () => {
		it("correctly identifies FUT.GG and FUTBin Player Detail URLs", () => {
			const futGgPlayer = detectFutUrlType(
				"https://www.fut.gg/players/272834-joao-neves/27-272834/",
			);
			expect(futGgPlayer.provider).toBe("FUTGG");
			expect(futGgPlayer.pageType).toBe("PLAYER");
			expect(futGgPlayer.identifier).toBe("272834");
			expect(futGgPlayer.slug).toBe("joao-neves");

			const futbinPlayer = detectFutUrlType(
				"https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves",
			);
			expect(futbinPlayer.provider).toBe("FUTBIN");
			expect(futbinPlayer.pageType).toBe("PLAYER");
			expect(futbinPlayer.gameYear).toBe("27");
			expect(futbinPlayer.identifier).toBe("97");
			expect(futbinPlayer.slug).toBe("joao-pedro-goncalves-neves");
		});

		it("correctly identifies SBC and Challenge URLs", () => {
			const futGgSbc = detectFutUrlType("https://www.fut.gg/sbc/27-icon-upgrade/");
			expect(futGgSbc.provider).toBe("FUTGG");
			expect(futGgSbc.pageType).toBe("SBC");
			expect(futGgSbc.slug).toBe("icon-upgrade");

			const futbinSbc = detectFutUrlType(
				"https://www.futbin.com/27/squad-building-challenges/EA/512",
			);
			expect(futbinSbc.provider).toBe("FUTBIN");
			expect(futbinSbc.pageType).toBe("SBC");
			expect(futbinSbc.identifier).toBe("512");
		});

		it("correctly identifies Squad Builder and Community Squad URLs", () => {
			const futbinSquad = detectFutUrlType("https://www.futbin.com/27/squad/987654");
			expect(futbinSquad.provider).toBe("FUTBIN");
			expect(futbinSquad.pageType).toBe("SQUAD");
			expect(futbinSquad.identifier).toBe("987654");

			const futGgSquad = detectFutUrlType("https://www.fut.gg/squad-builder/456123/");
			expect(futGgSquad.provider).toBe("FUTGG");
			expect(futGgSquad.pageType).toBe("SQUAD");
			expect(futGgSquad.identifier).toBe("456123");
		});

		it("correctly identifies Evolution Hub and Detail URLs", () => {
			const futGgEvo = detectFutUrlType("https://www.fut.gg/evolutions/27-relentless-winger/");
			expect(futGgEvo.provider).toBe("FUTGG");
			expect(futGgEvo.pageType).toBe("EVOLUTION");
			// The year prefix is kept: FutEvolutionsClient builds /evolutions/<slug>/
			// directly, so dropping it would produce a 404.
			expect(futGgEvo.slug).toBe("27-relentless-winger");

			const futbinEvo = detectFutUrlType("https://www.futbin.com/27/evolutions");
			expect(futbinEvo.provider).toBe("FUTBIN");
			expect(futbinEvo.pageType).toBe("EVOLUTION");
		});

		it("extracts the set slug from a nested SBC category URL", () => {
			// fut.gg nests sets under a category; the last segment is the set, and
			// the year prefix is dropped because getSetDetail() takes gameYear apart.
			const nested = detectFutUrlType("https://www.fut.gg/sbc/upgrades/27-6-gold-upgrade/");
			expect(nested.pageType).toBe("SBC");
			expect(nested.slug).toBe("6-gold-upgrade");

			const flat = detectFutUrlType("https://www.fut.gg/sbc/27-icon-upgrade/");
			expect(flat.slug).toBe("icon-upgrade");

			// Hub and challenge-id URLs name no set.
			expect(detectFutUrlType("https://www.fut.gg/sbc/").slug).toBeUndefined();
			expect(detectFutUrlType("https://www.fut.gg/sbc/challenge/123/").slug).toBeUndefined();

			// FUTBin keeps using the numeric identifier.
			const futbin = detectFutUrlType("https://www.futbin.com/squad-building-challenges/EA/512");
			expect(futbin.identifier).toBe("512");
		});

		it("correctly identifies Fodder Index and Market Listing URLs", () => {
			const futbinMarket = detectFutUrlType("https://www.futbin.com/market/fodder");
			expect(futbinMarket.provider).toBe("FUTBIN");
			expect(futbinMarket.pageType).toBe("FODDER");

			const futGgFodder = detectFutUrlType("https://www.fut.gg/fodder/");
			expect(futGgFodder.provider).toBe("FUTGG");
			expect(futGgFodder.pageType).toBe("FODDER");

			const futbinListing = detectFutUrlType(
				"https://www.futbin.com/27/players?page=2&position=ST&min_rating=85",
			);
			expect(futbinListing.provider).toBe("FUTBIN");
			expect(futbinListing.pageType).toBe("MARKET_LISTING");
			expect(futbinListing.queryParams["position"]).toBe("ST");
			expect(futbinListing.queryParams["min_rating"]).toBe("85");
		});
	});

	describe("Universal Execution Pipeline (handleAnyFutUrl)", () => {
		it.skipIf(!hasFutDataset)("handles PLAYER URL with dual platform prediction, meta rating, and market anomaly", async () => {
			const url = "https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves";
			const result = await handleAnyFutUrl(url, {
				livePriceConsole: 17000,
				referenceDate: new Date(2026, 8, 18),
			});

			expect(result.pageType).toBe("PLAYER");
			expect(result.provider).toBe("FUTBIN");
			expect(result.action.urgency).toBe("CRITICAL");
			expect(result.action.verdict).toBe("HOLD_ABSOLUTE");
			expect(result.action.concreteSteps.length).toBeGreaterThan(0);

			const playerPayload = result.extractedData as any;
			expect(playerPayload.prediction).toBeDefined();
			expect(playerPayload.prediction.overallRating).toBe(88);
			expect(playerPayload.prediction.console.currentLivePrice).toBe(17000);
			expect(playerPayload.prediction.pc.currentLivePrice).toBeGreaterThan(17000);
		});

		it("handles SBC URL with profitability analysis and cheapest fodder structure", async () => {
			const url = "https://www.fut.gg/sbc/27-icon-upgrade/";
			const result = await handleAnyFutUrl(url);

			expect(result.pageType).toBe("SBC");
			expect(result.provider).toBe("FUTGG");
			expect(result.action.verdict).toBeDefined();

			const sbcPayload = result.extractedData as any;
			expect(sbcPayload.sbcData.estimatedCostConsole).toBeGreaterThan(0);
			expect(sbcPayload.cheapestFodderStructure.recommendedRatings.length).toBeGreaterThan(0);
			expect(sbcPayload.profitabilityAnalysis.isProfitable).toBeDefined();
		});

		it.skipIf(!hasFutDataset)("handles SQUAD URL with weak link identification and tactical instructions", async () => {
			const url = "https://www.futbin.com/27/squad/123456";
			const result = await handleAnyFutUrl(url);

			expect(result.pageType).toBe("SQUAD");
			expect(result.action.verdict).toBe("UPGRADE_WEAK_LINK");

			const squadPayload = result.extractedData as any;
			expect(squadPayload.squadData.totalChemistry).toBeGreaterThanOrEqual(30);
			expect(squadPayload.weakLinks.length).toBeGreaterThan(0);
			expect(squadPayload.recommendedUpgrades.length).toBeGreaterThan(0);
		});

		it.skipIf(!hasFutDataset)("handles EVOLUTION URL with database scan for best candidates", async () => {
			const url = "https://www.fut.gg/evolutions/27-relentless-winger/";
			const result = await handleAnyFutUrl(url);

			expect(result.pageType).toBe("EVOLUTION");
			expect(result.action.verdict).toBe("TOP_EVO_CANDIDATE_IDENTIFIED");

			const evoPayload = result.extractedData as any;
			expect(evoPayload.topDatabaseCandidates.length).toBeGreaterThan(0);
			const firstCandidate = evoPayload.topDatabaseCandidates[0];
			expect(firstCandidate.projectedMetaRating).toBeGreaterThan(firstCandidate.currentMetaRating);
		});

		it("handles FODDER URL with market timing advisory and price tiers", async () => {
			const url = "https://www.futbin.com/market/fodder";
			const result = await handleAnyFutUrl(url);

			expect(result.pageType).toBe("FODDER");
			expect(result.action.verdict).toBe("ACCUMULATE_FODDER_NOW");

			const fodderPayload = result.extractedData as any;
			expect(fodderPayload.fodderTiers.length).toBeGreaterThan(5);
			expect(fodderPayload.disparityConsoleVsPc.averagePcPremiumPercent).toBeGreaterThan(0);
		});

		it.skipIf(!hasFutDataset)("handles MARKET_LISTING URL with bargain hunting scan", async () => {
			const url = "https://www.futbin.com/27/players?page=1&position=ST";
			const result = await handleAnyFutUrl(url, { budgetCoins: 100000 });

			expect(result.pageType).toBe("MARKET_LISTING");
			expect(result.action.verdict).toBe("TOP_BARGAINS_AVAILABLE");

			const listingPayload = result.extractedData as any;
			expect(listingPayload.topBargains.length).toBeGreaterThan(0);
		});
	});
});
