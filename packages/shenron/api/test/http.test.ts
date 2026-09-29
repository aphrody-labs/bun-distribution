// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	corsHeaders,
	createMemoryRateLimiter,
	createPublicCache,
	fnvEtag,
	noopInvalidation,
	PUBLIC_RATE_LIMIT,
	publicCacheHeaders,
	publicCacheKey,
} from "../src/http";

describe("fnvEtag", () => {
	// Vectors produced by `etagOf(new TextEncoder().encode(body))` of apps/shenron/bot/src/api/server.ts.
	const vectors: [string, string][] = [
		["", '"811c9dc5-0"'],
		['{"status":"ok"}', '"db4ee913-f"'],
		[
			JSON.stringify({ categories: [{ name: "characters", label: "Personnages", total: 312 }] }),
			'"c28d3a9f-48"',
		],
		["Vœux ドラゴンボール", '"922d1b6b-1b"'],
		["x".repeat(10_000), '"616035e5-2710"'],
		[
			JSON.stringify({
				items: Array.from({ length: 300 }, (_, i) => ({ id: i, name: `Goku ${i}` })),
			}),
			'"0cf9b299-212b"',
		],
	];
	for (const [body, etag] of vectors) {
		test(`${body.length} chars → ${etag}`, () => {
			expect(fnvEtag(body)).toBe(etag);
		});
	}
});

describe("publicCacheHeaders", () => {
	test("max-age=N, s-maxage=2N, stale-while-revalidate=4N", () => {
		expect(publicCacheHeaders(3600)).toEqual({
			"Cache-Control": "public, max-age=3600, s-maxage=7200, stale-while-revalidate=14400",
		});
		expect(publicCacheHeaders(15)).toEqual({
			"Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
		});
		expect(publicCacheHeaders(0.2)["Cache-Control"]).toBe(
			"public, max-age=1, s-maxage=2, stale-while-revalidate=4"
		);
	});
});

describe("corsHeaders", () => {
	const allow = ["https://dragonballfr.com", "https://www.dragonballfr.com"];
	test("echoes an allowed origin, falls back to the first one", () => {
		expect(corsHeaders("https://www.dragonballfr.com", allow, ["GET", "OPTIONS"])).toEqual({
			"Access-Control-Allow-Origin": "https://www.dragonballfr.com",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Access-Control-Max-Age": "600",
			Vary: "Origin",
		});
		expect(corsHeaders("https://evil.example", allow, ["GET"])["Access-Control-Allow-Origin"]).toBe(
			"https://dragonballfr.com"
		);
		expect(corsHeaders(null, [], ["GET"])["Access-Control-Allow-Origin"]).toBe("null");
	});
});

describe("createMemoryRateLimiter", () => {
	test("60 per minute per key, then refused with Retry-After 60, window resets", async () => {
		let now = 1_000;
		const limiter = createMemoryRateLimiter({ now: () => now });
		for (let i = 0; i < 60; i++) {
			expect((await limiter.hit("ip:a", PUBLIC_RATE_LIMIT)).allowed).toBe(true);
		}
		expect(await limiter.hit("ip:a", PUBLIC_RATE_LIMIT)).toEqual({
			allowed: false,
			retryAfterSeconds: 60,
		});
		expect((await limiter.hit("ip:b", PUBLIC_RATE_LIMIT)).allowed).toBe(true);
		now += 60_001;
		expect((await limiter.hit("ip:a", PUBLIC_RATE_LIMIT)).allowed).toBe(true);
	});
});

describe("createPublicCache", () => {
	test("TTL expiry, ETag of the body, storedAt", () => {
		let now = 0;
		const cache = createPublicCache({ now: () => now });
		const { etag } = cache.set("/a", '{"status":"ok"}', 1000);
		expect(etag).toBe('"db4ee913-f"');
		expect(cache.get("/a")).toEqual({ body: '{"status":"ok"}', etag, storedAt: 0 });
		now = 1000;
		expect(cache.get("/a")).not.toBeNull();
		now = 1001;
		expect(cache.get("/a")).toBeNull();
	});

	test("LRU eviction at 256 entries by default, reads refresh recency", () => {
		const cache = createPublicCache();
		for (let i = 0; i < 256; i++) cache.set(`/k${i}`, String(i), 60_000);
		expect(cache.get("/k0")).not.toBeNull();
		cache.set("/k256", "256", 60_000);
		expect(cache.get("/k0")).not.toBeNull();
		expect(cache.get("/k1")).toBeNull();
		expect(cache.get("/k256")?.body).toBe("256");
	});

	test("custom maxEntries", () => {
		const cache = createPublicCache({ maxEntries: 2 });
		cache.set("a", "1", 1000);
		cache.set("b", "2", 1000);
		cache.set("c", "3", 1000);
		expect(cache.get("a")).toBeNull();
		expect(cache.get("c")?.body).toBe("3");
	});
});

describe("publicCacheKey and noopInvalidation", () => {
	test("query sorted by name", () => {
		expect(publicCacheKey(new URL("http://x/api/public/wiki/races?offset=5&limit=2"))).toBe(
			"/api/public/wiki/races?limit=2&offset=5"
		);
		expect(publicCacheKey(new URL("http://x/api/public/wiki/categories"))).toBe(
			"/api/public/wiki/categories"
		);
	});

	test("noopInvalidation resolves", async () => {
		await noopInvalidation.paths(["/wiki"]);
		await noopInvalidation.tags(["wiki"]);
	});
});
