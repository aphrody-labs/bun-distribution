// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, test } from "bun:test";
import { createSql } from "@shenron/db/sql";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "@shenron/pipeline/testing/live-rag";
import { prepareSource } from "../../../../packages/shenron/pipeline/scripts/_rag-aphrody-sync";
import { PG_SOURCES } from "../../../../packages/shenron/pipeline/scripts/_rag-sources-pg";

loadLiveRagEnv();
let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

describe("refonte sources rendered from real Shenron PostgreSQL and preloaded in RAG", () => {
  for (const [source, kind] of [
    ["contributors", "contributor"],
    ["media_works", "media_work"],
    ["narrative_timelines", "narrative_timeline"],
    ["narrative_events", "narrative_event"],
  ] as const) {
    test(`${source}: actual rendered passages have current searchable E5 vectors`, async () => {
      const sql = createSql({ applicationName: "shenron-refonte-live-rag", max: 1 });
      try {
        const chunks = await PG_SOURCES[source]!(sql);
        expect(chunks.length).toBeGreaterThan(0);
        expect(
          chunks.every(
            (chunk) => chunk.kind === kind && chunk.title.trim() && chunk.content.trim(),
          ),
        ).toBe(true);
        const { documents } = prepareSource(source, chunks);
        const document = documents[0]!;
        const stored = await live.client.ragDocument(document.sourceId);
        expect(stored?.title).toBe(document.title);
        expect(stored?.url).toBe(document.url);
        expect(stored?.originSourceId).toBe(source);
        const stats = await live.client.ragStats();
        const indexed = stats.sources.filter((item) => item.sourceId === source);
        expect(indexed.reduce((count, item) => count + item.count, 0)).toBe(chunks.length);
        expect(indexed.reduce((count, item) => count + (item.vectors ?? 0), 0)).toBe(chunks.length);
        const retrieval = await live.client.ragSearchWithMode(document.title, 3, {
          sourceId: source,
          kind,
        });
        expect(retrieval.mode).toBe("hybrid");
        expect(retrieval.results.length).toBeGreaterThan(0);
        expect(
          retrieval.results.every(
            (hit) => hit.originSourceId === source && hit.kind === kind && hit.content?.trim(),
          ),
        ).toBe(true);
      } finally {
        await sql.end();
      }
    });
  }
});
