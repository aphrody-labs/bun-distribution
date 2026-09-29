// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRecordingFetch } from "@shenron/config/testing";
import { createAphrodyCompute } from "../../src/ai/aphrody";
import type { AiConfig } from "../../src/ai/config";
import { DEFAULT_AI_TIMEOUTS, SHENRON_RAG_INDEX } from "../../src/ai/config";
import {
	aphrodyEmbeddingModel,
	e5DirectEmbeddingModel,
	embedPassages,
	embedQuery,
	selectEmbeddingModel,
} from "../../src/ai/embeddings";
import { json, loopbackBase, TOKEN, vector } from "./helpers";

const BASE = loopbackBase();
const E5_BASE = loopbackBase(18794, "/v1");

/** OpenAI-compatible E5 sidecar answering in index order (or shuffled / short on demand). */
function e5Server(o: { shuffle?: boolean; dims?: number } = {}) {
	return createRecordingFetch({
		"POST /v1/embeddings": async (req) => {
			const body = (await req.json()) as { input: string[] };
			const data = body.input.map((_, index) => ({
				object: "embedding",
				index,
				embedding: vector(index, o.dims),
			}));
			if (o.shuffle && data.length > 1) data.reverse();
			return json({ object: "list", data, model: "Xenova/multilingual-e5-small" });
		},
	});
}

function aphrodyServer() {
	return createRecordingFetch({
		"POST /api/v1/shenron/embed": async (req) => {
			const body = (await req.json()) as { texts: string[] };
			return json({
				vectors: body.texts.map((_, i) => vector(i)),
				model: "Xenova/multilingual-e5-small",
			});
		},
	});
}

const bodies = (calls: { body: string | null }[]) => calls.map((c) => JSON.parse(c.body ?? "null"));

describe("aphrody transport", () => {
	test("no 'query: '/'passage: ' prefix, whitespace collapsed", async () => {
		const rec = aphrodyServer();
		const compute = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
		const r = await embedQuery(aphrodyEmbeddingModel(compute, "query"), "  Qui   est\nGoku ? ", {
			timeoutMs: 1000,
		});
		expect(r.ok && r.value.length).toBe(384);
		expect(bodies(rec.calls)).toEqual([{ texts: ["Qui est Goku ?"], kind: "query" }]);
	});

	test("40 passages -> 3 sequential calls 16/16/8", async () => {
		const rec = aphrodyServer();
		const compute = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
		const texts = Array.from({ length: 40 }, (_, i) => `passage ${i}`);
		const r = await embedPassages(aphrodyEmbeddingModel(compute, "passage"), texts, {
			timeoutMs: 5000,
		});
		expect(r.ok && r.value.length).toBe(40);
		expect(bodies(rec.calls).map((b) => b.texts.length)).toEqual([16, 16, 8]);
		expect(
			bodies(rec.calls).every((b) => b.kind === "passage" && !b.texts[0].startsWith("passage: "))
		).toBe(true);
	});

	test("one fetch only on a 503 (no retry)", async () => {
		const rec = createRecordingFetch({
			"POST /api/v1/shenron/embed": () => json({ error: "x" }, { status: 503 }),
		});
		const compute = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
		const r = await embedQuery(aphrodyEmbeddingModel(compute, "query"), "Goku", {
			timeoutMs: 1000,
		});
		expect(r).toMatchObject({ ok: false, kind: "http", status: 503 });
		expect(rec.calls.length).toBe(1);
	});
});

describe("e5-direct transport", () => {
	test("exactly one prefix, whitespace collapsed", async () => {
		const rec = e5Server();
		const model = e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "query", { fetch: rec.fetch });
		const r = await embedQuery(model, "  Qui   est\tGoku ? ", { timeoutMs: 1000 });
		expect(r.ok).toBe(true);
		const [body] = bodies(rec.calls);
		expect(body.model).toBe("Xenova/multilingual-e5-small");
		expect(body.input).toEqual(["query: Qui est Goku ?"]);
		const again = e5Server();
		await embedQuery(
			e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "query", { fetch: again.fetch }),
			"query: Goku",
			{
				timeoutMs: 1000,
			}
		);
		expect(bodies(again.calls)[0].input).toEqual(["query: Goku"]);
	});

	test("40 inputs -> 3 sequential calls 16/16/8", async () => {
		const rec = e5Server();
		const model = e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "passage", { fetch: rec.fetch });
		const texts = Array.from({ length: 40 }, (_, i) => `texte ${i}`);
		const r = await embedPassages(model, texts, { timeoutMs: 5000 });
		expect(r.ok && r.value.length).toBe(40);
		expect(bodies(rec.calls).map((b) => b.input.length)).toEqual([16, 16, 8]);
		expect(bodies(rec.calls)[2].input[7]).toBe("passage: texte 39");
	});

	test("a 383-dim or shuffled-index response fails", async () => {
		for (const server of [e5Server({ dims: 383 }), e5Server({ shuffle: true })]) {
			const model = e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "passage", {
				fetch: server.fetch,
			});
			const r = await embedPassages(model, ["a", "b"], { timeoutMs: 1000 });
			expect(r).toMatchObject({ ok: false, kind: "invalid_response" });
		}
	});

	test("empty input is rejected without a call", async () => {
		const rec = e5Server();
		const model = e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "query", { fetch: rec.fetch });
		expect((await embedQuery(model, "  \n ", { timeoutMs: 1000 })).ok).toBe(false);
		expect(rec.calls.length).toBe(0);
	});

	test("one fetch only on a 503 (no retry)", async () => {
		const rec = createRecordingFetch({
			"POST /v1/embeddings": () => json({ error: { message: "down" } }, { status: 503 }),
		});
		const model = e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "query", { fetch: rec.fetch });
		const r = await embedQuery(model, "Goku", { timeoutMs: 1000 });
		expect(r).toMatchObject({ ok: false, kind: "http", status: 503, path: "/v1/embeddings" });
		expect(rec.calls.length).toBe(1);
	});

	const legacyPath = join(import.meta.dir, "..", "..", "aphrody", "src", "shenron-embeddings.ts");
	test.skipIf(!existsSync(legacyPath))(
		"parity with ShenronEmbeddingsClient request JSON and vectors",
		async () => {
			const { ShenronEmbeddingsClient } = (await import(legacyPath)) as {
				ShenronEmbeddingsClient: new (o: { baseUrl: string; fetcher: typeof fetch }) => {
					embed(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
				};
			};
			const texts = Array.from({ length: 20 }, (_, i) => ` Texte\n numéro ${i} `);
			const oldRec = e5Server();
			const newRec = e5Server();
			const oldVectors = await new ShenronEmbeddingsClient({
				baseUrl: E5_BASE.href,
				fetcher: oldRec.fetch,
			}).embed(texts, "passage");
			const model = e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "passage", {
				fetch: newRec.fetch,
			});
			const r = await embedPassages(model, texts, { timeoutMs: 5000 });
			expect(r.ok && r.value).toEqual(oldVectors);
			expect(newRec.calls.map((c) => c.url)).toEqual(oldRec.calls.map((c) => c.url));
			// Same model and inputs; the AI SDK adds `encoding_format: "float"` (the E5 server's default).
			const pick = (b: { model: string; input: string[] }) => ({ model: b.model, input: b.input });
			expect(bodies(newRec.calls).map(pick)).toEqual(bodies(oldRec.calls).map(pick));
		}
	);
});

describe("selectEmbeddingModel", () => {
	const base: AiConfig = {
		compute: null,
		embed: null,
		e5BaseUrl: null,
		embedSpace: { model: SHENRON_RAG_INDEX.model, dimensions: SHENRON_RAG_INDEX.dimensions },
		rerank: null,
		chatModel: "gemini-web/flash",
		visionModel: "gemini-web/flash",
		ragBackend: "local",
		timeouts: { ...DEFAULT_AI_TIMEOUTS },
		disabled: [],
	};
	test("chosen by configuration", () => {
		expect(selectEmbeddingModel(base, "query", { compute: null })).toBeNull();
		const compute = createAphrodyCompute({ baseUrl: BASE, token: TOKEN });
		expect(
			selectEmbeddingModel({ ...base, embed: { transport: "aphrody" } }, "query", { compute })
				?.provider
		).toBe("aphrody.shenron");
		expect(
			selectEmbeddingModel({ ...base, embed: { transport: "aphrody" } }, "query", { compute: null })
		).toBeNull();
		const e5 = selectEmbeddingModel(
			{ ...base, embed: { transport: "e5-direct", baseUrl: E5_BASE } },
			"query",
			{
				compute,
			}
		);
		expect(e5?.provider).toContain("shenron-e5");
	});
});
