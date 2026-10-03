// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from "bun:test";
import { createSql } from "@shenron/db/sql";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "../src/testing/live-rag";
import { prepareSource, syncSource } from "./_rag-aphrody-sync";
import { requireAiHttpUrl } from "@shenron/pipeline/ai/config";
import { AphrodyComputeClient } from "../src/aphrody/compute";
import { PG_SOURCES, type SourceChunk } from "./_rag-sources-pg";

loadLiveRagEnv();
let live: LiveRag;
let chunks: SourceChunk[];
let techniques: SourceChunk[];
beforeAll(async () => {
  live = await requireLiveRag();
  const sql = createSql({ applicationName: "shenron-rag-sync-live", max: 1 });
  try {
    chunks = await PG_SOURCES.db_battles!(sql);
    techniques = await PG_SOURCES.db_techniques!(sql);
  } finally {
    await sql.end();
  }
  expect(chunks.length).toBeGreaterThan(0);
}, 120_000);

describe("editorial RAG sync using real Shenron passages", () => {
  it("keeps real passage IDs stable across an editorial revision", () => {
    const before = prepareSource("db_battles", chunks);
    const revised = chunks.map((chunk, index) =>
      index === 0 ? { ...chunk, content: `${chunk.content}\n` } : chunk,
    );
    const after = prepareSource("db_battles", revised);
    expect(after.documents.map((document) => document.sourceId)).toEqual(
      before.documents.map((document) => document.sourceId),
    );
    expect(after.digest).not.toBe(before.digest);
  });

  it("confirms a full real generation and then verifies the unchanged remote source", async () => {
    const first = await syncSource(live.client, "db_battles", chunks, undefined, {
      apply: true,
      requireVectors: true,
      concurrency: 1,
    });
    expect(first.result.indexed).toBe(chunks.length);
    expect(first.state?.count).toBe(chunks.length);
    const next = await syncSource(live.client, "db_battles", chunks, first.state, {
      apply: true,
      requireVectors: true,
    });
    expect(next.result.unchanged).toBe(true);
    expect(next.result.indexed).toBe(0);
  }, 120_000);

  it("refuses to retire the real source with an incomplete generation", async () => {
    const before = await live.client.ragStats();
    await expect(
      live.client.ragSyncFinish("db_battles", crypto.randomUUID(), chunks.length),
    ).rejects.toThrow("409");
    const after = await live.client.ragStats();
    const count = (stats: typeof before) =>
      stats.sources
        .filter((item) => item.sourceId === "db_battles")
        .reduce((sum, item) => sum + item.count, 0);
    expect(count(after)).toBe(count(before));
  });

  it("refuses an empty source before touching the real index", async () => {
    await expect(
      syncSource(live.client, "db_battles", [], undefined, { apply: true }),
    ).rejects.toThrow("empty source");
  });

  it("stops scheduling new real documents after the first fatal unauthorized failure", async () => {
    const concurrency = 4;
    expect(techniques.length).toBeGreaterThan(concurrency);
    const baseUrl = requireAiHttpUrl(process.env);
    const calls: string[] = [];
    // Transparent forwarding spy: every request still reaches the real service.
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return fetch(input, init);
    }) as typeof fetch;
    const unauthorized = new AphrodyComputeClient({
      baseUrl: baseUrl.href,
      token: "invalid-dummy-token",
      fetcher: spy,
    });
    const before = await live.client.ragStats();
    const finish = unauthorized.ragSyncFinish.bind(unauthorized);
    let finished = 0;
    unauthorized.ragSyncFinish = async (...args) => {
      finished++;
      return finish(...args);
    };
    await expect(
      syncSource(unauthorized, "db_techniques", techniques, undefined, {
        apply: true,
        requireVectors: true,
        concurrency,
      }),
    ).rejects.toThrow(/HTTP 40[13]/);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(concurrency);
    expect(calls.length).toBeLessThan(techniques.length);
    expect(finished).toBe(0);
    const after = await live.client.ragStats();
    expect(after.chunks).toBe(before.chunks);
    expect(after.vectors).toBe(before.vectors);
  }, 120_000);
});
