// SPDX-License-Identifier: Apache-2.0
/**
 * Facade parity: `AphrodyComputeClient` and `ShenronEmbeddingsClient` now
 * delegate to `@shenron/pipeline/ai`. The request fixtures below are what the
 * pre-switch clients sent (method, path, query, headers, JSON body); the
 * facades must send exactly the same, except the registered B18 batching.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { AphrodyComputeClient, aphrodyComputeFromChat } from "../../src/aphrody/compute";
import {
	resolveShenronEmbeddingsBaseUrl,
	ShenronEmbeddingsClient,
} from "../../src/aphrody/shenron-embeddings";

interface Recorded {
	method: string;
	path: string;
	query: Record<string, string>;
	headers: Record<string, string>;
	body: unknown;
}

const BASE = "http://127.0.0.1:8789";
const TOKEN = "fixture-token";
const E5 = (seed: number) => Array.from({ length: 384 }, (_, i) => (i + seed) / 1000);

function recorder(respond: (req: Recorded) => Response) {
	const calls: Recorded[] = [];
	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			headers[key] = value;
		});
		const rec: Recorded = {
			method: init?.method ?? "GET",
			path: url.pathname,
			query: Object.fromEntries(url.searchParams),
			headers,
			body: init?.body === undefined || init.body === null ? null : JSON.parse(String(init.body)),
		};
		calls.push(rec);
		return respond(rec);
	}) as typeof fetch;
	return { calls, fetcher };
}

const GET_HEADERS = { accept: "application/json", authorization: `Bearer ${TOKEN}` };
const POST_HEADERS = { ...GET_HEADERS, "content-type": "application/json" };

const RESPONSES: Record<string, (req: Recorded) => unknown> = {
	"/api/v1/shenron/health": () => ({
		status: "ok",
		capabilities: { rag: true, llm: true, ocr: false },
	}),
	"/api/v1/shenron/llm/chat": () => ({ answer: " Namek. ", model: "gemini-web/flash" }),
	"/api/v1/shenron/ocr": () => ({ text: "悟空", language: "ja", textless: false, suspect: false }),
	"/api/v1/shenron/rag/search": () => ({
		mode: "hybrid",
		results: [
			{
				title: "Son Goku",
				url: "/wiki/personnages/son-goku",
				snippet: "Saiyan",
				score: 0.9,
				kind: "character",
				sourceId: "shenron:1",
				lang: "fr",
			},
		],
	}),
	"/api/v1/shenron/embed": (req) => ({
		vectors: (req.body as { texts: string[] }).texts.map((_, i) => E5(i)),
	}),
	"/api/v1/shenron/rag/stats": () => ({ chunks: 10, vectors: 8, sources: [] }),
	"/api/v1/shenron/rag/document": () => ({
		document: {
			sourceId: "shenron:42",
			title: "Son Goku",
			url: "/wiki/son-goku",
			kind: "character",
			snippet: "Saiyan",
		},
	}),
	"/api/v1/shenron/rag/ingest": () => ({ sourceId: "shenron:42", indexed: true, vectorIndexed: true }),
	"/api/v1/shenron/rag/sync/finish": () => ({ status: "complete", active: 2, retired: 1 }),
};

function computeServer() {
	return recorder((req) => {
		const body = RESPONSES[req.path];
		return body ? Response.json(body(req)) : new Response("", { status: 404 });
	});
}

describe("AphrodyComputeClient facade: request bodies identical to the legacy client", () => {
	test("every route sends the legacy method, path, query, headers and body", async () => {
		const { calls, fetcher } = computeServer();
		const client = new AphrodyComputeClient({ baseUrl: BASE, token: TOKEN, fetcher });
		const generation = "12345678-1234-4123-8123-123456789abc";
		const doc = {
			sourceId: "shenron:42",
			title: "Son Goku",
			url: "/wiki/son-goku",
			content: "Saiyan élevé sur Terre.",
			kind: "character",
		};

		expect(await client.health()).toEqual({ rag: true, llm: true, ocr: false });
		expect(await client.chat([{ role: "user", content: "Namek ?" }], "gemini-web/pro")).toEqual({
			answer: "Namek.",
			model: "gemini-web/flash",
		});
		await client.chat([{ role: "system", content: "Sois bref." }, { role: "user", content: "Namek ?" }]);
		expect((await client.ocr("aW1n", "ja")).text).toBe("悟空");
		expect((await client.ragSearchWithMode("Goku", 3, { lang: "fr", entity: "Goku" })).mode).toBe(
			"hybrid"
		);
		expect((await client.embed(["Goku"], "passage"))[0]).toHaveLength(384);
		expect((await client.ragStats()).chunks).toBe(10);
		expect((await client.ragDocument("shenron:42"))?.title).toBe("Son Goku");
		expect(await client.ragIngest(doc)).toEqual({
			indexed: true,
			sourceId: "shenron:42",
			vectorIndexed: true,
		});
		expect(await client.ragSyncFinish("db_characters", generation, 2)).toEqual({ retired: 1 });

		expect(calls).toEqual([
			{ method: "GET", path: "/api/v1/shenron/health", query: {}, headers: GET_HEADERS, body: null },
			{
				method: "POST",
				path: "/api/v1/shenron/llm/chat",
				query: {},
				headers: POST_HEADERS,
				body: { messages: [{ role: "user", content: "Namek ?" }], model: "gemini-web/pro" },
			},
			{
				method: "POST",
				path: "/api/v1/shenron/llm/chat",
				query: {},
				headers: POST_HEADERS,
				body: {
					messages: [
						{ role: "system", content: "Sois bref." },
						{ role: "user", content: "Namek ?" },
					],
				},
			},
			{
				method: "POST",
				path: "/api/v1/shenron/ocr",
				query: {},
				headers: POST_HEADERS,
				body: { image_base64: "aW1n", engine: "gemini-web", language: "ja" },
			},
			{
				method: "GET",
				path: "/api/v1/shenron/rag/search",
				query: { q: "Goku", limit: "3", lang: "fr", entity: "Goku" },
				headers: GET_HEADERS,
				body: null,
			},
			{
				method: "POST",
				path: "/api/v1/shenron/embed",
				query: {},
				headers: POST_HEADERS,
				body: { texts: ["Goku"], kind: "passage" },
			},
			{ method: "GET", path: "/api/v1/shenron/rag/stats", query: {}, headers: GET_HEADERS, body: null },
			{
				method: "GET",
				path: "/api/v1/shenron/rag/document",
				query: { sourceId: "shenron:42" },
				headers: GET_HEADERS,
				body: null,
			},
			{
				method: "POST",
				path: "/api/v1/shenron/rag/ingest",
				query: {},
				headers: POST_HEADERS,
				body: doc,
			},
			{
				method: "POST",
				path: "/api/v1/shenron/rag/sync/finish",
				query: {},
				headers: POST_HEADERS,
				body: { originSourceId: "db_characters", syncGeneration: generation, expectedCount: 2 },
			},
		]);
	});

	test("B18: embed collapses whitespace and sends batches of 16", async () => {
		const { calls, fetcher } = computeServer();
		const client = new AphrodyComputeClient({ baseUrl: BASE, token: TOKEN, fetcher });
		const texts = Array.from({ length: 20 }, (_, i) => `  Goku\n  ${i} `);
		const vectors = await client.embed(texts);
		expect(vectors).toHaveLength(20);
		expect(calls.map((c) => (c.body as { texts: string[] }).texts.length)).toEqual([16, 4]);
		expect((calls[0]!.body as { texts: string[]; kind: string }).texts[0]).toBe("Goku 0");
		expect((calls[0]!.body as { kind: string }).kind).toBe("query");
	});

	test("legacy errors and messages are preserved", async () => {
		expect(() => new AphrodyComputeClient({ baseUrl: BASE, token: " " })).toThrow(
			"Aphrody compute token is not configured"
		);
		expect(() => new AphrodyComputeClient({ baseUrl: "http://10.0.0.1:8789", token: TOKEN })).toThrow(
			"Aphrody compute URL must use loopback HTTP"
		);
		const down = new AphrodyComputeClient({
			baseUrl: BASE,
			token: TOKEN,
			fetcher: (async () => new Response("", { status: 503 })) as unknown as typeof fetch,
		});
		await expect(down.ragStats()).rejects.toThrow("Aphrody compute HTTP 503 on /api/v1/shenron/rag/stats");
		await expect(down.embed([" "])).rejects.toThrow("Aphrody embedding input is empty");
		const empty = new AphrodyComputeClient({
			baseUrl: BASE,
			token: TOKEN,
			fetcher: (async () => Response.json({ answer: "  " })) as unknown as typeof fetch,
		});
		await expect(empty.chat([{ role: "user", content: "?" }])).rejects.toThrow(
			"Aphrody returned an empty LLM answer"
		);
		const missing = new AphrodyComputeClient({
			baseUrl: BASE,
			token: TOKEN,
			fetcher: (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
		});
		expect(await missing.ragDocument("shenron:7")).toBeNull();
	});
});

describe("facade defaults and call-time fetch", () => {
	// Every AI name the facades read (canonical and legacy), restored after each test.
	const names = [
		"APHRODY_AI_HTTP_URL",
		"APHRODY_AI_HTTP_TOKEN",
		"APHRODY_SHENRON_API_URL",
		"APHRODY_SHENRON_API_TOKEN",
		"APHRODY_AI_EMBED_BASE_URL",
		"APHRODY_SHENRON_EMBED_BASE_URL",
		"EMBED_URL",
		"APHRODY_RAG_EMBED_ENDPOINT",
	];
	const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	const savedFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = savedFetch;
		const restore = (name: string, value: string | undefined) => {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		};
		for (const name of names) restore(name, saved[name]);
	});

	test("no address default: a missing URL is an error naming the variables", () => {
		for (const name of names) delete process.env[name];
		process.env.APHRODY_SHENRON_API_TOKEN = TOKEN;
		expect(() => new AphrodyComputeClient()).toThrow(/APHRODY_AI_HTTP_URL.*APHRODY_SHENRON_API_URL/);
		process.env.APHRODY_AI_HTTP_URL = BASE;
		delete process.env.APHRODY_SHENRON_API_TOKEN;
		expect(() => new AphrodyComputeClient()).toThrow(/APHRODY_AI_HTTP_TOKEN/);
	});

	test("canonical names first, legacy aliases next; global fetch read at call time", async () => {
		for (const name of names) delete process.env[name];
		process.env.APHRODY_SHENRON_API_URL = "http://127.0.0.1:1";
		process.env.APHRODY_AI_HTTP_URL = BASE;
		process.env.APHRODY_SHENRON_API_TOKEN = TOKEN;
		const client = new AphrodyComputeClient();
		const { calls, fetcher } = computeServer();
		globalThis.fetch = fetcher; // replaced after construction
		await client.health();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.path).toBe("/api/v1/shenron/health");
	});

	test("EMBED_URL is an origin, APHRODY_SHENRON_EMBED_BASE_URL a base, no default", () => {
		expect(() => resolveShenronEmbeddingsBaseUrl({}, {})).toThrow(/APHRODY_AI_EMBED_BASE_URL/);
		expect(
			resolveShenronEmbeddingsBaseUrl(
				{},
				{ APHRODY_AI_EMBED_BASE_URL: "http://127.0.0.1:5018/v1", EMBED_URL: "http://127.0.0.1:5017" }
			).href
		).toBe("http://127.0.0.1:5018/v1");
		expect(resolveShenronEmbeddingsBaseUrl({}, { EMBED_URL: "http://127.0.0.1:5017" }).href).toBe(
			"http://127.0.0.1:5017/v1"
		);
		expect(
			resolveShenronEmbeddingsBaseUrl(
				{},
				{ EMBED_URL: "http://127.0.0.1:5017", APHRODY_SHENRON_EMBED_BASE_URL: "http://localhost:9/v1/" }
			).href
		).toBe("http://localhost:9/v1");
		expect(() => resolveShenronEmbeddingsBaseUrl({}, { EMBED_URL: "not a url" })).toThrow();
		expect(() => resolveShenronEmbeddingsBaseUrl({ baseUrl: "https://example.org/v1" })).toThrow(
			"loopback"
		);
	});
});

describe("ShenronEmbeddingsClient facade", () => {
	function embedServer(o: { dims?: number; status?: number } = {}) {
		return recorder((req) => {
			if (o.status) return new Response("{}", { status: o.status });
			const texts = (req.body as { texts: string[] }).texts;
			return Response.json({
				vectors: texts.map((_, index) =>
					Array.from({ length: o.dims ?? 384 }, (_, i) => (i + index) / 1000)
				),
			});
		});
	}

	test("Aphrody /api/v1/shenron/embed request shape, no client prefix, 16 per request", async () => {
		const { calls, fetcher } = embedServer();
		const client = new ShenronEmbeddingsClient({ baseUrl: BASE, token: TOKEN, fetcher });
		const texts = Array.from({ length: 18 }, (_, i) => ` Texte\n numéro ${i} `);
		const vectors = await client.embed(texts, "passage");
		expect(vectors).toHaveLength(18);
		expect(vectors[17]?.[0]).toBe(1 / 1000);
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			"POST /api/v1/shenron/embed",
			"POST /api/v1/shenron/embed",
		]);
		expect(calls[0]?.headers).toEqual(POST_HEADERS);
		const bodies = calls.map((c) => c.body as { texts: string[]; kind: string });
		expect(bodies.map((b) => b.texts.length)).toEqual([16, 2]);
		expect(bodies[0]?.kind).toBe("passage");
		expect(bodies[0]?.texts[0]).toBe("Texte numéro 0");
		expect(Object.keys(bodies[0] ?? {}).toSorted()).toEqual(["kind", "texts"]);
	});

	test("defaults to APHRODY_AI_HTTP_URL / APHRODY_AI_HTTP_TOKEN, no direct embedder needed", async () => {
		const { calls, fetcher } = embedServer();
		const client = new ShenronEmbeddingsClient({
			env: { APHRODY_AI_HTTP_URL: BASE, APHRODY_AI_HTTP_TOKEN: TOKEN },
			fetcher,
		});
		await client.embed(["Goku"], "query");
		expect(calls[0]?.path).toBe("/api/v1/shenron/embed");
		expect((calls[0]?.body as { kind: string }).kind).toBe("query");
		expect(() => new ShenronEmbeddingsClient({ env: {} })).toThrow(/APHRODY_AI_HTTP_URL/);
	});

	test("legacy error messages", async () => {
		const client = new ShenronEmbeddingsClient({
			baseUrl: BASE,
			token: TOKEN,
			fetcher: embedServer({ status: 503 }).fetcher,
		});
		await expect(client.embed(["Goku"], "query")).rejects.toThrow("Shenron embeddings HTTP 503");
		await expect(client.embed(["  "], "query")).rejects.toThrow("Shenron embedding input is empty");
		const bad = new ShenronEmbeddingsClient({
			baseUrl: BASE,
			token: TOKEN,
			fetcher: embedServer({ dims: 12 }).fetcher,
		});
		await expect(bad.embed(["Goku"], "query")).rejects.toThrow(
			"Shenron returned invalid embedding vectors"
		);
	});
});

describe("aphrodyComputeFromChat", () => {
	test("serves chat through the legacy-shaped function only", async () => {
		const compute = aphrodyComputeFromChat(async (messages, model) => ({
			answer: `${messages.length}:${model ?? "-"}`,
			model: "fixture",
		}));
		expect(
			await compute.chat({ messages: [{ role: "user", content: "?" }], model: "gemini-web/pro" })
		).toEqual({ ok: true, value: { answer: "1:gemini-web/pro", model: "fixture" } });
		expect(await compute.ragStats()).toMatchObject({ ok: false, kind: "not_configured" });
	});
});
