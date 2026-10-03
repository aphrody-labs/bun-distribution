// SPDX-License-Identifier: Apache-2.0
import { beforeAll, expect, it } from "bun:test";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "@shenron/pipeline/testing/live-rag";

loadLiveRagEnv();
const { buildRagContext, hybridSearch } = await import("../src/lib/rag");
let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

it("uses the real Aphrody corpus for filtered search and full citations", async () => {
  const filters = { sourceId: "db_characters", lang: "fr" };
  const remote = await live.client.ragSearchWithMode("Son Goku", 5, filters);
  const bot = await hybridSearch(null, "Son Goku", 5, filters);
  expect(bot.mode).toBe("hybrid");
  expect(bot.results.length).toBeGreaterThan(0);
  expect(bot.results.map((hit) => hit.url)).toEqual(remote.results.map((hit) => hit.url));
  expect(bot.results.every((hit) => hit.sourceId === "db_characters" && hit.lang === "fr")).toBe(
    true,
  );
  const context = await buildRagContext(null, "Son Goku", filters);
  expect(context.sources.length).toBeGreaterThan(0);
  expect(context.context).toContain("[1]");
  expect(context.context).toContain(remote.results[0]!.title);
  expect(context.context).toContain("https://dragonballfr.com/");
});

it("uses the same real HTTP retrieval for unfiltered bot queries", async () => {
  const bot = await hybridSearch(null, "Son Goku", 5);
  expect(bot.mode).toBe("hybrid");
  expect(bot.results.length).toBeGreaterThan(0);
  expect(bot.results.every((hit) => hit.content?.trim() && hit.url.startsWith("https://"))).toBe(
    true,
  );
});
