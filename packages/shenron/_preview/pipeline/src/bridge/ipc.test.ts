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
				return Response.json({ query: "fixture", results: [], mode: "lexical", latencyMs: 1, totalFound: 0 });
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
		expect((await bridge.searchRag("test")).results).toEqual([]);
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
});
