// SPDX-License-Identifier: Apache-2.0
/**
 * rag.ts on the aphrody-infra AI env contract: reranker dialects (llama-server
 * for the canonical APHRODY_AI_RERANK_BASE_URL, the Shenron sidecar for the
 * legacy RERANK_URL) and the startup check that refuses to mix embedding spaces.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { EmbeddingSpaceMismatchError } from "@shenron/pipeline/ai/config";
import { assertRagEmbeddingSpace, ragIndexSpace, rerankRequestBody, rerankScores } from "../src/lib/rag";

const NAMES = ["RAG_BACKEND", "APHRODY_AI_EMBED_MODEL", "APHRODY_AI_EMBED_DIMENSIONS", "APHRODY_RAG_EMBED_DIM"];
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
afterEach(() => {
	for (const name of NAMES) {
		if (saved[name] === undefined) delete process.env[name];
		else process.env[name] = saved[name];
	}
});

function indexWithMeta(model: string, dim: number): Database {
	const db = new Database(":memory:");
	db.exec("CREATE TABLE rag_meta (model TEXT, dim INTEGER, count INTEGER, built_at INTEGER)");
	db.query("INSERT INTO rag_meta VALUES (?, ?, 1, 0)").run(model, dim);
	return db;
}

describe("reranker dialects", () => {
	it("builds the request body of each dialect", () => {
		expect(rerankRequestBody({ dialect: "shenron-sidecar" }, "q", ["a", "b"])).toEqual({
			query: "q",
			passages: ["a", "b"],
		});
		expect(rerankRequestBody({ dialect: "llama-server", model: "qwen3-reranker" }, "q", ["a", "b"])).toEqual({
			model: "qwen3-reranker",
			query: "q",
			documents: ["a", "b"],
			top_n: 2,
		});
	});

	it("keeps sidecar probabilities as they are and checks their count", () => {
		expect(rerankScores("shenron-sidecar", { scores: [0.9, 0.1] }, 2)).toEqual([0.9, 0.1]);
		expect(rerankScores("shenron-sidecar", { scores: [0.9] }, 2)).toBeNull();
		expect(rerankScores("shenron-sidecar", { scores: [0.9, "x"] }, 2)).toBeNull();
	});

	it("maps llama-server results back to input order through the logistic function", () => {
		const scores = rerankScores(
			"llama-server",
			{ results: [{ index: 1, relevance_score: 0 }, { index: 0, relevance_score: 4 }] },
			2
		);
		expect(scores?.[1]).toBe(0.5);
		expect(scores?.[0]).toBeCloseTo(1 / (1 + Math.exp(-4)), 12);
		expect(rerankScores("llama-server", { results: [{ index: 0, score: 0 }] }, 1)).toEqual([0.5]);
	});

	it("rejects incomplete, duplicated or out-of-range llama-server results", () => {
		expect(rerankScores("llama-server", { results: [{ index: 0, relevance_score: 1 }] }, 2)).toBeNull();
		expect(
			rerankScores("llama-server", { results: [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 2 }] }, 2)
		).toBeNull();
		expect(rerankScores("llama-server", { results: [{ index: 3, relevance_score: 1 }] }, 1)).toBeNull();
		expect(rerankScores("llama-server", { error: "down" }, 1)).toBeNull();
	});
});

describe("embedding space at startup (never mix spaces)", () => {
	it("accepts the contract space against a matching local index", () => {
		delete process.env.RAG_BACKEND;
		const db = indexWithMeta("Xenova/multilingual-e5-small", 384);
		expect(assertRagEmbeddingSpace(db)).toEqual({ model: "Xenova/multilingual-e5-small", dimensions: 384 });
		db.close();
	});

	it("fails hard when the configured dimension differs from the index", () => {
		delete process.env.RAG_BACKEND;
		process.env.APHRODY_AI_EMBED_DIMENSIONS = "1024";
		const db = indexWithMeta("Xenova/multilingual-e5-small", 384);
		expect(() => assertRagEmbeddingSpace(db)).toThrow(EmbeddingSpaceMismatchError);
		db.close();
	});

	it("fails hard when the local index was built in another space", () => {
		delete process.env.RAG_BACKEND;
		const db = indexWithMeta("Xenova/multilingual-e5-small", 768);
		expect(() => assertRagEmbeddingSpace(db)).toThrow(/rag_meta/);
		db.close();
	});

	it("uses the contract index shenron-rag in Aphrody mode, whatever the local table says", () => {
		process.env.RAG_BACKEND = "aphrody";
		const db = indexWithMeta("other-model", 768);
		expect(ragIndexSpace(db).label).toBe("shenron-rag");
		expect(assertRagEmbeddingSpace(db).dimensions).toBe(384);
		process.env.APHRODY_RAG_EMBED_DIM = "768";
		expect(() => assertRagEmbeddingSpace(db)).toThrow(/shenron-rag/);
		db.close();
	});

	it("falls back to the contract when no local index exists", () => {
		delete process.env.RAG_BACKEND;
		const db = new Database(":memory:");
		expect(ragIndexSpace(db)).toEqual({
			space: { model: "Xenova/multilingual-e5-small", dimensions: 384 },
			label: "shenron-rag",
		});
		db.close();
	});
});
