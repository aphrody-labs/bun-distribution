// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { WIKI_CATEGORIES } from "@shenron/db/constants";
import { ErrorEnvelope, WikiCategoriesResponse, WikiListResponse } from "../src/contract";
import {
	createMemoryRateLimiter,
	createPublicCache,
	noopInvalidation,
	type RateLimitPort,
} from "../src/http";
import { nextInvalidationPort, toNextRouteHandlers } from "../src/next";
import { createShenronApi, type ShenronApiPorts, type WikiReadPort } from "../src/server";

const ROWS: Record<string, Record<string, unknown>[]> = {
	characters: [
		{ id: 1, name: "Son Goku", slug: "son-goku" },
		{ id: 2, name: "Vegeta", slug: "vegeta" },
	],
};

function fakeWiki(calls: string[] = []): WikiReadPort {
	return {
		async categories() {
			calls.push("categories");
			return WIKI_CATEGORIES.map(({ name, label }) => ({
				name,
				label,
				total: ROWS[name]?.length ?? 0,
			}));
		},
		async list(i) {
			calls.push(`list:${i.category}:${i.limit}:${i.offset}:${i.q ?? ""}`);
			const rows = ROWS[i.category] ?? [];
			return { items: rows.slice(i.offset, i.offset + i.limit), total: rows.length };
		},
		async get(i) {
			calls.push(`get:${i.category}:${i.idOrSlug}`);
			return (
				(ROWS[i.category] ?? []).find(
					(row) => String(row.id) === i.idOrSlug || row.slug === i.idOrSlug
				) ?? null
			);
		},
	};
}

function ports(over: Partial<ShenronApiPorts> = {}): ShenronApiPorts {
	return {
		wiki: fakeWiki(),
		rateLimit: createMemoryRateLimiter(),
		publicCache: createPublicCache(),
		invalidation: noopInvalidation,
		cors: { allowedOrigins: ["https://dragonballfr.com", "https://www.dragonballfr.com"] },
		clientIp: (req) => req.headers.get("x-real-ip") ?? "unknown",
		isDirectLoopback: (req) => req.headers.get("x-test-loopback") === "1",
		...over,
	};
}

const PATHS = [
	"/api/public/openapi.json",
	"/api/public/wiki/categories",
	"/api/public/wiki/characters",
	"/api/public/wiki/characters/1",
];

describe("createShenronApi (wiki group)", () => {
	test("categories: 200 { categories: [{ name, label, total }] }, registered before /{category}", async () => {
		const calls: string[] = [];
		const api = createShenronApi(ports({ wiki: fakeWiki(calls) }), { service: "shenron-bot" });
		const res = await api.app.request("/api/public/wiki/categories");
		expect(res.status).toBe(200);
		const body = WikiCategoriesResponse.parse(await res.json());
		expect(body.categories.map((c) => c.name)).toEqual(WIKI_CATEGORIES.map((c) => c.name));
		expect(body.categories[0]).toEqual({ name: "characters", label: "Personnages", total: 2 });
		expect(calls).toEqual(["categories"]);
		expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
		expect(res.headers.get("cache-control")).toBe(
			"public, max-age=3600, s-maxage=7200, stale-while-revalidate=14400"
		);
		expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{8}-[0-9a-f]+"$/);
		expect(res.headers.get("access-control-allow-origin")).toBe("https://dragonballfr.com");
	});

	test("list with defaults and validated query", async () => {
		const calls: string[] = [];
		const api = createShenronApi(ports({ wiki: fakeWiki(calls) }), { service: "shenron-site" });
		const res = await api.app.request("/api/public/wiki/characters?q=%20go%20");
		expect(res.status).toBe(200);
		expect(WikiListResponse.parse(await res.json())).toEqual({
			category: "characters",
			items: ROWS.characters!,
			total: 2,
			limit: 50,
			offset: 0,
		});
		expect(calls).toEqual(["list:characters:50:0:go"]);
	});

	test("limit 201 → 400 ErrorEnvelope", async () => {
		const api = createShenronApi(ports(), { service: "shenron-bot" });
		const res = await api.app.request("/api/public/wiki/characters?limit=201");
		expect(res.status).toBe(400);
		const body = ErrorEnvelope.parse(await res.json());
		expect(body.code).toBe("invalid_request");
		expect(body.message).toContain("limit");
	});

	test("unknown category and unknown entity → 404 legacy body", async () => {
		const api = createShenronApi(ports(), { service: "shenron-bot" });
		for (const path of [
			"/api/public/wiki/pokemon",
			"/api/public/wiki/pokemon/1",
			"/api/public/wiki/characters/999",
		]) {
			const res = await api.app.request(path);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: "Not found" });
		}
	});

	test("entity by id and by slug", async () => {
		const api = createShenronApi(ports(), { service: "shenron-bot" });
		expect(await (await api.app.request("/api/public/wiki/characters/2")).json()).toEqual(
			ROWS.characters![1]!
		);
		expect(await (await api.app.request("/api/public/wiki/characters/son-goku")).json()).toEqual(
			ROWS.characters![0]!
		);
	});

	test("POST and other methods → 404; unknown paths → 404; OPTIONS → 204 with CORS", async () => {
		const api = createShenronApi(ports(), { service: "shenron-bot" });
		for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
			const res = await api.app.request("/api/public/wiki/categories", { method });
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: "Not found" });
		}
		const unknown = await api.app.request("/api/public/nothing");
		expect(unknown.status).toBe(404);
		expect(await unknown.json()).toEqual({ error: "Not found" });
		const options = await api.app.request("/api/public/wiki/categories", {
			method: "OPTIONS",
			headers: { origin: "https://www.dragonballfr.com" },
		});
		expect(options.status).toBe(204);
		expect(options.headers.get("access-control-allow-origin")).toBe("https://www.dragonballfr.com");
		expect(options.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
	});

	test("HEAD: headers without body", async () => {
		const api = createShenronApi(ports(), { service: "shenron-bot" });
		const res = await api.fetch(
			new Request("http://bot/api/public/wiki/categories", { method: "HEAD" })
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("etag")).not.toBeNull();
		expect(await res.text()).toBe("");
	});

	test("public cache: second hit served from memory, 304 on If-None-Match", async () => {
		const calls: string[] = [];
		const api = createShenronApi(ports({ wiki: fakeWiki(calls) }), { service: "shenron-bot" });
		const first = await api.app.request("/api/public/wiki/characters?offset=0&limit=2");
		const etag = first.headers.get("etag")!;
		const second = await api.app.request("/api/public/wiki/characters?limit=2&offset=0");
		expect(second.headers.get("etag")).toBe(etag);
		expect(await second.text()).toBe(await first.text());
		expect(calls).toHaveLength(1);
		const revalidated = await api.app.request("/api/public/wiki/characters?limit=2&offset=0", {
			headers: { "if-none-match": etag },
		});
		expect(revalidated.status).toBe(304);
		expect(revalidated.headers.get("etag")).toBe(etag);
		expect(await revalidated.text()).toBe("");
		const fresh = await api.app.request("/api/public/wiki/categories", {
			headers: { "if-none-match": '"00000000-0"' },
		});
		expect(fresh.status).toBe(200);
		const conditional = await api.app.request("/api/public/wiki/categories", {
			headers: { "if-none-match": fresh.headers.get("etag")! },
		});
		expect(conditional.status).toBe(304);
	});

	test("errors are not cached", async () => {
		const calls: string[] = [];
		const api = createShenronApi(ports({ wiki: fakeWiki(calls) }), { service: "shenron-bot" });
		await api.app.request("/api/public/wiki/characters/999");
		await api.app.request("/api/public/wiki/characters/999");
		expect(calls).toEqual(["get:characters:999", "get:characters:999"]);
	});

	test("rate limit: 429 Retry-After 60 after 60 hits; direct loopback exempt", async () => {
		const api = createShenronApi(ports(), { service: "shenron-bot" });
		const headers = { "x-real-ip": "203.0.113.9" };
		for (let i = 0; i < 60; i++) {
			expect((await api.app.request("/api/public/wiki/categories", { headers })).status).toBe(200);
		}
		const limited = await api.app.request("/api/public/wiki/categories", { headers });
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBe("60");
		expect(ErrorEnvelope.parse(await limited.json()).code).toBe("rate_limited");
		const loopback = await api.app.request("/api/public/wiki/categories", {
			headers: { ...headers, "x-test-loopback": "1" },
		});
		expect(loopback.status).toBe(200);
		const other = await api.app.request("/api/public/wiki/categories", {
			headers: { "x-real-ip": "198.51.100.1" },
		});
		expect(other.status).toBe(200);
	});

	test("rate limit key is the client IP", async () => {
		const keys: string[] = [];
		const rateLimit: RateLimitPort = {
			async hit(key) {
				keys.push(key);
				return { allowed: true, retryAfterSeconds: 60 };
			},
		};
		const api = createShenronApi(ports({ rateLimit }), { service: "shenron-bot" });
		await api.app.request("/api/public/wiki/categories", { headers: { "x-real-ip": "192.0.2.4" } });
		expect(keys).toEqual(["public:192.0.2.4"]);
	});

	test("data failure → 503 pg_unavailable; other failures → generic 500", async () => {
		const broken: WikiReadPort = {
			categories: async () => {
				throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
			},
			list: async () => {
				throw new Error("timeout");
			},
			get: async () => null,
		};
		const api = createShenronApi(ports({ wiki: broken }), { service: "shenron-bot" });
		const res = await api.app.request("/api/public/wiki/categories");
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body).toEqual({ error: "Data store unavailable", code: "pg_unavailable" });
		expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");

		const crashing = createShenronApi(
			ports({
				clientIp: () => "1.1.1.1",
				rateLimit: {
					hit: async () => {
						throw new Error("limiter bug");
					},
				},
			}),
			{ service: "shenron-bot" }
		);
		const crash = await crashing.app.request("/api/public/wiki/categories");
		expect(crash.status).toBe(500);
		expect(await crash.json()).toEqual({ error: "internal", code: "internal" });
	});

	test("openapi document served at /api/public/openapi.json", async () => {
		const api = createShenronApi(ports(), { service: "shenron-bot" });
		const res = await api.app.request("/api/public/openapi.json");
		expect(res.status).toBe(200);
		const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
		expect(doc.openapi).toBe("3.1.0");
		expect(Object.keys(doc.paths)).toContain("/api/public/wiki/categories");
	});

	test("log port receives path, status and duration only", async () => {
		const events: unknown[] = [];
		const api = createShenronApi(ports({ log: (e) => events.push(e) }), {
			service: "shenron-site",
		});
		await api.app.request("/api/public/wiki/categories", {
			headers: { authorization: "Bearer x" },
		});
		await api.app.request("/api/public/wiki/categories", { method: "POST" });
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			event: "shenron-site.api",
			path: "/api/public/wiki/categories",
			status: 200,
		});
		expect(events[1]).toMatchObject({ status: 404 });
		expect(JSON.stringify(events)).not.toContain("Bearer");
	});
});

describe("handles()", () => {
	test("claims only the wiki group paths when the wiki port is present", () => {
		const api = createShenronApi(ports(), { service: "shenron-bot" });
		for (const path of PATHS) expect(api.handles(path)).toBe(true);
		for (const path of [
			"/health",
			"/api/public/stats",
			"/api/openapi.json",
			"/api/public/wiki/a/b/c",
		]) {
			expect(api.handles(path)).toBe(false);
		}
	});

	test("false for every path when the wiki port is absent; requests → 404", async () => {
		for (const wiki of [undefined, null]) {
			const api = createShenronApi(ports({ wiki }), { service: "shenron-bot" });
			for (const path of [...PATHS, "/health", "/api/public/stats"]) {
				expect(api.handles(path)).toBe(false);
			}
			const res = await api.app.request("/api/public/wiki/categories");
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: "Not found" });
			expect(Object.keys((api.openApiDocument() as { paths: object }).paths)).toHaveLength(4);
		}
	});
});

describe("./next adapter", () => {
	test("toNextRouteHandlers forwards GET, HEAD and OPTIONS", async () => {
		const handlers = toNextRouteHandlers(createShenronApi(ports(), { service: "shenron-site" }));
		expect((await handlers.GET(new Request("http://site/api/public/wiki/categories"))).status).toBe(
			200
		);
		expect(
			(
				await handlers.HEAD(
					new Request("http://site/api/public/wiki/categories", { method: "HEAD" })
				)
			).status
		).toBe(200);
		expect(
			(
				await handlers.OPTIONS(
					new Request("http://site/api/public/wiki/categories", { method: "OPTIONS" })
				)
			).status
		).toBe(204);
	});

	test("nextInvalidationPort calls the injected functions", async () => {
		const seen: string[] = [];
		const port = nextInvalidationPort({
			revalidatePath: (p) => seen.push(`path:${p}`),
			revalidateTag: (t) => seen.push(`tag:${t}`),
		});
		await port.paths(["/wiki", "/wiki/personnages"]);
		await port.tags(["wiki"]);
		expect(seen).toEqual(["path:/wiki", "path:/wiki/personnages", "tag:wiki"]);
	});
});
