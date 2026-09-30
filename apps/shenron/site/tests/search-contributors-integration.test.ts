import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const dbUrl = process.env.DATABASE_URL?.trim();

describe("Global Search Contributors Integration", () => {
	it.skipIf(!dbUrl)("dbUniverse.search('toriyama') renvoie les contributeurs avec Akira Toriyama en tête", async () => {
		const { dbUniverse } = await import("../src/lib/db-universe");
		const results = await dbUniverse.search("toriyama");
		expect(results).not.toBeNull();
		expect(results!.contributors).toBeDefined();
		expect(results!.contributors.length).toBeGreaterThanOrEqual(1);

		const toriyama = results!.contributors.find((c) => c.slug === "akira-toriyama");
		expect(toriyama).toBeDefined();
		expect(toriyama!.name).toBe("Akira Toriyama");
		expect(toriyama!.category).toBe("author");
	});

	it.skipIf(!dbUrl)("dbUniverse.search('torishima') retrouve l'éditeur historique Kazuhiko Torishima", async () => {
		const { dbUniverse } = await import("../src/lib/db-universe");
		const results = await dbUniverse.search("torishima");
		expect(results).not.toBeNull();
		expect(results!.contributors).toBeDefined();
		expect(results!.contributors.length).toBeGreaterThanOrEqual(1);

		const torishima = results!.contributors.find((c) => c.slug === "kazuhiko-torishima");
		expect(torishima).toBeDefined();
		expect(torishima!.name).toBe("Kazuhiko Torishima");
		expect(torishima!.category).toBe("editorial_staff");
	});

	it.skipIf(!dbUrl)("GET /api/search?q=toriyama renvoie les résultats incluant les contributeurs", async () => {
		const { GET } = await import("../src/app/api/search/route");
		const req = new Request("http://localhost:3000/api/search?q=toriyama");
		const res = await GET(req as any);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.contributors).toBeDefined();
		expect(json.contributors.length).toBeGreaterThanOrEqual(1);
		expect(json.contributors[0].name).toBe("Akira Toriyama");
	});
});
