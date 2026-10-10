// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { ragPayload, searchLocalRag } from "./local-rag.ts";

const selection = { config: "/protected/mcp.toml", server: "shenron-rag" };
test("native RAG preserves six source identities and fixed domain/tool selection", async () => {
  const results = Array.from({ length: 7 }, (_, index) => ({ sourceId: `source-${index}` }));
  const payload = await searchLocalRag(selection, "Son Goku", 6, async (request, options) => {
    expect(request).toEqual({
      config: selection.config,
      server: "shenron-rag",
      tool: "aphrody_shenron_rag_search",
      arguments: { q: "Son Goku", limit: 6 },
    });
    expect(options.timeoutMs).toBe(30_000);
    return { result: { structuredContent: { results } } };
  });
  expect(payload.results.map((item) => item.sourceId)).toEqual(
    results.slice(0, 6).map((item) => item.sourceId),
  );
});
test("native RAG supports standard text JSON but refuses tool errors and malformed records", () => {
  expect(
    ragPayload({ content: [{ type: "text", text: '{"results":[{"sourceId":"s"}]}' }] }).results,
  ).toEqual([{ sourceId: "s" }]);
  for (const result of [
    null,
    { isError: true, structuredContent: { results: [] } },
    { structuredContent: { error: "private", results: [] } },
    { structuredContent: { results: [null] } },
    { content: [{ type: "text", text: "private-token-must-never-appear" }] },
  ]) {
    try {
      ragPayload(result);
      throw new Error("Unexpected success");
    } catch (error) {
      expect(String(error)).not.toContain("private-token");
      expect(String(error)).not.toContain("Unexpected success");
    }
  }
});
test("native RAG refuses cross-domain configuration and unbounded requests before transport", async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return { result: { structuredContent: { results: [] } } };
  };
  const requests = [
    { config: "relative", server: "shenron-rag", query: "Goku", limit: 6 },
    { config: selection.config, server: "aphrody", query: "Goku", limit: 6 },
    { ...selection, query: "", limit: 6 },
    { ...selection, query: "龍".repeat(180), limit: 6 },
    { ...selection, query: "Goku", limit: 9 },
  ];
  await Promise.all(
    requests.map((request) =>
      expect(searchLocalRag(request, request.query, request.limit, transport)).rejects.toThrow(),
    ),
  );
  expect(calls).toBe(0);
});
