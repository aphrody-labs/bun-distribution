import { afterAll, describe, expect, mock, test } from "bun:test";
import type { WikiReadPort } from "@shenron/api/server";

// B14 : catch-all `/api/public/[...route]` du site monté sur `@shenron/api`.
mock.module("server-only", () => ({}));

const calls: string[] = [];
const fakeWiki: WikiReadPort = {
	async categories() {
		calls.push("categories");
		return [{ name: "battles", label: "Combats", total: 4 }];
	},
	async list({ category, limit, offset }) {
		calls.push(`list:${category}:${limit}:${offset}`);
		return { items: [{ id: 1, name: "Goku vs Freezer" }], total: 1 };
	},
	async get({ category, idOrSlug }) {
		calls.push(`get:${category}:${idOrSlug}`);
		return idOrSlug === "1" ? { id: 1, name: "Goku vs Freezer" } : null;
	},
};

const { setSiteWikiPort } = await import("../src/lib/site-api");
const route = await import("../src/app/api/public/[...route]/route");

afterAll(() => setSiteWikiPort(undefined));

const req = (path: string, init: RequestInit = {}) =>
	new Request(`http://127.0.0.1:5011${path}`, {
		...init,
		headers: { "x-real-ip": "198.51.100.20", ...(init.headers as Record<string, string>) },
	});

describe("app/api/public/[...route]", () => {
	test("segment config : runtime nodejs, force-dynamic, GET/HEAD/OPTIONS", () => {
		expect(route.runtime).toBe("nodejs");
		expect(route.dynamic).toBe("force-dynamic");
		expect(typeof route.GET).toBe("function");
		expect(typeof route.HEAD).toBe("function");
		expect(typeof route.OPTIONS).toBe("function");
	});

	test("categories → 200 via le port wiki", async () => {
		setSiteWikiPort(fakeWiki);
		const res = await route.GET(req("/api/public/wiki/categories"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			categories: [{ name: "battles", label: "Combats", total: 4 }],
		});
		expect(res.headers.get("cache-control")).toContain("public");
		expect(calls).toContain("categories");
	});

	test("liste et fiche d'une catégorie", async () => {
		setSiteWikiPort(fakeWiki);
		const list = await route.GET(req("/api/public/wiki/battles?limit=5"));
		expect(list.status).toBe(200);
		expect(await list.json()).toMatchObject({ category: "battles", total: 1, limit: 5, offset: 0 });
		const entity = await route.GET(req("/api/public/wiki/battles/1"));
		expect(await entity.json()).toEqual({ id: 1, name: "Goku vs Freezer" });
		const missing = await route.GET(req("/api/public/wiki/battles/999"));
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({ error: "Not found" });
	});

	test("chemin inconnu → 404 corps historique", async () => {
		setSiteWikiPort(fakeWiki);
		for (const path of ["/api/public/nope/a/b/c", "/api/public/wiki/unknown-category"]) {
			const res = await route.GET(req(path));
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: "Not found" });
		}
	});

	test("sans base PostgreSQL : 404 historique", async () => {
		setSiteWikiPort(null);
		const res = await route.GET(req("/api/public/wiki/categories"));
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Not found" });
	});

	test("OPTIONS → 204 avec l'allowlist CORS", async () => {
		setSiteWikiPort(fakeWiki);
		const res = await route.OPTIONS(
			req("/api/public/wiki/categories", {
				method: "OPTIONS",
				headers: { origin: "https://dragonballfr.com" },
			})
		);
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("https://dragonballfr.com");
	});
});
