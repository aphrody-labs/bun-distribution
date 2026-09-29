// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { AphrodyComputeClient } from "./compute";
import { AphrodyWebClient } from "./web";

// B18 (docs/STACK.md §2.2): the embed path now checks 384-dimensional vectors.
const E5_VECTOR = Array.from({ length: 384 }, (_, i) => i / 384);
// No address default any more (the resolver has none): every client gets an explicit loopback base.
const TEST_BASE = "http://127.0.0.1:8789";

describe("AphrodyComputeClient", () => {
	it("rejects an unconfigured or nonloopback compute boundary", () => {
		expect(() => new AphrodyComputeClient({ token: "", baseUrl: "http://127.0.0.1:8789" })).toThrow("token");
		expect(() => new AphrodyComputeClient({ token: "fixture", baseUrl: "https://aphrody.com" })).toThrow("loopback");
	});

	it("sends authenticated chat and validates the answer", async () => {
		let path = "";
		let authorization = "";
		let payload: unknown;
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
				path = new URL(String(input)).pathname;
				authorization = new Headers(init?.headers).get("authorization") ?? "";
				payload = JSON.parse(String(init?.body));
				return Response.json({ answer: "réponse sourcée", model: "fixture-model" });
			}) as unknown as typeof fetch,
		});
		expect(await client.chat([{ role: "user", content: "Namek ?" }])).toEqual({ answer: "réponse sourcée", model: "fixture-model" });
		expect(path).toBe("/api/v1/shenron/llm/chat");
		expect(authorization).toBe("Bearer fixture");
		expect(payload).toEqual({ messages: [{ role: "user", content: "Namek ?" }] });
	});

	it("selects Gemini Web for text OCR while keeping page geometry explicit", async () => {
		let payload: Record<string, unknown> | undefined;
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async (_input, init) => {
				payload = JSON.parse(String(init?.body));
				return Response.json({ text: "悟空", language: "ja", textless: false, suspect: false, model: "gemini-web/flash" });
			}) as typeof fetch,
		});
		expect((await client.ocr("fixture-base64", "ja")).text).toBe("悟空");
		expect(payload).toEqual({ image_base64: "fixture-base64", engine: "gemini-web", language: "ja" });
	});

	it("rejects malformed RAG results instead of inventing hits", async () => {
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async () => Response.json({ results: [{ title: "sans source" }] })) as unknown as typeof fetch,
		});
		await expect(client.ragSearch("Goku")).rejects.toThrow("invalid RAG hit");
	});

	it("reports the retrieval mode returned by Aphrody", async () => {
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async () => Response.json({ mode: "hybrid", results: [{ title: "Goku", url: "https://dragonballfr.com/wiki/son-goku", snippet: "Saiyan", score: 0.9, kind: "character" }] })) as unknown as typeof fetch,
		});
		expect((await client.ragSearchWithMode("Goku")).mode).toBe("hybrid");
	});

	it("routes embeddings, stats and source lookup through the private boundary", async () => {
		const paths: string[] = [];
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async (input, init) => {
				const url = new URL(String(input));
				paths.push(url.pathname);
				expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture");
				if (url.pathname.endsWith("/embed")) {
					expect(JSON.parse(String(init?.body))).toEqual({ texts: ["Goku"], kind: "query" });
					return Response.json({ vectors: [E5_VECTOR] });
				}
				if (url.pathname.endsWith("/stats")) return Response.json({ chunks: 59995, vectors: 0, sources: [] });
				expect(url.searchParams.get("sourceId")).toBe("shenron:42");
				return Response.json({ document: { sourceId: "shenron:42", title: "Son Goku", url: "/wiki/son-goku", kind: "character", snippet: "Saiyan" } });
			}) as typeof fetch,
		});
		expect(await client.embed(["Goku"])).toEqual([E5_VECTOR]);
		expect((await client.ragStats()).chunks).toBe(59995);
		expect((await client.ragDocument("shenron:42"))?.title).toBe("Son Goku");
		expect(paths).toEqual(["/api/v1/shenron/embed", "/api/v1/shenron/rag/stats", "/api/v1/shenron/rag/document"]);
	});

	it("rejects invalid embedding dimensions and nonfinite values", async () => {
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async () => Response.json({ vectors: [[1, null]] })) as unknown as typeof fetch,
		});
		await expect(client.embed(["Goku"])).rejects.toThrow("invalid embedding vectors");
	});

	it("accepts deterministic PostgreSQL source IDs for remote generation checks", async () => {
		const sourceId = "shenron:pg:db_characters:0123456789abcdef01234567:0";
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async (input: RequestInfo | URL) => {
				expect(new URL(String(input)).searchParams.get("sourceId")).toBe(sourceId);
				return Response.json({ document: { sourceId, title: "Son Goku", url: "https://dragonballfr.com/wiki/son-goku", kind: "character", snippet: "Saiyan" } });
			}) as typeof fetch,
		});
		expect((await client.ragDocument(sourceId))?.sourceId).toBe(sourceId);
		await expect(client.ragDocument("shenron:pg:../invalid")).rejects.toThrow("Invalid Shenron RAG source ID");
	});

	it("uses passage kind for source embeddings", async () => {
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async (_input: RequestInfo | URL, init?: RequestInit) => {
				expect(JSON.parse(String(init?.body))).toEqual({ texts: ["source"], kind: "passage" });
				return Response.json({ vectors: [E5_VECTOR] });
			}) as unknown as typeof fetch,
		});
		expect(await client.embed(["source"], "passage")).toEqual([E5_VECTOR]);
	});

	it("confirms a complete editorial RAG generation before retirement", async () => {
		const generation = "12345678-1234-4123-8123-123456789abc";
		const client = new AphrodyComputeClient({
			baseUrl: TEST_BASE,
			token: "fixture",
			fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
				expect(new URL(String(input)).pathname).toBe("/api/v1/shenron/rag/sync/finish");
				expect(JSON.parse(String(init?.body))).toEqual({ originSourceId: "db_characters", syncGeneration: generation, expectedCount: 2 });
				return Response.json({ status: "complete", active: 2, retired: 4 });
			}) as unknown as typeof fetch,
		});
		expect(await client.ragSyncFinish("db_characters", generation, 2)).toEqual({ retired: 4 });
		await expect(client.ragSyncFinish("db_characters", generation, 0)).rejects.toThrow("Invalid Aphrody RAG sync completion request");
	});
});

describe("AphrodyWebClient", () => {
	it("uses native BXC paths on the private VPS listener", async () => {
		const paths: string[] = [];
		const client = new AphrodyWebClient({
			token: "fixture",
			baseUrl: "http://127.0.0.1:3007",
			fetcher: (async (input) => {
				paths.push(new URL(String(input)).pathname);
				return Response.json({ success: true, job: { id: "12345678-1234-1234-1234-123456789abc", status: "completed", stats: {} } });
			}) as typeof fetch,
		});
		const job = await client.crawl({ urls: ["https://example.org/news"], maxRequests: 1 });
		await client.status(job.id);
		expect(paths).toEqual(["/api/v1/crawl", "/api/v1/crawl/stats"]);
	});

	it("submits a bounded authenticated crawl and reads its status", async () => {
		const paths: string[] = [];
		const client = new AphrodyWebClient({
			token: "fixture",
			baseUrl: "https://aphrody.com",
			fetcher: (async (input, init) => {
				paths.push(new URL(String(input)).pathname);
				expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture");
				return Response.json({ success: true, job: { id: "12345678-1234-1234-1234-123456789abc", status: paths.length === 1 ? "running" : "completed", stats: {} } });
			}) as typeof fetch,
		});
		const job = await client.crawl({ urls: ["https://example.org/news"], maxDepth: 1 });
		expect(job.status).toBe("running");
		expect((await client.status(job.id)).status).toBe("completed");
		expect(paths).toEqual(["/api/v1/web/crawl", "/api/v1/web/crawl/stats"]);
	});
});
