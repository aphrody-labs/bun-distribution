// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { contextPublicRag, searchPublicRag } from "../../../../apps/shenron/bot/src/api/public-rag";
import { loadLiveRagEnv, requireLiveRag } from "../../pipeline/src/testing/live-rag";
import { createShenronApiClient } from "../src/client";
import { RagContextResponse, RagSearchResponse } from "../src/contract";

loadLiveRagEnv();
let server: ReturnType<typeof Bun.serve> | undefined;
beforeAll(async () => {
  await requireLiveRag();
  // These are the bot's actual route bodies; SQL, vectors, Redis and fetch stay real.
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname.replace(/^\/bot\//, "/");
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

describe("public API client and schemas against the preloaded Shenron RAG", () => {
  test("reads genuine filtered hybrid hits through the normal path and base prefix", async () => {
    const query = {
      q: "Son Goku",
      limit: 5,
      lang: "fr",
      sourceId: "db_characters",
      kind: "character",
    };
    const plain = createShenronApiClient({ baseUrl: server!.url.href });
    const prefixed = createShenronApiClient({ baseUrl: new URL("bot/", server!.url).href });
    const a = await plain.rag.search(query);
    const b = await prefixed.rag.search(query);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("Real public Shenron RAG request failed");
    expect(a.value).toEqual(b.value);
    expect(RagSearchResponse.safeParse(a.value).success).toBe(true);
    expect(a.value.mode).toBe("hybrid");
    expect(a.value.error).toBeUndefined();
    expect(a.value.results.length).toBeGreaterThan(0);
    expect(
      a.value.results.every(
        (hit) => hit.sourceId === "db_characters" && hit.lang === "fr" && hit.content?.trim(),
      ),
    ).toBe(true);
    expect(
      RagSearchResponse.safeParse({
        ...a.value,
        results: [{ ...a.value.results[0], score: "invalid" }],
      }).success,
    ).toBe(false);
  });

  test("returns real source citations within the requested context budget", async () => {
    const result = await createShenronApiClient({ baseUrl: server!.url.href }).rag.context({
      q: "Vegeta",
      limit: 3,
      maxChars: 900,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Real public Shenron context request failed");
    expect(RagContextResponse.safeParse(result.value).success).toBe(true);
    expect(result.value.mode).toBe("hybrid");
    expect(result.value.error).toBeUndefined();
    expect(result.value.sources.length).toBeGreaterThan(0);
    expect(result.value.context).toContain(result.value.sources[0]!.title);
    expect(result.value.context.length).toBeLessThanOrEqual(940);
  });

  test("does not invent a passage for a missing source or a short query", async () => {
    const client = createShenronApiClient({ baseUrl: server!.url.href });
    const filtered = await client.rag.search({
      q: "Son Goku",
      sourceId: "source_absente_qualification",
    });
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) throw new Error("Real filtered Shenron request failed");
    expect(filtered.value.results).toHaveLength(0);
    const short = await client.rag.search({ q: "x" });
    expect(short.ok && short.value.results.length).toBe(0);
  });

  test("projects an actual backend authentication failure as index_unavailable", async () => {
    const token = process.env.APHRODY_AI_HTTP_TOKEN;
    try {
      process.env.APHRODY_AI_HTTP_TOKEN = "invalid-qualification-credential";
      const client = createShenronApiClient({ baseUrl: server!.url.href });
      const search = await client.rag.search({ q: "Son Goku" });
      const context = await client.rag.context({ q: "Son Goku" });
      expect(search.ok && search.value.error).toBe("index_unavailable");
      expect(context.ok && context.value.error).toBe("index_unavailable");
      expect(JSON.stringify([search, context]).includes(token!)).toBe(false);
    } finally {
      process.env.APHRODY_AI_HTTP_TOKEN = token;
    }
  });
});
