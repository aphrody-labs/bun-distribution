// SPDX-License-Identifier: Apache-2.0
/**
 * rag.ts on the aphrody-infra AI env contract: reranker dialects (llama-server
 * for the canonical APHRODY_AI_RERANK_BASE_URL, the Shenron sidecar for the
 * legacy RERANK_URL) and the startup check that refuses to mix embedding spaces.
 */
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSql } from "@shenron/db/sql";
import { loadLiveRagEnv, requireLiveRag } from "@shenron/pipeline/testing/live-rag";
import { EmbeddingSpaceMismatchError } from "@shenron/pipeline/ai/config";
import {
  assertRagEmbeddingSpace,
  ragIndexSpace,
  rerankRequestBody,
  rerankScores,
} from "../src/lib/rag";

const NAMES = [
  "RAG_BACKEND",
  "APHRODY_AI_EMBED_MODEL",
  "APHRODY_AI_EMBED_DIMENSIONS",
  "APHRODY_RAG_EMBED_DIM",
];
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("reranker dialects", () => {
  it("builds the request body of each dialect", () => {
    expect(rerankRequestBody({ dialect: "shenron-sidecar" }, "q", ["a", "b"])).toEqual({
      query: "q",
      passages: ["a", "b"],
    });
    expect(
      rerankRequestBody({ dialect: "llama-server", model: "qwen3-reranker" }, "q", ["a", "b"]),
    ).toEqual({
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
      {
        results: [
          { index: 1, relevance_score: 0 },
          { index: 0, relevance_score: 4 },
        ],
      },
      2,
    );
    expect(scores?.[1]).toBe(0.5);
    expect(scores?.[0]).toBeCloseTo(1 / (1 + Math.exp(-4)), 12);
    expect(rerankScores("llama-server", { results: [{ index: 0, score: 0 }] }, 1)).toEqual([0.5]);
  });

  it("rejects incomplete, duplicated or out-of-range llama-server results", () => {
    expect(
      rerankScores("llama-server", { results: [{ index: 0, relevance_score: 1 }] }, 2),
    ).toBeNull();
    expect(
      rerankScores(
        "llama-server",
        {
          results: [
            { index: 0, relevance_score: 1 },
            { index: 0, relevance_score: 2 },
          ],
        },
        2,
      ),
    ).toBeNull();
    expect(
      rerankScores("llama-server", { results: [{ index: 3, relevance_score: 1 }] }, 1),
    ).toBeNull();
    expect(rerankScores("llama-server", { error: "down" }, 1)).toBeNull();
  });
});

describe("embedding space against the real Shenron PostgreSQL index", () => {
  beforeAll(async () => {
    loadLiveRagEnv();
    await requireLiveRag();
  }, 120_000);

  it("uses the configured E5 space and its genuine preloaded pgvector column", async () => {
    expect(ragIndexSpace(null).label).toBe("shenron-rag");
    expect(assertRagEmbeddingSpace(null)).toEqual({
      model: "Xenova/multilingual-e5-small",
      dimensions: 384,
    });
    const sql = createSql({
      url: process.env.APHRODY_MCP_DATABASE_URL,
      applicationName: "shenron-live-embedding-space",
      max: 1,
    });
    try {
      const rows = await sql<{ model: string; dimensions: number; count: string }[]>`
        SELECT model, vector_dims(embedding) AS dimensions, count(*) AS count
        FROM aphrody_shenron_vectors GROUP BY 1, 2`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.model).toBe("Xenova/multilingual-e5-small");
      expect(rows[0]?.dimensions).toBe(384);
      expect(Number(rows[0]?.count)).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  });

  it("rejects a configured dimension mismatch without rebuilding the served index", () => {
    process.env.APHRODY_AI_EMBED_DIMENSIONS = "1024";
    expect(() => assertRagEmbeddingSpace(null)).toThrow(EmbeddingSpaceMismatchError);
  });

  it("also refuses an incompatible legacy embedding dimension", () => {
    delete process.env.APHRODY_AI_EMBED_DIMENSIONS;
    process.env.APHRODY_RAG_EMBED_DIM = "768";
    expect(() => assertRagEmbeddingSpace(null)).toThrow(/shenron-rag/);
  });
});
