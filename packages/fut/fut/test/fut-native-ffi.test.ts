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
import {
	withDomTree,
	querySelectBatch,
	querySelectAllBatch,
	extractFutLinks,
	convertFutHtmlToMarkdown,
	parseFutPriceFast,
	extractCleanFutText,
	normalizeFutUrl,
} from "../src/parser/native.ts";
import {
	FutNativeCache,
	runNativeFfiBenchmark,
} from "../src/cache/nativeCache.ts";
import {
	reconFutDns,
	probeEaEndpoints,
	KNOWN_EA_UTAS_ENDPOINTS,
} from "../src/recon/network.ts";
import { isBridgeAvailable, querySelector } from "@aphrody/bxc/ffi/rust-bridge";

describe("FUT Native FFI & Bun Engine Integration", () => {
	const itIfBridge = isBridgeAvailable() ? it : it.skip;
	const sampleHtml = `
		<!DOCTYPE html>
		<html>
		<head><title>FC 27 Kylian Mbappé 91 - FUT Card</title></head>
		<body>
			<div class="player-card">
				<h1 class="player-name">Kylian Mbappé</h1>
				<div class="player-price">3,450,000</div>
				<span class="stat-pac">97</span>
				<span class="stat-sho">90</span>
				<div class="links">
					<a href="/players/27-1001-mbappe" class="link-player">Player Page</a>
					<a href="/sbc/challenges/potm-mbappe" class="link-sbc">Mbappe POTM SBC</a>
					<a href="/evolutions/relentless-winger" class="link-evo">Relentless Winger Evo</a>
				</div>
			</div>
		</body>
		</html>
	`;

	itIfBridge("safely queries DOM tree with RAII management and zero leaks", () => {
		const name = withDomTree(sampleHtml, (tree) => {
			const node = querySelector(tree, ".player-name");
			return node ? node.replace(/<[^>]+>/g, "").trim() : "";
		});
		expect(name).toBe("Kylian Mbappé");
	});

	itIfBridge("executes batch selector queries using Rust FFI in a single pass", () => {
		const batch = querySelectBatch(sampleHtml, {
			name: ".player-name",
			price: ".player-price",
			pace: ".stat-pac",
		});

		expect(batch.name).toContain("Kylian Mbappé");
		expect(batch.price).toContain("3,450,000");
		expect(batch.pace).toContain("97");
	});

	itIfBridge("extracts all matching elements with querySelectAllBatch", () => {
		const batchAll = querySelectAllBatch(sampleHtml, {
			stats: "span[class*='stat-']",
			links: "a",
		});

		expect(batchAll.stats.length).toBeGreaterThanOrEqual(2);
		expect(batchAll.links.length).toBe(3);
	});

	it("filters FUT links by category (players, sbc, evolutions)", () => {
		const playerLinks = extractFutLinks(sampleHtml, "https://www.fut.gg", {
			filterCategory: "players",
		});
		expect(playerLinks.length).toBe(1);
		expect(playerLinks[0]).toContain("mbappe");

		const sbcLinks = extractFutLinks(sampleHtml, "https://www.fut.gg", {
			filterCategory: "sbc",
		});
		expect(sbcLinks.length).toBe(1);
		expect(sbcLinks[0]).toContain("potm-mbappe");

		const evoLinks = extractFutLinks(sampleHtml, "https://www.fut.gg", {
			filterCategory: "evolutions",
		});
		expect(evoLinks.length).toBe(1);
		expect(evoLinks[0]).toContain("relentless-winger");
	});

	itIfBridge("converts HTML to Markdown and extracts title via Rust FFI", () => {
		const res = convertFutHtmlToMarkdown(sampleHtml);
		expect(res.title).toContain("Kylian Mbappé");
		expect(res.markdown).toContain("Kylian Mbappé");
		expect(res.markdown).toContain("3,450,000");
	});

	it("extracts clean plain text and normalizes FUT URLs", () => {
		const clean = extractCleanFutText("<p>EA SPORTS FC 27 <strong>Ultimate Team</strong></p>");
		expect(clean.trim()).toBe("EA SPORTS FC 27 Ultimate Team");

		const normalized = normalizeFutUrl("https://www.fut.gg/players/27-1001-mbappe/#stats");
		expect(normalized).toBe("https://www.fut.gg/players/27-1001-mbappe/");
	});

	it("parses numeric price with multi-tier fast parser", () => {
		const price = parseFutPriceFast(sampleHtml, [".player-price"]);
		expect(price).toBe(3450000);
	});

	it("manages native SQLite cache with Bun.hash.wyhash and gzip compression", () => {
		const cache = new FutNativeCache();

		// Short item (<1KB) -> uncompressed
		cache.set("player:mbappe:price", { price: 3450000, updated: Date.now() });
		const cached = cache.get<{ price: number }>("player:mbappe:price");
		expect(cached?.price).toBe(3450000);

		// Large payload (>1KB) -> transparent Bun.gzipSync compression
		const largePayload = {
			allPlayers: Array.from({ length: 50 }, (_, i) => ({
				id: `player-${i}`,
				name: `Player ${i}`,
				stats: { pac: 85, sho: 80, pas: 75 },
			})),
		};
		cache.set("large:dataset", largePayload);
		const cachedLarge = cache.get<typeof largePayload>("large:dataset");
		expect(cachedLarge?.allPlayers.length).toBe(50);
		expect(cachedLarge?.allPlayers[0].name).toBe("Player 0");

		// Expiration check
		cache.set("ephemeral:key", { val: 42 }, 1); // 1ms TTL
		// Wait 10ms
		const start = performance.now();
		while (performance.now() - start < 10) {
			// busy wait
		}
		expect(cache.get("ephemeral:key")).toBeNull();

		cache.close();
	});

	itIfBridge("executes micro-benchmark measuring Rust FFI vs JS and Bun SQLite ops", () => {
		const bench = runNativeFfiBenchmark(50);
		expect(bench.iterations).toBe(50);
		expect(bench.wyhashOpsPerSec).toBeGreaterThan(500000);
		expect(bench.sqliteOpsPerSec).toBeGreaterThan(10000);
	});

	it("probes EA UTAS endpoints and verifies known endpoints structure", async () => {
		expect(KNOWN_EA_UTAS_ENDPOINTS.length).toBeGreaterThanOrEqual(4);
		const probes = await probeEaEndpoints(KNOWN_EA_UTAS_ENDPOINTS.slice(0, 2));
		expect(probes.length).toBe(2);
		expect(probes[0]).toHaveProperty("latencyMs");
		expect(probes[0]).toHaveProperty("status");
	});

	it.skip("runs DNS reconnaissance over domain and returns array of subdomains", () => {
		const res = reconFutDns("ea.com");
		expect(Array.isArray(res)).toBe(true);
		expect(res.length).toBeGreaterThan(0);
	});
});
