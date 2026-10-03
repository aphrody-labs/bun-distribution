// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, test } from "bun:test";
import { createSql } from "@shenron/db/sql";
import { prepareSource } from "../../scripts/_rag-aphrody-sync";
import { PG_SOURCES } from "../../scripts/_rag-sources-pg";
import { requireAiHttpToken, requireAiHttpUrl } from "../../src/ai/config";
import * as wire from "../../src/ai/wire";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "../../src/testing/live-rag";

loadLiveRagEnv();
let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

async function request(
  name: wire.ShenronRouteName,
  query?: Record<string, string>,
  body?: unknown,
) {
  const route = wire.SHENRON_ROUTES[name];
  const url = new URL(route.path, requireAiHttpUrl(process.env));
  if (query) url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    method: route.method,
    headers: {
      authorization: `Bearer ${requireAiHttpToken(process.env)}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Real Shenron wire request ${name}: HTTP ${response.status}`);
  return response.json();
}

describe("RAG wire contracts measured against preloaded Shenron services", () => {
  test("search, document and statistics parse the real Rust responses", async () => {
    const query = { q: "Son Goku", limit: "3", sourceId: "db_characters", lang: "fr" };
    const response = await request("ragSearch", query);
    expect(wire.RagSearchResponse.safeParse(response).success).toBe(true);
    const parsed = wire.RagSearchResponse.parse(response);
    expect(parsed.mode).toBe("hybrid");
    expect(parsed.results.length).toBeGreaterThan(0);
    const sourceId = parsed.results[0]!.sourceId!;
    expect(
      wire.RagDocumentResponse.safeParse(await request("ragDocument", { sourceId })).success,
    ).toBe(true);
    const stats = await request("ragStats");
    expect(wire.RagStatsResponse.safeParse(stats).success).toBe(true);
    expect(wire.RagStatsResponse.safeParse({ ...stats, chunks: -1 }).success).toBe(false);
  });

  test("ingests an unchanged actual editorial passage and confirms its current complete generation", async () => {
    const editorial = createSql({ applicationName: "shenron-wire-live-editorial", max: 1 });
    const index = createSql({
      url: process.env.APHRODY_MCP_DATABASE_URL,
      applicationName: "shenron-wire-live-index",
      max: 1,
    });
    try {
      const chunks = await PG_SOURCES.db_battles!(editorial);
      const doc = prepareSource("db_battles", chunks).documents[0]!;
      expect(wire.IngestRequest.safeParse(doc).success).toBe(true);
      const ingested = await request("ragIngest", undefined, doc);
      expect(wire.IngestResponse.safeParse(ingested).success).toBe(true);
      expect(ingested.vectorIndexed).toBe(true);
      const rows = await index<{ generation: string; count: string }[]>`
        SELECT metadata->>'syncGeneration' AS generation, count(*) AS count
        FROM aphrody_rag_documents WHERE corpus='shenron'
          AND metadata->>'originSourceId'='db_battles'
          AND coalesce(metadata->>'visible','true') <> 'false' GROUP BY 1`;
      expect(rows).toHaveLength(1);
      const sync = {
        originSourceId: "db_battles",
        syncGeneration: rows[0]!.generation,
        expectedCount: Number(rows[0]!.count),
      };
      expect(wire.SyncFinishRequest.safeParse(sync).success).toBe(true);
      const finished = await request("ragSyncFinish", undefined, sync);
      expect(wire.SyncFinishResponse.safeParse(finished).success).toBe(true);
      expect(finished.active).toBe(chunks.length);
      expect((await live.client.ragStats()).vectors).toBeGreaterThan(0);
    } finally {
      await Promise.all([editorial.end(), index.end()]);
    }
  }, 120_000);
});
