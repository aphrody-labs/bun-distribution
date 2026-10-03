// SPDX-License-Identifier: Apache-2.0
/** Bridge HTTP fallback against the real public RAG route bodies (native RAG + PG, no stub). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { contextPublicRag, searchPublicRag } from "../../../../apps/shenron/bot/src/api/public-rag";
import { DbuiBridge } from "../src/bridge/ipc";
import { loadLiveRagEnv, requireLiveRag } from "../src/testing/live-rag";

loadLiveRagEnv();
let server: ReturnType<typeof Bun.serve> | undefined;
beforeAll(async () => {
  await requireLiveRag();
  // Same route owner as packages/shenron/api/test/rag-live.test.ts; retrieval stays real.
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body =
        path === "/api/public/rag/search"
          ? await searchPublicRag(req, null)
          : path === "/api/public/rag/context"
            ? await contextPublicRag(req, null)
            : null;
      return body === null
        ? new Response(null, { status: 404 })
        : Response.json(body, { headers: { "cache-control": "no-store" } });
    },
  });
}, 120_000);
afterAll(() => server?.stop(true));

describe("DbuiBridge.searchRag against the real Shenron public route", () => {
  test("returns genuine hybrid hits for a canonical query", async () => {
    const bridge = new DbuiBridge({
      forcedTransport: "http",
      fallbackApiUrl: server!.url.href,
      timeoutMs: 60_000,
    });
    const result = await bridge.searchRag("Son Goku", { limit: 5 });
    expect(result.mode).toBe("hybrid");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.length).toBeLessThanOrEqual(5);
    expect(result.results.every((hit) => hit.content?.trim())).toBe(true);
    expect(result.query).toBe("Son Goku");
    expect(result.totalFound).toBe(result.results.length);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // Canonical ids from the owner survive the adaptation.
    expect(result.results.every((hit) => Number.isInteger(hit.rowid) && hit.sourceId)).toBe(true);
    // rowid may be -1 for several hits: documentId is the stable backend key.
    const ids = result.results.map((hit) => hit.documentId);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  }, 120_000);

  test("lexical-only is rejected explicitly: the shared route always serves hybrid", async () => {
    const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: server!.url.href });
    await expect(bridge.searchRag("Son Goku", { mode: "lexical" })).rejects.toThrow("lexical");
  });

  test("dense-only is rejected explicitly instead of being served as hybrid", async () => {
    const bridge = new DbuiBridge({ forcedTransport: "http", fallbackApiUrl: server!.url.href });
    await expect(bridge.searchRag("Son Goku", { mode: "dense" })).rejects.toThrow("dense");
  });
});
