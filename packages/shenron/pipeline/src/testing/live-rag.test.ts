// SPDX-License-Identifier: Apache-2.0
import { beforeAll, expect, test } from "bun:test";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "./live-rag";

loadLiveRagEnv();
let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

async function search(source = "db_characters") {
  const url = new URL("/api/v1/shenron/rag/search", process.env.APHRODY_AI_HTTP_URL);
  url.searchParams.set("q", "Son Goku");
  url.searchParams.set("sourceId", source);
  url.searchParams.set("lang", "fr");
  url.searchParams.set("limit", "5");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.APHRODY_AI_HTTP_TOKEN}` },
  });
  expect(response.status).toBe(200);
  return { cache: response.headers.get("x-shenron-rag-cache"), body: await response.json() };
}

test("serves real preloaded retrieval from Redis without mixing filters", async () => {
  const first = await search();
  const cached = await search();
  expect(cached.cache).toBe("hit");
  expect(cached.body).toEqual(first.body);
  expect(cached.body.results.length).toBeGreaterThan(0);
  const missing = await search("source_absente_qualification");
  expect(missing.body.results).toHaveLength(0);
});

test("invalidates the real Redis result when an existing editorial passage is reindexed", async () => {
  const { results } = await live.client.ragSearchWithMode("Son Goku", 5, {
    sourceId: "db_characters",
    lang: "fr",
  });
  const hit = results[0]!;
  expect(hit.sourceId).toBeDefined();
  expect(hit.content?.length).toBeGreaterThan(0);
  await search();
  const result = await live.client.ragIngest({
    sourceId: hit.sourceId!,
    title: hit.title,
    url: hit.url,
    content: hit.content!,
    kind: hit.kind,
    lang: hit.lang,
    originSourceId: hit.originSourceId,
    entity: hit.entity,
  });
  expect(result.vectorIndexed).toBe(true);
  const refreshed = await search();
  expect(refreshed.cache).toBe("miss");
  expect(refreshed.body.mode).toBe("hybrid");
  expect((await search()).cache).toBe("hit");
});
