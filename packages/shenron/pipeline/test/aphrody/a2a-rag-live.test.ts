// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultA2AProbes, ShenronA2AHub } from "../../src/aphrody/a2a";
import { loadLiveRagEnv, requireLiveRag } from "../../src/testing/live-rag";

loadLiveRagEnv();
const previous = process.env.A2A_COORD_DIR;
const coord = mkdtempSync(join(tmpdir(), "shenron-a2a-live-rag-"));
beforeAll(async () => {
  await requireLiveRag();
  process.env.A2A_COORD_DIR = coord;
  ShenronA2AHub.resetProbes();
}, 120_000);
afterAll(() => {
  if (previous === undefined) delete process.env.A2A_COORD_DIR;
  else process.env.A2A_COORD_DIR = previous;
  ShenronA2AHub.resetProbes();
  rmSync(coord, { recursive: true, force: true });
});

describe("A2A with the real preloaded Shenron RAG", () => {
  test("the default probe uses the configured hybrid backend and bounded sourced context", async () => {
    const result = await defaultA2AProbes.ragContext("origine du Super Saiyan", { maxChars: 1800 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Real Shenron A2A retrieval failed");
    expect(result.endpoint).toEndWith("/api/v1/shenron/rag/search");
    expect(result.mode).toBe("hybrid");
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.context.length).toBeLessThanOrEqual(1800);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(new Set(result.sources.map((source) => source.url)).size).toBe(result.sources.length);
    for (const source of result.sources) {
      expect(source.url).toMatch(/^https?:\/\//);
      expect(source.sourceId).toMatch(/^shenron:pg:/);
    }
  });

  test("returns a completed RAG task with genuine editorial sources", async () => {
    const result = await ShenronA2AHub.sendMessage({
      target: "rag",
      sourceAgent: "test-runner",
      instruction: "origine du Super Saiyan",
    });
    expect(result.verdict).toBe("FAIT");
    expect(result.task.status).toBe("completed");
    const sources = result.responseData.sources as Array<{ title: string; url: string }>;
    expect(sources.length).toBeGreaterThan(0);
    expect(result.responseMarkdown).toContain(sources[0]!.title);
    expect(result.responseMarkdown).toContain(sources[0]!.url);
    expect(result.responseData.canonChecked).toBeUndefined();
    expect(result.task.artifacts).toHaveLength(2);
  });

  test("a genuine unauthorized request cannot produce a successful RAG task", async () => {
    const token = process.env.APHRODY_AI_HTTP_TOKEN;
    try {
      process.env.APHRODY_AI_HTTP_TOKEN = "invalid-qualification-credential";
      const result = await ShenronA2AHub.sendMessage({ target: "rag", instruction: "Son Goku" });
      expect(result.verdict).toBe("NON_FAIT");
      expect(result.task.status).toBe("failed");
      expect(JSON.stringify(result.responseData).includes(token!)).toBe(false);
    } finally {
      process.env.APHRODY_AI_HTTP_TOKEN = token;
    }
  });
});
