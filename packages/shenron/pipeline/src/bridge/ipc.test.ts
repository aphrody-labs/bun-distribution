import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DbuiBridge } from "./ipc";

let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/api/models") return Response.json([{ id: "fixture", name: "Fixture" }]);
			if (url.pathname === "/api/chat") {
				return Response.json({ id: "m1", role: "assistant", content: "réponse locale", timestamp: "2026-01-01T00:00:00Z" });
			}
			if (url.pathname === "/api/public/rag/search") {
				// Protocol-failure server only: never returns hits.
				if (request.method !== "GET") return new Response("method", { status: 405 });
				const q = url.searchParams.get("q");
				if (q === "fail-upstream") return Response.json({ q, results: [], error: "index_unavailable" });
				if (q === "bad-body") return Response.json([1]);
				if (q === "bad-q") return Response.json({ results: [], mode: "hybrid" });
				if (q === "bad-mode") return Response.json({ q, results: [], mode: "fuzzy" });
				if (q === "bad-results") return Response.json({ q, results: "nope", mode: "hybrid" });
				return new Response("unauthorized", { status: 401 });
			}
			if (url.pathname === "/failure") return new Response("fixture failure", { status: 503 });
			return new Response("missing", { status: 404 });
		},
	});
	baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

describe("@shenron/pipeline — bridge HTTP", () => {
	it("retourne les réponses du serveur local", async () => {
		const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: baseUrl });
		expect((await bridge.getModels())[0]?.id).toBe("fixture");
		expect((await bridge.sendPrompt({ prompt: "test" })).content).toBe("réponse locale");
	});

	it("échoue explicitement pour une route absente", async () => {
		const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: baseUrl });
		await expect(bridge.getOcrOverview()).rejects.toThrow("HTTP 404");
		await expect(bridge.inspectPlate(1, 1)).rejects.toThrow("Commande bridge non configurée");
	});

	it("échoue explicitement quand le serveur est indisponible", async () => {
		const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: "http://127.0.0.1:1", timeoutMs: 50 });
		await expect(bridge.getModels()).rejects.toThrow("Échec du bridge HTTP");
	});

	it("RAG: une erreur amont n'est jamais convertie en succès vide", async () => {
		const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: baseUrl });
		await expect(bridge.searchRag("fail-upstream")).rejects.toThrow("index_unavailable");
	});

	it("RAG: un refus d'authentification est propagé", async () => {
		const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: baseUrl });
		await expect(bridge.searchRag("Son Goku")).rejects.toThrow("HTTP 401");
	});

	it("RAG: les modes dense et lexical seuls sont refusés sans requête", async () => {
		const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: baseUrl });
		await expect(bridge.searchRag("x", { mode: "dense" })).rejects.toThrow("dense");
		await expect(bridge.searchRag("x", { mode: "lexical" })).rejects.toThrow("lexical");
	});

	it("RAG: une réponse mal formée est rejetée explicitement", async () => {
		const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: baseUrl });
		for (const [q, why] of [["bad-body", "corps non objet"], ["bad-q", "q absent"], ["bad-mode", "mode inconnu"], ["bad-results", "results absent"]]) {
			await expect(bridge.searchRag(q!)).rejects.toThrow(`réponse invalide (${why})`);
		}
	});
});
