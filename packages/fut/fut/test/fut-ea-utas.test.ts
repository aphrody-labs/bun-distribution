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

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { hasFutDataset } from "./helpers/fut-dataset.ts";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	EaUtasClient,
	FutCoreService,
	type UtSessionData,
} from "../src/index.ts";

/**
 * Creates a lightweight mock of ImpersonatedClient to test EaUtasClient without live network.
 */
function createMockClient(
	handler: (url: string, opts?: any) => Promise<{ status: number; text: () => Promise<string>; json: () => Promise<any> }>,
) {
	return {
		fetch: handler,
	} as any;
}

describe("EaUtasClient (Native Web App & UTAS Controls)", () => {
	const testDir = join(tmpdir(), "bxc-fut-test-" + Math.random().toString(36).slice(2));
	const sessionFile = join(testDir, "test-ea-session.json");

	beforeEach(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(sessionFile)) {
			unlinkSync(sessionFile);
		}
	});

	it("initializes with default year 27 and resolves session file path", () => {
		const client = new EaUtasClient({ sessionPath: sessionFile });
		expect(client.sessionFilePath()).toBe(sessionFile);
		const status = client.getSessionStatus();
		expect(status.authenticated).toBe(false);
		expect(status.hasSid).toBe(false);
	});

	it("saves, loads, and clears session data to disk", () => {
		const client = new EaUtasClient({ sessionPath: sessionFile });
		const mockSession: UtSessionData = {
			sid: "11111111-2222-3333-4444-555555555555",
			phishingToken: "phish-test-99",
			nucleusId: "987654321",
			personaId: "12345",
			gameSku: "FFA27PS5",
			savedAt: new Date().toISOString(),
		};

		client.setSession(mockSession);
		expect(existsSync(sessionFile)).toBe(true);

		const readClient = new EaUtasClient({ sessionPath: sessionFile });
		const status = readClient.getSessionStatus();
		expect(status.authenticated).toBe(true);
		expect(status.hasSid).toBe(true);
		expect(status.phishingToken).toBe("phish-test-99");
		expect(status.nucleusId).toBe("987654321");
		expect(status.personaId).toBe("12345");
		expect(status.sidPreview).toContain("11111111");

		readClient.clearSession(true);
		expect(readClient.getSessionStatus().authenticated).toBe(false);
	});

	it("handles UTAS specific HTTP error codes (458 captcha, 470 credits, 478 expired)", async () => {
		const mockCaptchaClient = createMockClient(async () => {
			return { status: 458, text: async () => "", json: async () => ({}) };
		});
		const clientCaptcha = new EaUtasClient(
			{ sid: "valid-test-sid-uuid-0000-11112222", sessionPath: sessionFile },
			mockCaptchaClient,
		);
		await expect(clientCaptcha.bid(999, 5000)).rejects.toThrow("UTAS captcha required");

		const mockCreditsClient = createMockClient(async () => {
			return { status: 470, text: async () => "", json: async () => ({}) };
		});
		const clientCredits = new EaUtasClient(
			{ sid: "valid-test-sid-uuid-0000-11112222", sessionPath: sessionFile },
			mockCreditsClient,
		);
		await expect(clientCredits.bid(999, 5000)).rejects.toThrow("insufficient credits");

		const mockExpiredClient = createMockClient(async () => {
			return { status: 478, text: async () => "", json: async () => ({}) };
		});
		const clientExpired = new EaUtasClient(
			{ sid: "valid-test-sid-uuid-0000-11112222", sessionPath: sessionFile },
			mockExpiredClient,
		);
		await expect(clientExpired.bid(999, 5000)).rejects.toThrow("no longer available");
	});

	it("fetches user mass info and maps deck limits and currencies", async () => {
		const mockResponse = {
			userInfo: {
				personaId: 445566,
				personaName: "AphrodyFC",
				clubName: "Olympique Aphrody",
				clubAbbr: "APH",
				credits: 450200,
				established: 1726000000,
				divisionOffline: 3,
				currencies: [
					{ name: "COINS", funds: 450200, finalFunds: 450200 },
					{ name: "POINTS", funds: 1600, finalFunds: 1600 },
				],
				pileSizeClientData: {
					entries: [
						{ key: 2, value: 100 },
						{ key: 4, value: 50 },
						{ key: 6, value: 50 },
					],
				},
				unassignedPileSize: 4,
			},
		};

		const mockClient = createMockClient(async (url) => {
			expect(url).toContain("/ut/game/fc27/usermassinfo");
			return {
				status: 200,
				text: async () => JSON.stringify(mockResponse),
				json: async () => mockResponse,
			};
		});

		const client = new EaUtasClient(
			{ sid: "mock-sid-uuid", sessionPath: sessionFile },
			mockClient,
		);

		const mass = await client.getUserMassInfo();
		expect(mass.userInfo.personaName).toBe("AphrodyFC");
		expect(mass.userInfo.clubName).toBe("Olympique Aphrody");
		expect(mass.userInfo.credits).toBe(450200);
		expect(mass.userInfo.points).toBe(1600);
		expect(mass.deckLimits.tradePileLimit).toBe(100);
		expect(mass.unassignedPileSize).toBe(4);
	});

	it("fetches trade pile and watch list auctions with live credit balances", async () => {
		const mockPile = {
			credits: 320000,
			total: 2,
			auctionInfo: [
				{
					tradeId: 1001,
					itemData: { assetId: 231747, rating: 91, itemType: "player", rareflag: 1, preferredPosition: "ST" },
					startingBid: 100000,
					currentBid: 120000,
					buyNowPrice: 150000,
					expires: 3600,
					tradeState: "active",
				},
			],
		};

		const mockClient = createMockClient(async (url) => {
			if (url.includes("/tradepile")) {
				return { status: 200, text: async () => JSON.stringify(mockPile), json: async () => mockPile };
			}
			if (url.includes("/watchlist")) {
				return { status: 200, text: async () => JSON.stringify(mockPile), json: async () => mockPile };
			}
			return { status: 404, text: async () => "", json: async () => ({}) };
		});

		const client = new EaUtasClient({ sid: "mock-sid", sessionPath: sessionFile }, mockClient);
		const tradepile = await client.getTradePile();
		expect(tradepile.items.length).toBe(1);
		expect(tradepile.items[0].tradeId).toBe(1001);
		expect(tradepile.items[0].rating).toBe(91);
		expect(tradepile.credits).toBe(320000);

		const watchlist = await client.getWatchList();
		expect(watchlist.items.length).toBe(1);
	});

	it("executes bidding, buy now, listing, relisting, moving and quick sell", async () => {
		let capturedMethod = "";
		let capturedUrl = "";
		let capturedBody: any = null;

		const mockClient = createMockClient(async (url, opts) => {
			capturedUrl = url;
			capturedMethod = opts?.method ?? "GET";
			capturedBody = opts?.body ? JSON.parse(opts.body) : null;

			if (url.includes("/bid")) {
				return {
					status: 200,
					text: async () => JSON.stringify({
						credits: 200000,
						auctionInfo: [{ tradeId: 555, bidState: "highest", currentBid: capturedBody?.bid, tradeState: "active" }],
					}),
					json: async () => ({}),
				};
			}
			if (url.includes("/auctionhouse/relist")) {
				return {
					status: 200,
					text: async () => JSON.stringify({ tradeIdList: [701, 702] }),
					json: async () => ({}),
				};
			}
			if (url.includes("/auctionhouse")) {
				return {
					status: 200,
					text: async () => JSON.stringify({ id: 8888, tradeId: 9999 }),
					json: async () => ({}),
				};
			}
			if (url.includes("/item?itemIds=")) {
				return {
					status: 200,
					text: async () => JSON.stringify({ totalCredits: 1450, items: [123] }),
					json: async () => ({}),
				};
			}
			if (url.includes("/item")) {
				return {
					status: 200,
					text: async () => JSON.stringify({ itemData: [{ id: 123, success: true }] }),
					json: async () => ({}),
				};
			}

			return { status: 200, text: async () => "{}", json: async () => ({}) };
		});

		const client = new EaUtasClient({ sid: "mock-sid", sessionPath: sessionFile }, mockClient);

		// 1. Bid / Buy Now
		const bidRes = await client.bid(555, 45000);
		expect(capturedMethod).toBe("PUT");
		expect(capturedUrl).toContain("/trade/555/bid");
		expect(capturedBody.bid).toBe(45000);
		expect(bidRes.success).toBe(true);
		expect(bidRes.currentBid).toBe(45000);

		const buyRes = await client.buyNow(555, 60000);
		expect(capturedBody.bid).toBe(60000);
		expect(buyRes.success).toBe(true);

		// 2. Listing on market
		const listRes = await client.listOnMarket({
			itemId: 12345,
			startingBid: 1000,
			buyNowPrice: 2500,
			durationSeconds: 3600,
		});
		expect(capturedMethod).toBe("POST");
		expect(capturedUrl).toContain("/auctionhouse");
		expect(capturedBody.itemData.id).toBe(12345);
		expect(capturedBody.buyNowPrice).toBe(2500);
		expect(listRes.success).toBe(true);

		// 3. Relisting
		const relistRes = await client.relistAll();
		expect(capturedMethod).toBe("PUT");
		expect(capturedUrl).toContain("/auctionhouse/relist");
		expect(relistRes.tradeIdList).toEqual([701, 702]);

		// 4. Moving items (club / trade)
		const moveRes = await client.sendToClub(123);
		expect(capturedMethod).toBe("PUT");
		expect(capturedUrl).toContain("/item");
		expect(capturedBody.itemData[0]).toEqual({ id: 123, pile: "club" });
		expect(moveRes.success).toBe(true);

		const tradeMoveRes = await client.sendToTradepile(123);
		expect(capturedBody.itemData[0]).toEqual({ id: 123, pile: "trade" });
		expect(tradeMoveRes.success).toBe(true);

		// 5. Quick sell
		const quickRes = await client.quickSellItem(123);
		expect(capturedMethod).toBe("DELETE");
		expect(capturedUrl).toContain("/item?itemIds=123");
		expect(quickRes.totalCredits).toBe(1450);
	});

	it.skipIf(!hasFutDataset)("integrates seamlessly through FutCoreService", async () => {
		const service = new FutCoreService();
		const mockClient = createMockClient(async (url) => {
			if (url.includes("/usermassinfo")) {
				return {
					status: 200,
					text: async () => JSON.stringify({
						userInfo: { personaName: "AphrodyLead", credits: 999999 },
					}),
					json: async () => ({}),
				};
			}
			return { status: 200, text: async () => "{}", json: async () => ({}) };
		});

		const utasClient = service.getUtasClient({ sid: "core-mock-sid", sessionPath: sessionFile }, mockClient);
		expect(utasClient).toBeDefined();

		const mass = await service.getUserMassInfo();
		expect(mass.userInfo.personaName).toBe("AphrodyLead");
		expect(mass.userInfo.credits).toBe(999999);
		service.close();
	});
});
