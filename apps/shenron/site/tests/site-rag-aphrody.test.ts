// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { loadLiveRagEnv, requireLiveRag } from "@shenron/pipeline/testing/live-rag";

// Next's build marker has no Bun test loader; computation and data stay real.
mock.module("server-only", () => ({}));
loadLiveRagEnv();
const { chatAphrodyRag, searchAphrodyRag, usesAphrodyRag } = await import("../src/lib/site-rag");
beforeAll(async () => {
  await requireLiveRag();
}, 120_000);

describe("site RAG on the preloaded Shenron production services", () => {
  test("searches the real PostgreSQL corpus through the shared private API", async () => {
    expect(usesAphrodyRag()).toBe(true);
    const result = await searchAphrodyRag("Son Goku", 5, { lang: "fr", sourceId: "db_characters" });
    expect(result.mode).toBe("hybrid");
    expect(result.results.length).toBeGreaterThan(0);
    expect(
      result.results.every((hit) => hit.originSourceId === "db_characters" && hit.lang === "fr"),
    ).toBe(true);
    expect(
      result.results.every(
        (hit) => hit.content?.trim() && hit.url.startsWith("https://dragonballfr.com/"),
      ),
    ).toBe(true);
  });
  test("grounds a Whis answer in real Namek passages", async () => {
    const result = await chatAphrodyRag("Sur quelle planète vivent les Nameks ?", "whis", {
      lang: "fr",
      sourceId: "db_planets",
    });
    expect(result.mode).toBe("hybrid");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.answer.trim().length).toBeGreaterThan(0);
    expect(result.answer).toMatch(/namek/i);
  }, 120_000);

  test("grounds the Shenron persona in the same real source", async () => {
    const result = await chatAphrodyRag("Qui est Son Goku ?", "shenron", {
      lang: "fr",
      sourceId: "db_characters",
    });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.answer.trim().length).toBeGreaterThan(0);
    expect(result.answer).toMatch(/goku|saiyan/i);
  }, 120_000);

  test("returns no answer when the real filtered retrieval has no passages", async () => {
    const result = await chatAphrodyRag("Son Goku", "whis", {
      sourceId: "source_absente_qualification",
    });
    expect(result.hits).toHaveLength(0);
    expect(result.answer).toBe("");
  });
});
