// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, test } from "bun:test";
import { createAphrodyCompute } from "../../src/ai/aphrody";
import { requireAiHttpToken, requireAiHttpUrl } from "../../src/ai/config";
import { AphrodyComputeClient } from "../../src/aphrody/compute";
import { aphrodyNative } from "../../src/aphrody/native";
import { RagSearchResponse } from "../../src/ai/wire";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "../../src/testing/live-rag";
import { recordLiveRagRequests } from "../../src/testing/live-rag-requests";

loadLiveRagEnv();
let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

function clients() {
  const modernRequests = recordLiveRagRequests();
  const legacyRequests = recordLiveRagRequests();
  const cfg = { baseUrl: requireAiHttpUrl(process.env), token: requireAiHttpToken(process.env) };
  return {
    modern: createAphrodyCompute(cfg, { fetch: modernRequests.fetcher }),
    legacy: new AphrodyComputeClient({ fetcher: legacyRequests.fetcher }),
    modernCalls: modernRequests.calls,
    legacyCalls: legacyRequests.calls,
  };
}

describe("compute facades against the preloaded Shenron PostgreSQL RAG", () => {
  test("sends matching authenticated filters and returns the same real hybrid passages", async () => {
    const { modern, legacy, modernCalls, legacyCalls } = clients();
    const filters = { lang: "fr", kind: "character", sourceId: "db_characters" };
    const current = await modern.ragSearch({ q: "Son Goku", limit: 3, ...filters });
    const previous = await legacy.ragSearchWithMode("Son Goku", 3, filters);
    expect(current.ok).toBe(true);
    if (!current.ok) throw new Error("Real Shenron search failed");
    expect(current.value.mode).toBe("hybrid");
    expect(current.value.results.length).toBeGreaterThan(0);
    expect(current.value).toEqual(previous);
    expect(modernCalls).toEqual(legacyCalls);
    expect(modernCalls[0]).toEqual({
      method: "GET",
      path: "/api/v1/shenron/rag/search",
      query: { q: "Son Goku", limit: "3", ...filters },
      authenticated: true,
      body: null,
    });
    const entity = previous.results[0]?.entity;
    expect(entity).toBeDefined();
    const narrowed = await legacy.ragSearch("Son Goku", 3, { ...filters, entity });
    expect(narrowed.length).toBeGreaterThan(0);
    expect(
      narrowed.every((hit) => hit.entity === entity && hit.originSourceId === "db_characters"),
    ).toBe(true);
  });

  test("loads the actual stable PostgreSQL passage ID through both facades", async () => {
    const { modern, legacy, modernCalls, legacyCalls } = clients();
    const hits = await live.client.ragSearch("Son Goku", 1, { sourceId: "db_characters" });
    const sourceId = hits[0]?.sourceId;
    expect(sourceId).toMatch(/^shenron:pg:db_characters:[0-9a-f]{24}:\d+$/);
    if (!sourceId) throw new Error("Real Shenron passage ID is missing");
    const current = await modern.ragDocument(sourceId);
    const previous = await legacy.ragDocument(sourceId);
    expect(current.ok).toBe(true);
    if (!current.ok) throw new Error("Real Shenron document lookup failed");
    expect(current.value).toEqual(previous);
    expect(previous?.sourceId).toBe(sourceId);
    expect(previous?.title.length).toBeGreaterThan(0);
    expect(modernCalls).toEqual(legacyCalls);
    expect(modernCalls[0]?.query).toEqual({ sourceId });
    const absent = "shenron:pg:db_characters:ffffffffffffffffffffffff:0";
    expect(await modern.ragDocument(absent)).toEqual({ ok: true, value: null });
    expect(await legacy.ragDocument(absent)).toBeNull();
    const before = modernCalls.length;
    expect(await modern.ragDocument("shenron:pg:../invalid")).toMatchObject({
      ok: false,
      kind: "invalid_request",
    });
    expect(modernCalls).toHaveLength(before);
  });

  test("validates real wire hits and rejects a malformed copy of an actual passage", async () => {
    const response = await live.client.ragSearchWithMode("Kamehameha", 2, {
      sourceId: "db_techniques",
    });
    expect(RagSearchResponse.safeParse(response).success).toBe(true);
    expect(response.results.length).toBeGreaterThan(0);
    expect(
      RagSearchResponse.safeParse({
        ...response,
        results: [{ ...response.results[0], title: null }],
      }).success,
    ).toBe(false);
  });

  test("the native facade honors the selected real PostgreSQL index without an empty-success fallback", async () => {
    const expected = await live.client.ragSearch("Kamehameha", 2, { kind: "technique" });
    const actual = await aphrodyNative.ragSearch("Kamehameha", { limit: 2, kind: "technique" });
    expect(actual.length).toBeGreaterThan(0);
    expect(actual).toEqual(expected);
    expect((await aphrodyNative.ragStats())?.vectors).toBeGreaterThan(0);
  });

  test("batches real editorial text into finite E5 vectors through the authenticated boundary", async () => {
    const observed = recordLiveRagRequests();
    const client = new AphrodyComputeClient({ fetcher: observed.fetcher });
    const passages = await live.client.ragSearch("Son Goku", 18, { sourceId: "db_characters" });
    expect(passages).toHaveLength(18);
    const vectors = await client.embed(
      passages.map((hit) => hit.content!),
      "passage",
    );
    expect(vectors).toHaveLength(18);
    expect(vectors.every((vector) => vector.length === 384 && vector.every(Number.isFinite))).toBe(
      true,
    );
    expect(observed.calls.map((call) => (call.body as { texts: string[] }).texts.length)).toEqual([
      16, 2,
    ]);
    expect(
      observed.calls.every((call) => call.authenticated && call.path === "/api/v1/shenron/embed"),
    ).toBe(true);
  }, 120_000);

  test("reports the complete current index and refuses an unfinished real generation", async () => {
    const { modern, legacy } = clients();
    const stats = await modern.ragStats();
    expect(stats.ok).toBe(true);
    if (!stats.ok) throw new Error("Real Shenron statistics failed");
    expect(stats.value.chunks).toBeGreaterThan(0);
    expect(stats.value.vectors).toBe(stats.value.chunks);
    expect(stats.value).toEqual(await legacy.ragStats());
    const incomplete = {
      originSourceId: "db_battles",
      syncGeneration: crypto.randomUUID(),
      expectedCount: 2,
    };
    expect(await modern.ragSyncFinish(incomplete)).toMatchObject({
      ok: false,
      kind: "http",
      status: 409,
    });
    await expect(
      legacy.ragSyncFinish(
        incomplete.originSourceId,
        incomplete.syncGeneration,
        incomplete.expectedCount,
      ),
    ).rejects.toThrow("409");
    const after = await legacy.ragStats();
    expect(after.chunks).toBe(stats.value.chunks);
  });

  test("uses genuine HTTP authentication failure without exposing the private token", async () => {
    const denied = createAphrodyCompute({
      baseUrl: requireAiHttpUrl(process.env),
      token: "invalid-qualification-credential",
    });
    const result = await denied.ragStats();
    expect(result).toMatchObject({ ok: false, kind: "http", status: 401 });
    expect(JSON.stringify(result).includes(requireAiHttpToken(process.env))).toBe(false);
  });
});
