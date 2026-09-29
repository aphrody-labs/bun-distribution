import { afterEach, beforeEach, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { buildRagContext, hybridSearch } from "../src/lib/rag";

// No address default since the AI env contract (aphrody-infra local-ai.json): the
// tests pin the aphrody-ai-http origin through its canonical name.
const savedAiHttpUrl = process.env.APHRODY_AI_HTTP_URL;
beforeEach(() => {
	process.env.APHRODY_AI_HTTP_URL = "http://127.0.0.1:8789";
});
afterEach(() => {
	if (savedAiHttpUrl === undefined) delete process.env.APHRODY_AI_HTTP_URL;
	else process.env.APHRODY_AI_HTTP_URL = savedAiHttpUrl;
});

const originalFetch = globalThis.fetch;
const originalBackend = process.env.RAG_BACKEND;
const originalToken = process.env.APHRODY_SHENRON_API_TOKEN;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalBackend === undefined) delete process.env.RAG_BACKEND;
	else process.env.RAG_BACKEND = originalBackend;
	if (originalToken === undefined) delete process.env.APHRODY_SHENRON_API_TOKEN;
	else process.env.APHRODY_SHENRON_API_TOKEN = originalToken;
});

it("uses Aphrody for filtered RAG search and full citation context without a local RAG table", async () => {
	process.env.RAG_BACKEND = "aphrody";
	process.env.APHRODY_SHENRON_API_TOKEN = "fixture";
	const urls: URL[] = [];
	globalThis.fetch = (async (input) => {
		urls.push(new URL(String(input)));
		return Response.json({ results: [{
			sourceId: "shenron:42", originSourceId: "manga", kind: "manga_page", lang: "ja",
			title: "Son Goku", url: "https://dragonballfr.com/manga/42", snippet: "texte bref",
			content: "preuve intégrale du manga", score: 0.8,
		}] });
	}) as typeof fetch;
	const db = new Database(":memory:");
	try {
		const search = await hybridSearch(db, "Goku", 5, { sourceId: "manga", lang: "ja" });
		expect(search.results[0]?.rowid).toBe(42);
		expect(search.results[0]?.sourceId).toBe("manga");
		expect(urls[0]?.searchParams.get("sourceId")).toBe("manga");
		expect(urls[0]?.searchParams.get("lang")).toBe("ja");
		// Keep the context lookup on the mocked HTTP path: an unfiltered query may
		// legitimately use the native Aphrody bridge when it is installed locally.
		const context = await buildRagContext(db, "Goku", { sourceId: "manga", lang: "ja" });
		expect(context.context).toContain("preuve intégrale du manga");
	} finally {
		db.close();
	}
});
