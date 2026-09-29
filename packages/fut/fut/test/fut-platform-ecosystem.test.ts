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
	UniversalFutScraper,
	MassiveFutCrawler,
	FutCoreService,
	FutUnifiedApi,
	renderCardOverlayBadge,
	buildContentScriptBundle,
	DiscordEmbedBuilder,
	XPostBuilder,
	FutNewsBot,
} from "../src/index.ts";

describe("Unified FUT Platform Ecosystem (Scrapers, Crawlers, API, Extension, Bots)", () => {
	describe("UniversalFutScraper", () => {
		it.skipIf(!hasFutDataset)("scrapes player from FUTBin or fallback with complete stats", async () => {
			const scraper = new UniversalFutScraper();
			const player = await scraper.scrapePlayer("https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves");
			scraper.close();

			expect(player.name).toBeDefined();
			expect(player.overallRating).toBeGreaterThanOrEqual(80);
			expect(player.faceStats.pac).toBeGreaterThan(0);
			expect(player.priceConsole).toBeGreaterThan(0);
			expect(player.provider).toBe("FUTBIN");
		});

		it.skipIf(!hasFutDataset)("scrapes SBC, Evolution, Squad, and Fodder from universal endpoints", async () => {
			const scraper = new UniversalFutScraper();
			const sbc = await scraper.scrapeSbc("https://www.fut.gg/sbc/potm-mbappe/");
			const evo = await scraper.scrapeEvolution("https://www.fut.gg/evolutions/27-relentless-winger/");
			const squad = await scraper.scrapeSquad("https://www.futbin.com/27/squad/123456");
			const fodder = await scraper.scrapeFodder("https://www.futbin.com/market/fodder");
			scraper.close();

			expect(sbc.challenges.length).toBeGreaterThan(0);
			expect(evo.upgrades.length).toBeGreaterThan(0);
			expect(squad.starters.length).toBe(11);
			expect(fodder.tiers.length).toBeGreaterThan(5);
		});
	});

	describe("MassiveFutCrawler", () => {
		it.skipIf(!hasFutDataset)("initializes queue, deduplicates seeds, and processes crawl targets", async () => {
			const crawler = new MassiveFutCrawler({
				concurrency: 2,
				maxPages: 3,
			});

			crawler.addSeed("https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves", 10);
			crawler.addSeed("https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves", 10); // Duplicate seed
			crawler.addSeed("https://www.fut.gg/evolutions/27-relentless-winger/", 5);
			crawler.addSeed("https://www.futbin.com/market/fodder", 1);

			const stats = await crawler.start();
			crawler.close();

			expect(stats.crawled).toBeGreaterThanOrEqual(1);
			expect(stats.success).toBeGreaterThanOrEqual(1);
		});
	});

	describe("FutCoreService (Unified Single Source of Truth)", () => {
		it.skipIf(!hasFutDataset)("provides single entry point for player, sbc, squad, and fodder queries", async () => {
			const service = new FutCoreService();
			const player = await service.getPlayerAnalysis("https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves");
			const sbc = await service.getSbcSolution(86);
			const fodder = service.getFodderMarket();
			service.close();

			expect(player.playerData.name).toBeDefined();
			expect(sbc.cheapestFodderStructure.recommendedRatings.length).toBeGreaterThan(0);
			expect(fodder.fodderTiers.length).toBeGreaterThan(5);
		});
	});

	describe("FutUnifiedApi (HTTP Request Handler)", () => {
		it.skipIf(!hasFutDataset)("serves REST API health check and routes correctly", async () => {
			const api = new FutUnifiedApi();

			// Health route
			const healthRes = await api.handleRequest(new Request("http://localhost:3000/api/fut/health"));
			expect(healthRes.status).toBe(200);
			const healthJson = await healthRes.json();
			expect(healthJson.status).toBe("OK");

			// Fodder route
			const fodderRes = await api.handleRequest(new Request("http://localhost:3000/api/fut/fodder"));
			expect(fodderRes.status).toBe(200);
			const fodderJson = await fodderRes.json();
			expect(fodderJson.fodderTiers.length).toBeGreaterThan(5);

			// SBC Solve route
			const sbcRes = await api.handleRequest(
				new Request("http://localhost:3000/api/fut/sbc/solve", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ targetRating: 85 }),
				}),
			);
			expect(sbcRes.status).toBe(200);
			const sbcJson = await sbcRes.json();
			expect(sbcJson.cheapestFodderStructure.recommendedRatings.length).toBeGreaterThan(0);

			// Native UTAS route
			const utasRes = await api.handleRequest(new Request("http://localhost:3000/api/fut/ut/session"));
			expect(utasRes.status).toBe(200);
			const utasJson = await utasRes.json();
			expect(utasJson.authenticated).toBeDefined();

			api.close();
		});
	});

	describe("Chrome Extension Overlay Bridge", () => {
		it("generates card badge overlay markup and content script bundle", () => {
			const badge = renderCardOverlayBadge({
				playerId: "27-1001",
				playerName: "Mbappe",
				rating: 91,
				livePriceConsole: 3450000,
				livePricePc: 4100000,
				metaRating: 96.5,
				verdict: "HOLD",
			});

			expect(badge).toContain("bxc-fut-card-badge");
			expect(badge).toContain("PS: 3,450,000");
			expect(badge).toContain("HOLD");

			const bundle = buildContentScriptBundle();
			expect(bundle).toContain("MutationObserver");
			expect(bundle).toContain("ut-item-view");
		});
	});

	describe("Live Discord & X News Bots", () => {
		it.skipIf(!hasFutDataset)("formats Discord webhook embed and viral X post from OmniUrlResult", async () => {
			const service = new FutCoreService();
			const omni = await service.parseAnyUrl("https://www.futbin.com/27/player/97/joao-pedro-goncalves-neves", {
				livePriceConsole: 17000,
			});
			service.close();

			const bot = new FutNewsBot();
			const alert = bot.formatAlert(omni);
			bot.close();

			expect(alert.discordPayload.username).toBe("BXC FUT Alert Bot");
			expect(alert.discordPayload.embeds[0].title).toBeDefined();
			expect(alert.discordPayload.embeds[0].fields.length).toBeGreaterThan(2);

			expect(alert.xPostText).toContain("FLASH FUT ALERTE");
			expect(alert.xPostText).toContain("#FC27");

			const directEmbed = DiscordEmbedBuilder.buildFromOmniResult(omni);
			expect(directEmbed.username).toBe("BXC FUT Alert Bot");

			const directXPost = XPostBuilder.buildFromOmniResult(omni);
			expect(directXPost).toContain("#FUTTrading");
		});
	});
});
