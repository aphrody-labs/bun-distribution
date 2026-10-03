// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from "bun:test";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "@shenron/pipeline/testing/live-rag";

loadLiveRagEnv();
const { hybridSearch } = await import("../src/lib/rag");
let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

describe("real Shenron RAG metadata filtering", () => {
  it("keeps French character retrieval inside the requested source and kind", async () => {
    const kind = live.stats.sources.find((source) => source.sourceId === "db_characters")!.kind;
    const { results, mode } = await hybridSearch(null, "Son Goku", 10, {
      sourceId: "db_characters",
      kind,
      lang: "fr",
    });
    expect(mode).toBe("hybrid");
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (hit) => hit.sourceId === "db_characters" && hit.kind === kind && hit.lang === "fr",
      ),
    ).toBe(true);
  });
  it("applies the real editorial entity value", async () => {
    const probe = await live.client.ragSearchWithMode("Son Goku", 5, { sourceId: "db_characters" });
    const entity = probe.results.find((hit) => hit.entity)?.entity;
    expect(entity?.length).toBeGreaterThan(0);
    const result = await live.client.ragSearchWithMode("Son Goku", 10, { entity });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((hit) => hit.entity === entity)).toBe(true);
  });
  it("preserves distinct real manga passages", async () => {
    const result = await live.client.ragSearchWithMode("悟空", 10, {
      sourceId: "manga",
      lang: "ja",
    });
    expect(result.mode).toBe("hybrid");
    expect(result.results.length).toBeGreaterThan(1);
    expect(result.results.every((hit) => hit.originSourceId === "manga" && hit.lang === "ja")).toBe(
      true,
    );
    expect(new Set(result.results.map((hit) => hit.sourceId)).size).toBe(result.results.length);
  });
  it("diversifies real wiki citations by URL", async () => {
    const { results } = await hybridSearch(null, "Kamehameha", 10, { sourceId: "db_techniques" });
    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results.map((hit) => hit.url)).size).toBe(results.length);
  });
  it("returns a real empty filtered result for an absent source", async () => {
    const { results } = await hybridSearch(null, "Son Goku", 5, {
      sourceId: "source_absente_qualification",
    });
    expect(results).toHaveLength(0);
  });
  it("accepts Japanese and special punctuation through the real search engine", async () => {
    const latin = await hybridSearch(null, '[Attaque] "Kamehameha" : (Goku)?', 10);
    expect(latin.results.length).toBeGreaterThan(0);
    const japanese = await hybridSearch(null, "「かめはめ波！」", 10);
    expect(japanese.results.length).toBeGreaterThan(0);
  });
});
