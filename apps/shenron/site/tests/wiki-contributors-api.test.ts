import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import { NextRequest } from "next/server";

const { GET, OPTIONS } = await import("../src/app/api/wiki/contributors/route");

const dbUrl = process.env.DATABASE_URL?.trim();

describe("Sprint 4 — Contributors API & Facets Integration", () => {
	test("OPTIONS répond avec le statut 204 et les en-têtes CORS", () => {
		const res = OPTIONS();
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
	});

	test.skipIf(!dbUrl)("GET /api/wiki/contributors returns paginated data and facets", async () => {
		const req = new NextRequest("http://localhost:3000/api/wiki/contributors");
		const res = await GET(req);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json).toHaveProperty("data");
		expect(json).toHaveProperty("facets");
		expect(json).toHaveProperty("page", 1);
		expect(json).toHaveProperty("canonicalUrl", "/api/wiki/contributors");
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.facets).toHaveProperty("categories");
		expect(json.facets).toHaveProperty("spotlight");
	});

	test.skipIf(!dbUrl)("GET /api/wiki/contributors?category=author filters correctly", async () => {
		const req = new NextRequest("http://localhost:3000/api/wiki/contributors?category=author");
		const res = await GET(req);
		expect(res.status).toBe(200);

		const json = await res.json();
		if (json.data.length > 0) {
			for (const item of json.data) {
				expect(item.category).toBe("author");
			}
		}
	});

	test.skipIf(!dbUrl)("GET /api/wiki/contributors?spotlight=true isolates spotlight items with Toriyama at rank 0", async () => {
		const req = new NextRequest("http://localhost:3000/api/wiki/contributors?spotlight=true");
		const res = await GET(req);
		expect(res.status).toBe(200);

		const json = await res.json();
		if (json.data.length > 0) {
			expect(json.data[0].slug).toBe("akira-toriyama");
			expect(json.data[0].spotlight_rank).toBe(0);
		}
	});

	test.skipIf(!dbUrl)("GET /api/wiki/contributors?q=toriyama searches across name and bio", async () => {
		const req = new NextRequest("http://localhost:3000/api/wiki/contributors?q=toriyama");
		const res = await GET(req);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.data.some((c: any) => c.slug.includes("toriyama"))).toBe(true);
	});
});
