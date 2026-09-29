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
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	buildChromeExtension,
	captureDomSnapshot,
	classifyUtasEndpoint,
	filterEaSessionCookies,
	FutWebappMcpBridge,
	FutWebappStreamServer,
	generateBackgroundScriptSource,
	generateContentScriptSource,
	generatePageHookScript,
	type ExtensionStreamPacket,
	type StoredEaCookie,
} from "../src/index.ts";

describe("Chrome Extension MV3, Live UTAS Streaming & Remote MCP Bridge", () => {
	describe("Main World Page Hook & UTAS Endpoint Classifier", () => {
		it("generates complete, valid page hook script for world: MAIN", () => {
			const script = generatePageHookScript();
			expect(script).toContain("window.__BXC_HOOK_INITIALIZED__");
			expect(script).toContain("window.fetch");
			expect(script).toContain("XMLHttpRequest.prototype.open");
			expect(script).toContain("__BXC_UTAS_EVENT__");
			expect(script).toContain("__BXC_WEBAPP_COMMAND__");
			expect(script).toContain("__BXC_WEBAPP_RESPONSE__");
			expect(script).toContain("window.services");
		});

		it("accurately classifies UTAS API URLs into typed event categories", () => {
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/user/accountinfo", "GET")).toBe(
				"USER_INFO",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/transfermarket?num=20", "GET")).toBe(
				"MARKET_SEARCH",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/trade/12345/bid", "PUT")).toBe(
				"ITEM_BID",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/auctionhouse", "POST")).toBe(
				"ITEM_LIST",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/club/stats", "GET")).toBe(
				"CLUB_ITEMS",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/sbc/sets", "GET")).toBe(
				"SBC_SETS",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/sbc/challenge/44", "POST")).toBe(
				"SBC_SUBMIT",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/store/purchase/pack", "POST")).toBe(
				"PACK_OPEN",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/purchased/items", "GET")).toBe(
				"UNASSIGNED_ITEMS",
			);
			expect(classifyUtasEndpoint("https://utas.mob.v4.ea.com/ut/game/fc27/objectives", "GET")).toBe(
				"OBJECTIVES",
			);
		});
	});

	describe("Content Script, DOM Streaming & Session Cookies Filter", () => {
		it("captures DOM snapshot and detects active screen accurately", () => {
			const mockDoc = {
				location: { href: "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/transfers" },
				title: "EA SPORTS FC™ 27 Web App - Transfer Market",
				documentElement: { outerHTML: "<html><body><div class='ut-market'>Market View</div></body></html>" },
				styleSheets: [{}, {}],
				querySelectorAll: () => [{}, {}, {}, {}],
			};

			const snapshot = captureDomSnapshot(mockDoc as any);
			expect(snapshot.url).toBe("https://www.ea.com/ea-sports-fc/ultimate-team/web-app/transfers");
			expect(snapshot.title).toContain("EA SPORTS FC™ 27");
			expect(snapshot.activeScreen).toBe("TRANSFERS");
			expect(snapshot.cssRulesCount).toBe(2);
			expect(snapshot.domNodeCount).toBe(4);
			expect(snapshot.html).toContain("Market View");
		});

		it("generates isolated world content script bundle", () => {
			const cs = generateContentScriptSource();
			expect(cs).toContain("__BXC_UTAS_EVENT__");
			expect(cs).toContain("__BXC_WEBAPP_RESPONSE__");
			expect(cs).toContain("chrome.runtime.sendMessage");
			expect(cs).toContain("EXECUTE_AGENT_COMMAND");
		});

		it("generates background service worker script", () => {
			const bg = generateBackgroundScriptSource();
			expect(bg).toContain("WebSocket");
			expect(bg).toContain("SESSION_SYNC");
			expect(bg).toContain("chrome.cookies.getAll");
			expect(bg).toContain("AGENT_COMMAND");
		});

		it("filters sensitive EA session cookies exclusively", () => {
			const rawCookies: StoredEaCookie[] = [
				{ name: "PLAY_SESSION", value: "ps_12345", domain: ".ea.com", path: "/", secure: true, httpOnly: true },
				{ name: "ea_auth_sid", value: "sid_token_abc", domain: ".ea.com", path: "/", secure: true, httpOnly: true },
				{ name: "google_analytics_id", value: "ga_xyz", domain: ".ea.com", path: "/", secure: false, httpOnly: false },
				{ name: "EASW_KEY", value: "easw_987", domain: ".ea.com", path: "/", secure: true, httpOnly: true },
				{ name: "ad_tracker", value: "trk_0", domain: ".ea.com", path: "/", secure: false, httpOnly: false },
			];

			const filtered = filterEaSessionCookies(rawCookies);
			expect(filtered.length).toBe(3);
			const names = filtered.map((c) => c.name);
			expect(names).toContain("PLAY_SESSION");
			expect(names).toContain("ea_auth_sid");
			expect(names).toContain("EASW_KEY");
			expect(names).not.toContain("google_analytics_id");
			expect(names).not.toContain("ad_tracker");
		});
	});

	describe("Chrome Extension Unpacked Directory Builder", () => {
		it("builds complete standalone MV3 extension folder with manifest, scripts and popup", () => {
			const testOutputDir = join(import.meta.dir, "../scratch/test_extension_build");
			const output = buildChromeExtension({ outputDir: testOutputDir });

			expect(output).toBe(testOutputDir);
			expect(existsSync(join(testOutputDir, "manifest.json"))).toBe(true);
			expect(existsSync(join(testOutputDir, "pageHook.js"))).toBe(true);
			expect(existsSync(join(testOutputDir, "contentScript.js"))).toBe(true);
			expect(existsSync(join(testOutputDir, "background.js"))).toBe(true);
			expect(existsSync(join(testOutputDir, "popup.html"))).toBe(true);
			expect(existsSync(join(testOutputDir, "popup.js"))).toBe(true);
			expect(existsSync(join(testOutputDir, "overlay.css"))).toBe(true);

			const manifest = JSON.parse(readFileSync(join(testOutputDir, "manifest.json"), "utf-8"));
			expect(manifest.manifest_version).toBe(3);
			expect(manifest.permissions).toContain("cookies");
			expect(manifest.permissions).toContain("storage");

			// Clean up
			rmSync(testOutputDir, { recursive: true, force: true });
		});
	});

	describe("FutWebappStreamServer & Remote Agent Execution", () => {
		it("starts server, receives live telemetry via WebSocket and executes agent commands", async () => {
			// Ephemeral loopback port: a fixed port collides with concurrent runs
			// (parallel agents / Windows reserved ranges) and yields "Failed to connect".
			const streamServer = new FutWebappStreamServer({ port: 0, hostname: "127.0.0.1" });
			const serverPort = streamServer.start().port;

			// 1. Initial State
			const initialLiveState = streamServer.getLiveState();
			expect(initialLiveState.connected).toBe(false);

			// 2. Connect client WebSocket simulating the Chrome extension
			const clientWs = new WebSocket(`ws://127.0.0.1:${serverPort}/fut/stream`);
			await new Promise<void>((resolve, reject) => {
				clientWs.onopen = () => resolve();
				clientWs.onerror = (e) => reject(e);
			});

			// 3. Send SESSION_SYNC packet
			const sessionPacket: ExtensionStreamPacket = {
				version: "1.0.0",
				type: "SESSION_SYNC",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					cookies: [
						{ name: "PLAY_SESSION", value: "live_session_123", domain: ".ea.com", path: "/", secure: true, httpOnly: true },
					],
				},
			};
			clientWs.send(JSON.stringify(sessionPacket));

			// 4. Send UTAS_EVENT packet
			const utasPacket: ExtensionStreamPacket = {
				version: "1.0.0",
				type: "UTAS_EVENT",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					utasEvent: {
						id: "evt_test_1",
						type: "USER_INFO",
						url: "https://utas.mob.v4.ea.com/ut/game/fc27/user/accountinfo",
						method: "GET",
						requestHeaders: {},
						responseStatus: 200,
						responseBody: { personaName: "Aphrody_FC", coins: 450000 },
						timestamp: Date.now(),
					},
				},
			};
			clientWs.send(JSON.stringify(utasPacket));

			// 5. Send DOM_SNAPSHOT packet
			const domPacket: ExtensionStreamPacket = {
				version: "1.0.0",
				type: "DOM_SNAPSHOT",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					domSnapshot: {
						url: "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/transfers",
						title: "EA Web App Transfers",
						html: "<div class='market-results'>Mock Live Search Results</div>",
						cssRulesCount: 15,
						domNodeCount: 120,
						timestamp: Date.now(),
						activeScreen: "TRANSFERS",
					},
				},
			};
			clientWs.send(JSON.stringify(domPacket));

			// 5b. Send UTAS_SESSION packet (captured X-UT-SID UUID)
			const sessionCapturePacket: ExtensionStreamPacket = {
				version: "1.0.0",
				type: "UTAS_SESSION",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					session: {
						sid: "captured-uuid-11223344",
						phishingToken: "pt-live-0",
						personaId: "88888",
						personaName: "Aphrody_FC",
						capturedAt: Date.now(),
						source: "HEADER",
					},
				},
			};
			clientWs.send(JSON.stringify(sessionCapturePacket));

			// Small tick to allow WebSocket message processing
			await new Promise((r) => setTimeout(r, 100));

			const updatedState = streamServer.getLiveState();
			expect(updatedState.connected).toBe(true);
			expect(updatedState.personaName).toBe("Aphrody_FC");
			expect(updatedState.coins).toBe(450000);
			expect(updatedState.activeScreen).toBe("TRANSFERS");
			expect(updatedState.cookiesCount).toBe(1);
			expect(updatedState.lastSession?.sid).toBe("captured-uuid-11223344");

			// 6. Test bidirectional Agent Command Execution
			// Setup client listener to answer the command
			clientWs.onmessage = (ev) => {
				const packet = JSON.parse(String(ev.data)) as ExtensionStreamPacket;
				if (packet.type === "AGENT_COMMAND" && packet.data.command) {
					const cmd = packet.data.command;
					const reply: ExtensionStreamPacket = {
						version: "1.0.0",
						type: "AGENT_RESPONSE",
						sender: "CHROME_EXTENSION",
						timestamp: Date.now(),
						data: {
							response: {
								commandId: cmd.commandId,
								success: true,
								data: { tradeId: "777888", purchasedPrice: 15000 },
								timestamp: Date.now(),
							},
						},
					};
					clientWs.send(JSON.stringify(reply));
				}
			};

			const response = await streamServer.executeCommand(
				"BUY_NOW",
				{ tradeId: "777888", buyNowPrice: 15000 },
				5000,
			);
			expect(response.success).toBe(true);
			expect((response.data as any).purchasedPrice).toBe(15000);

			// Clean up
			clientWs.close();
			streamServer.stop();
		});
	});

	describe("FutWebappMcpBridge & Leaks Radar", () => {
		it("provides MCP tools schema and executes live inspections & leaks queries", async () => {
			const streamServer = new FutWebappStreamServer({ port: 3196 });
			const bridge = new FutWebappMcpBridge(streamServer);

			const tools = bridge.getTools();
			expect(tools.length).toBe(4);
			const names = tools.map((t) => t.name);
			expect(names).toContain("bxc_fut_webapp_sync");
			expect(names).toContain("bxc_fut_webapp_control");
			expect(names).toContain("bxc_fut_webapp_dom_stream");
			expect(names).toContain("bxc_fut_leaks_radar");

			// Test bxc_fut_webapp_sync
			const syncResult = await bridge.handleToolCall("bxc_fut_webapp_sync");
			expect(syncResult.connected).toBe(false);
			expect(syncResult.coins).toBe(0);

			// Test bxc_fut_leaks_radar
			const leaksAll = await bridge.handleToolCall("bxc_fut_leaks_radar", { minRating: 90 });
			expect(leaksAll.status).toBe("SUCCESS");
			expect((leaksAll.leaks as any[]).length).toBeGreaterThanOrEqual(2);

			const leaksTrailblazers = await bridge.handleToolCall("bxc_fut_leaks_radar", {
				promoName: "Trailblazers",
			});
			expect(leaksTrailblazers.status).toBe("SUCCESS");
			expect((leaksTrailblazers.leaks as any[]).length).toBeGreaterThanOrEqual(1);

			// Test bxc_fut_webapp_dom_stream when no snapshot is available
			const domResult = await bridge.handleToolCall("bxc_fut_webapp_dom_stream");
			expect(domResult.status).toBe("NO_DOM_SNAPSHOT");
		});
	});
});
