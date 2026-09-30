import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const dbUrl = process.env.DATABASE_URL?.trim();

describe("Sprint 3 — Narrative Timelines API Integration", () => {
	it.skipIf(!dbUrl)("dbUniverse.narrativeTimelines() renvoie les 4 timelines avec le décompte d'événements", async () => {
		const { dbUniverse } = await import("../src/lib/db-universe");
		const timelines = await dbUniverse.narrativeTimelines();
		expect(timelines).not.toBeNull();
		expect(timelines!.length).toBeGreaterThanOrEqual(4);

		const canon = timelines!.find((t) => t.slug === "manga-canon");
		expect(canon).toBeDefined();
		expect(canon!.label).toContain("Manga Canonique");
		expect(canon!.event_count).toBeGreaterThanOrEqual(1);

		const toei = timelines!.find((t) => t.slug === "anime-toei");
		expect(toei).toBeDefined();
		expect(toei!.label).toContain("Toei");

		const movies = timelines!.find((t) => t.slug === "movies-dbz");
		expect(movies).toBeDefined();

		const xeno = timelines!.find((t) => t.slug === "xenoverse");
		expect(xeno).toBeDefined();
	});

	it.skipIf(!dbUrl)("GET /api/wiki/timelines répond avec statut 200 et les métadonnées", async () => {
		const { GET, OPTIONS } = await import("../src/app/api/wiki/timelines/route");

		const opt = OPTIONS();
		expect(opt.status).toBe(204);
		expect(opt.headers.get("Access-Control-Allow-Origin")).toBe("*");

		const req = new Request("http://localhost:3000/api/wiki/timelines");
		const res = await GET(req as any);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.data).toBeDefined();
		expect(json.total).toBeGreaterThanOrEqual(4);
		expect(json.data.some((t: any) => t.slug === "manga-canon")).toBe(true);
	});
});
