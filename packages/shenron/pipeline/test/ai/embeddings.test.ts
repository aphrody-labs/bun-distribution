// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
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
const ENV = { APHRODY_AI_HTTP_URL: BASE.href, APHRODY_AI_HTTP_TOKEN: TOKEN };

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

describe("e5DirectEmbeddingModel (now routed to Aphrody)", () => {
	test("posts to /api/v1/shenron/embed with the Bearer token, never /v1/embeddings", async () => {
		const rec = aphrodyServer();
		const model = e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "query", {
			fetch: rec.fetch,
			env: ENV,
		});
		expect(model.provider).toBe("aphrody.shenron");
		const r = await embedQuery(model, "  Qui   est\tGoku ? ", { timeoutMs: 1000 });
		expect(r.ok && r.value.length).toBe(384);
		expect(rec.calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/v1/shenron/embed"]);
		expect(bodies(rec.calls)).toEqual([{ texts: ["Qui est Goku ?"], kind: "query" }]);
	});

	test("direct embedder URL is ignored; missing Aphrody config throws naming the variables", () => {
		expect(() =>
			e5DirectEmbeddingModel({ baseUrl: E5_BASE }, "passage", {
				env: { APHRODY_AI_EMBED_BASE_URL: E5_BASE.href },
			})
		).toThrow(/APHRODY_AI_HTTP_URL/);
	});

	test("40 inputs -> 3 sequential calls 16/16/8", async () => {
		const rec = aphrodyServer();
		const model = e5DirectEmbeddingModel(null, "passage", { fetch: rec.fetch, env: ENV });
		const texts = Array.from({ length: 40 }, (_, i) => `texte ${i}`);
		const r = await embedPassages(model, texts, { timeoutMs: 5000 });
		expect(r.ok && r.value.length).toBe(40);
		expect(bodies(rec.calls).map((b) => b.texts.length)).toEqual([16, 16, 8]);
	});

	test("one fetch only on a 503 (no retry), Aphrody path reported", async () => {
		const rec = createRecordingFetch({
			"POST /api/v1/shenron/embed": () => json({ error: "down" }, { status: 503 }),
		});
		const model = e5DirectEmbeddingModel(null, "query", { fetch: rec.fetch, env: ENV });
		const r = await embedQuery(model, "Goku", { timeoutMs: 1000 });
		expect(r).toMatchObject({ ok: false, kind: "http", status: 503, path: "/api/v1/shenron/embed" });
		expect(rec.calls.length).toBe(1);
	});
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
	});
});
