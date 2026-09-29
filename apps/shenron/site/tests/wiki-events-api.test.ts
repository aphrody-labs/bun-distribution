import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import { NextRequest } from "next/server";

const { GET, OPTIONS } = await import("../src/app/api/wiki/events/route");

describe("/api/wiki/events — Moteur d'événements et facettes", () => {
	test("OPTIONS répond avec le statut 204 et les en-têtes CORS", async () => {
		const res = OPTIONS();
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
	});

	test("GET sans paramètre renvoie la liste complète avec métadonnées et facettes", async () => {
		const req = new NextRequest("http://test/api/wiki/events");
		const res = await GET(req);
		expect(res.status).toBe(200);

		const json = await res.json();
		expect(json.canonicalUrl).toBe("/api/wiki/events");
		expect(json.page).toBe(1);
		expect(json.limit).toBe(24);
		expect(json.total).toBeGreaterThan(0);
		expect(Array.isArray(json.data)).toBe(true);
		expect(json.data.length).toBeGreaterThan(0);

		// Structure des facettes
		expect(json.facets).toBeDefined();
		expect(json.facets.kinds).toBeDefined();
		expect(typeof json.facets.kinds.battle).toBe("number");
		expect(typeof json.facets.kinds.tournament).toBe("number");
		expect(typeof json.facets.kinds.timeline).toBe("number");
		expect(json.facets.canon).toBeDefined();
		expect(typeof json.facets.canon.canon).toBe("number");
		expect(typeof json.facets.canon.non_canon).toBe("number");
	});

	test("GET ?type=battle filtre uniquement les combats", async () => {
		const req = new NextRequest("http://test/api/wiki/events?type=battle");
		const res = await GET(req);
		const json = await res.json();

		expect(Array.isArray(json.data)).toBe(true);
		for (const item of json.data) {
			expect(item.kind).toBe("battle");
			expect(item.href).toStartWith("/wiki/combats/");
		}
	});

	test("GET ?type=tournament filtre uniquement les tournois", async () => {
		const req = new NextRequest("http://test/api/wiki/events?type=tournament");
		const res = await GET(req);
		const json = await res.json();

		expect(json.data.length).toBeGreaterThan(0);
		for (const item of json.data) {
			expect(item.kind).toBe("tournament");
			expect(item.href).toStartWith("/wiki/tournois/");
		}
	});

	test("GET ?canon=true exclut les événements hors-canon", async () => {
		const req = new NextRequest("http://test/api/wiki/events?canon=true");
		const res = await GET(req);
		const json = await res.json();

		expect(json.data.length).toBeGreaterThan(0);
		for (const item of json.data) {
			expect(item.canon).toBe(true);
		}
	});

	test("GET ?q=Goku recherche sur le titre ou les participants", async () => {
		const req = new NextRequest("http://test/api/wiki/events?q=Goku");
		const res = await GET(req);
		const json = await res.json();

		expect(json.data.length).toBeGreaterThan(0);
		for (const item of json.data) {
			const text = `${item.title} ${(item.participants ?? []).join(" ")}`.toLowerCase();
			expect(text).toContain("goku");
		}
	});

	test("GET gère la pagination découpée avec exactitude", async () => {
		const req = new NextRequest("http://test/api/wiki/events?page=2&limit=5");
		const res = await GET(req);
		const json = await res.json();

		expect(json.page).toBe(2);
		expect(json.limit).toBe(5);
		expect(json.data.length).toBeLessThanOrEqual(5);
		expect(json.pageCount).toBe(Math.ceil(json.total / 5));
	});

	test("GET ?timeline=manga-canon isole la timeline canonique et renvoie la facette timelines", async () => {
		const req = new NextRequest("http://test/api/wiki/events?timeline=manga-canon");
		const res = await GET(req);
		const json = await res.json();

		expect(json.facets).toHaveProperty("timelines");
		expect(json.data.length).toBeGreaterThan(0);
		for (const item of json.data) {
			expect(item.timeline).toBe("manga-canon");
		}
	});
});
