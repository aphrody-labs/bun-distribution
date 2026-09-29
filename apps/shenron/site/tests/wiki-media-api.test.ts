import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

describe("Sprint 1 — Media Works & Editions API Integration", () => {
	it("dbUniverse.mediaWorks() renvoie les œuvres médias avec leurs éditions imbriquées", async () => {
		const { dbUniverse } = await import("../src/lib/db-universe");
		const works = await dbUniverse.mediaWorks();
		expect(works).not.toBeNull();
		expect(works!.length).toBeGreaterThanOrEqual(1);

		const db = works!.find((w) => w.slug === "dragon-ball");
		expect(db).toBeDefined();
		expect(db!.title).toBe("Dragon Ball");
		expect(db!.kind).toBe("manga");
		expect(db!.series).toBe("DB");
		expect(db!.editions.length).toBeGreaterThanOrEqual(2);

		const glenat = db!.editions.find((e) => e.edition === "tankobon" && e.language === "fr");
		expect(glenat).toBeDefined();
		expect(glenat!.volumes_count).toBe(42);

		const fullColor = db!.editions.find((e) => e.edition === "full_color");
		expect(fullColor).toBeDefined();
		expect(fullColor!.volumes_count).toBe(42);
	});

	it("dbUniverse.mediaEditions() renvoie les éditions filtrées par slug d'œuvre", async () => {
		const { dbUniverse } = await import("../src/lib/db-universe");
		const editions = await dbUniverse.mediaEditions({ workSlug: "dragon-ball" });
		expect(editions).not.toBeNull();
		expect(editions!.length).toBeGreaterThanOrEqual(2);
		expect(editions!.every((e) => e.work_slug === "dragon-ball")).toBe(true);
	});

	it("GET /api/wiki/media répond avec CORS et les œuvres sérialisées", async () => {
		const { GET, OPTIONS } = await import("../src/app/api/wiki/media/route");

		// OPTIONS preflight
		const optRes = OPTIONS();
		expect(optRes.status).toBe(204);
		expect(optRes.headers.get("Access-Control-Allow-Origin")).toBe("*");

		// GET request
		const req = new Request("http://localhost:3000/api/wiki/media?kind=manga");
		const res = await GET(req as any);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.data).toBeDefined();
		expect(json.total).toBeGreaterThanOrEqual(1);
		expect(json.data[0].slug).toBe("dragon-ball");
		expect(json.data[0].editions.length).toBeGreaterThanOrEqual(2);
	});

	it("GET /api/wiki/media?edition=full_color filtre les éditions correspondantes", async () => {
		const { GET } = await import("../src/app/api/wiki/media/route");
		const req = new Request("http://localhost:3000/api/wiki/media?edition=full_color");
		const res = await GET(req as any);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.data).toBeDefined();
		for (const work of json.data) {
			expect(work.editions.every((e: any) => e.edition === "full_color")).toBe(true);
		}
	});

	it("les composants pages manga intègrent la matrice d'éditions et le balisage des tomes", async () => {
		const fs = await import("node:fs/promises");
		const indexContent = await fs.readFile("apps/shenron/site/src/app/wiki/manga/page.tsx", "utf-8");
		expect(indexContent).toContain("mediaWorks");
		expect(indexContent).toContain("Matrice Ontologique Média");
		expect(indexContent).toContain("/api/wiki/media");

		const volumeContent = await fs.readFile("apps/shenron/site/src/app/wiki/manga/volume/[id]/page.tsx", "utf-8");
		expect(volumeContent).toContain("Éditions répertoriées :");
		expect(volumeContent).toContain("Glénat FR (42)");
		expect(volumeContent).toContain("Full Color (42)");
	});
});
