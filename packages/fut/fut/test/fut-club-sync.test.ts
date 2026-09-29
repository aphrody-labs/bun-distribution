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
	generateWebAppBookmarklet,
	analyzeClubInventory,
	type UtClubPlayerItem,
} from "../src/index.ts";

describe("EA Club Linking & Web App Ingestion", () => {
	it("generates a valid, self-contained javascript bookmarklet", () => {
		const bookmarklet = generateWebAppBookmarklet();
		expect(bookmarklet).toStartWith("javascript:");
		expect(bookmarklet).toContain("utas.mob.v1.prd.futc-ext.gcp.ea.com");
		expect(bookmarklet).toContain("bxc_club_fc27.json");
		expect(bookmarklet).toContain("X-UT-SID");
		expect(bookmarklet).toContain("ut_session");
	});

	it.skipIf(!hasFutDataset)("accurately analyzes club inventory valuation, fodder distribution and untradeables", () => {
		const mockPlayers: UtClubPlayerItem[] = [
			{
				id: 101,
				assetId: 231747,
				resourceId: 231747,
				rating: 91,
				itemType: "player",
				rareflag: 1,
				preferredPosition: "ST",
				nation: 18,
				leagueId: 53,
				teamid: 243,
				untradeable: false,
				discardValue: 10000,
				name: "Kylian Mbappé",
			},
			{
				id: 102,
				assetId: 209981,
				resourceId: 209981,
				rating: 88,
				itemType: "player",
				rareflag: 1,
				preferredPosition: "CDM",
				nation: 18,
				leagueId: 53,
				teamid: 243,
				untradeable: true,
				discardValue: 0,
				name: "Aurélien Tchouaméni",
			},
			{
				id: 103,
				assetId: 239085,
				resourceId: 239085,
				rating: 85,
				itemType: "player",
				rareflag: 1,
				preferredPosition: "LW",
				nation: 45,
				leagueId: 53,
				teamid: 243,
				untradeable: false,
				discardValue: 700,
				name: "Rodrygo",
			},
			{
				id: 104,
				assetId: 241096,
				resourceId: 241096,
				rating: 84,
				itemType: "player",
				rareflag: 1,
				preferredPosition: "CAM",
				nation: 13,
				leagueId: 13,
				teamid: 1,
				untradeable: true,
				discardValue: 0,
				name: "Cole Palmer",
			},
			{
				id: 105,
				assetId: 200104,
				resourceId: 200104,
				rating: 83,
				itemType: "player",
				rareflag: 1,
				preferredPosition: "CB",
				nation: 18,
				leagueId: 53,
				teamid: 243,
				untradeable: false,
				discardValue: 500,
				name: "Ferland Mendy",
			},
		];

		const summary = analyzeClubInventory(mockPlayers);

		expect(summary.totalPlayers).toBe(5);
		expect(summary.tradeableCount).toBe(3);
		expect(summary.untradeableCount).toBe(2);

		// Fodder counts
		expect(summary.fodderCountByRating[91]).toBe(1);
		expect(summary.fodderCountByRating[88]).toBe(1);
		expect(summary.fodderCountByRating[85]).toBe(1);
		expect(summary.fodderCountByRating[84]).toBe(1);
		expect(summary.fodderCountByRating[83]).toBe(1);
		expect(summary.fodderCountByRating[86]).toBe(0);

		// Valuation: only tradeable cards contribute to coin value
		expect(summary.estimatedTotalValueCoins.console).toBeGreaterThan(0);
		expect(summary.estimatedTotalValueCoins.pc).toBeGreaterThan(summary.estimatedTotalValueCoins.console);

		// Untradeable cards have 0 coin tradeable value
		const tchouameni = summary.topCards.find((c) => c.id === 102);
		expect(tchouameni).toBeDefined();
		expect(tchouameni?.untradeable).toBe(true);
		expect(tchouameni?.estimatedPriceConsole).toBe(0);

		// Tradeable cards have non-zero value
		const mbappe = summary.topCards.find((c) => c.id === 101);
		expect(mbappe).toBeDefined();
		expect(mbappe?.untradeable).toBe(false);
		expect(mbappe?.estimatedPriceConsole).toBeGreaterThan(150000);
	});
});
