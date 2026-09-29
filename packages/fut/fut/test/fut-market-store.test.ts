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

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MarketStore } from "../src/repository/MarketStore.ts";
import { extractAuctions } from "../src/extension/streamServer.ts";
import type { UtAuctionItem } from "../src/ea/types.ts";

function auction(over: Partial<UtAuctionItem> = {}): UtAuctionItem {
	return {
		tradeId: 1,
		assetId: 500,
		rating: 85,
		itemType: "player",
		rareflag: 1,
		preferredPosition: "ST",
		startingBid: 1000,
		currentBid: 1200,
		buyNowPrice: 2000,
		expires: 3600,
		tradeState: "active",
		...over,
	};
}

describe("MarketStore", () => {
	let store: MarketStore;

	beforeEach(() => {
		store = new MarketStore({ dbPath: ":memory:" });
	});
	afterEach(() => {
		store.close();
	});

	it("records auctions and counts them", () => {
		const inserted = store.recordAuctions(
			[auction({ tradeId: 1 }), auction({ tradeId: 2, buyNowPrice: 2500 })],
			"console",
			"search",
			1000,
		);
		expect(inserted).toBe(2);
		expect(store.count()).toBe(2);
	});

	it("ignores a duplicate sighting of the same auction at the same instant", () => {
		store.recordAuctions([auction({ tradeId: 7 })], "console", "search", 5000);
		const again = store.recordAuctions([auction({ tradeId: 7 })], "console", "search", 5000);
		expect(again).toBe(0);
		expect(store.count()).toBe(1);
	});

	it("keeps the same auction seen again later, so a climbing bid is followed", () => {
		store.recordAuctions([auction({ tradeId: 7, currentBid: 1200 })], "console", "search", 5000);
		store.recordAuctions([auction({ tradeId: 7, currentBid: 1600 })], "console", "search", 6000);
		expect(store.count()).toBe(2);
	});

	it("skips auctions carrying no definition id", () => {
		expect(store.recordAuctions([auction({ assetId: 0 })])).toBe(0);
		expect(store.count()).toBe(0);
	});

	it("reports the floor as the 10th percentile, not the single cheapest listing", () => {
		// One outlier at 100 must not become the floor for a market sitting at ~2000.
		const prices = [100, 1900, 1950, 2000, 2000, 2050, 2100, 2200, 2400, 3000];
		store.recordAuctions(
			prices.map((p, i) => auction({ tradeId: 100 + i, buyNowPrice: p })),
			"console",
			"search",
			1000,
		);
		const summary = store.getBinSummary(500);
		expect(summary).not.toBeNull();
		expect(summary?.sampleSize).toBe(10);
		expect(summary?.min).toBe(100);
		// The floor must climb well clear of the 100-coin outlier.
		expect(summary?.floor).toBeGreaterThan(1000);
		// Even sample: the median interpolates the two central values (2000, 2050).
		expect(summary?.median).toBe(2025);
		expect(summary?.max).toBe(3000);
	});

	it("returns null rather than a zero price when nothing was observed", () => {
		expect(store.getBinSummary(999)).toBeNull();
	});

	it("separates platforms", () => {
		store.recordAuctions([auction({ tradeId: 1, buyNowPrice: 2000 })], "console", "search", 1000);
		store.recordAuctions([auction({ tradeId: 2, buyNowPrice: 5000 })], "pc", "search", 1000);
		expect(store.getBinSummary(500, { platform: "console" })?.median).toBe(2000);
		expect(store.getBinSummary(500, { platform: "pc" })?.median).toBe(5000);
	});

	it("honours the time window", () => {
		const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
		store.recordAuctions([auction({ tradeId: 1 })], "console", "search", old);
		expect(store.getBinSummary(500, { sinceMs: 24 * 60 * 60 * 1000 })).toBeNull();
		expect(store.getBinSummary(500)).not.toBeNull();
	});

	it("stores and updates EA price bands", () => {
		store.recordPriceBand(500, 1000, 10000, 1);
		expect(store.getPriceBand(500)).toEqual({
			minPrice: 1000,
			maxPrice: 10000,
			updatedAt: 1,
		});
		store.recordPriceBand(500, 1200, 12000, 2);
		expect(store.getPriceBand(500)?.maxPrice).toBe(12000);
		expect(store.getPriceBand(404)).toBeNull();
	});

	it("ignores auctions with no buy-now price when summarizing", () => {
		store.recordAuctions(
			[auction({ tradeId: 1, buyNowPrice: 0 }), auction({ tradeId: 2, buyNowPrice: 3000 })],
			"console",
			"search",
			1000,
		);
		const summary = store.getBinSummary(500);
		expect(summary?.sampleSize).toBe(1);
		expect(summary?.median).toBe(3000);
	});
});

describe("extractAuctions (extension market capture)", () => {
	it("extracts auctions from an intercepted transfer-market body", () => {
		const auctions = extractAuctions({
			auctionInfo: [
				{
					tradeId: 901,
					itemData: { assetId: 231747, rating: 91, itemType: "player" },
					buyNowPrice: 45000,
					startingBid: 40000,
				},
			],
		});
		expect(auctions).toHaveLength(1);
		expect(auctions[0].assetId).toBe(231747);
		expect(auctions[0].buyNowPrice).toBe(45000);
	});

	it("drops entries with no usable definition id rather than storing a partial record", () => {
		const auctions = extractAuctions({
			auctionInfo: [
				{ tradeId: 1, itemData: {}, buyNowPrice: 999 },
				{ tradeId: 2, itemData: { assetId: 0 }, buyNowPrice: 999 },
				{ tradeId: 3, buyNowPrice: 999 },
				null,
				"not-an-object",
			],
		});
		expect(auctions).toHaveLength(0);
	});

	it("returns nothing for bodies that are not market responses", () => {
		expect(extractAuctions(null)).toHaveLength(0);
		expect(extractAuctions("plain text")).toHaveLength(0);
		expect(extractAuctions({ credits: 1000 })).toHaveLength(0);
		expect(extractAuctions({ auctionInfo: "nope" })).toHaveLength(0);
	});
});
