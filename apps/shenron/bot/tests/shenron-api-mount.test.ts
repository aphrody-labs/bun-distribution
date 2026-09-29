import "./setup";
import { afterAll, describe, expect, it } from "bun:test";
import type { WikiReadPort } from "@shenron/api/server";
import { startHarness } from "../scripts/api-harness";
import { bucketRateLimiter, hitPublicBucket } from "../src/api/shenron-api";

// B14 : repli `@shenron/api` monté après les routes historiques du bot.
const calls: string[] = [];
const fakeWiki: WikiReadPort = {
	async categories() {
		calls.push("categories");
		return [
			{ name: "characters", label: "Personnages", total: 3 },
			{ name: "battles", label: "Combats", total: 1 },
		];
	},
	async list({ category, limit, offset }) {
		calls.push(`list:${category}:${limit}:${offset}`);
		return { items: [{ id: 1 }], total: 1 };
	},
	async get({ category, idOrSlug }) {
		calls.push(`get:${category}:${idOrSlug}`);
		return category === "battles" && idOrSlug === "12" ? { id: 12, name: "Goku vs Freezer" } : null;
	},
};

const withPg = startHarness({ wiki: fakeWiki });
const withoutPg = startHarness({ wiki: null });
afterAll(async () => {
	await withPg.stop(true);
	await withoutPg.stop(true);
});

const get = (server: ReturnType<typeof startHarness>, path: string) =>
	fetch(new URL(path, server.url), { headers: { "x-real-ip": "198.51.100.1" } });

describe("montage @shenron/api dans le Bun.serve du bot", () => {
	it("/api/public/wiki/categories → 200 via le repli", async () => {
		const res = await get(withPg, "/api/public/wiki/categories");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { categories: { name: string }[] };
		expect(body.categories.map((c) => c.name)).toEqual(["characters", "battles"]);
		expect(res.headers.get("etag")).toBeTruthy();
		expect(calls).toContain("categories");
	});

	it("les routes historiques gardent la priorité", async () => {
		const characters = await get(withPg, "/api/public/wiki/characters");
		expect(await characters.json()).toEqual({ legacy: "/api/public/wiki/characters" });
		const arc = await get(withPg, "/api/public/wiki/arcs/namek");
		expect(await arc.json()).toEqual({ legacy: "/api/public/wiki/arcs/:slug" });
		expect(calls.some((c) => c.startsWith("list:characters"))).toBe(false);
		expect(calls.some((c) => c.startsWith("get:arcs"))).toBe(false);
	});

	it("/api/public/wiki/battles/12 atteint Hono", async () => {
		const res = await get(withPg, "/api/public/wiki/battles/12");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: 12, name: "Goku vs Freezer" });
		expect(calls).toContain("get:battles:12");
	});

	it("catégorie inconnue → 404 historique", async () => {
		const res = await get(withPg, "/api/public/wiki/unknown-cat");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Not found" });
	});

	it("sans PostgreSQL, les nouveaux chemins rendent le 404 historique", async () => {
		for (const path of [
			"/api/public/wiki/categories",
			"/api/public/wiki/battles",
			"/api/public/wiki/battles/12",
			"/api/public/openapi.json",
		]) {
			const res = await get(withoutPg, path);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: "Not found" });
		}
	});

	it("un seul budget public : Hono et routes historiques partagent les seaux", async () => {
		const buckets = new Map<string, { count: number; resetAt: number }>();
		const limiter = bucketRateLimiter(buckets, () => 1_000);
		for (let i = 0; i < 59; i++) hitPublicBucket(buckets, "203.0.113.9", undefined, 1_000);
		expect((await limiter.hit("public:203.0.113.9", { limit: 60, windowMs: 60_000 })).allowed).toBe(
			true
		);
		const refused = await limiter.hit("public:203.0.113.9", { limit: 60, windowMs: 60_000 });
		expect(refused).toEqual({ allowed: false, retryAfterSeconds: 60 });
		expect(hitPublicBucket(buckets, "203.0.113.9", undefined, 1_000)).toBe(false);
	});
});
