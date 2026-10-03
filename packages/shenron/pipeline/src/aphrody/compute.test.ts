// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { AphrodyComputeClient } from "./compute";
import { AphrodyWebClient } from "./web";

// B18 (docs/STACK.md §2.2): the embed path now checks 384-dimensional vectors.
const E5_VECTOR = Array.from({ length: 384 }, (_, i) => i / 384);
// No address default any more (the resolver has none): every client gets an explicit loopback base.
const TEST_BASE = "http://127.0.0.1:8789";

describe("AphrodyComputeClient", () => {
  it("rejects an unconfigured or nonloopback compute boundary", () => {
    expect(() => new AphrodyComputeClient({ token: "", baseUrl: "http://127.0.0.1:8789" })).toThrow(
      "token",
    );
    expect(
      () => new AphrodyComputeClient({ token: "fixture", baseUrl: "https://aphrody.com" }),
    ).toThrow("loopback");
  });

  it("sends authenticated chat and validates the answer", async () => {
    let path = "";
    let authorization = "";
    let payload: unknown;
    const client = new AphrodyComputeClient({
      baseUrl: TEST_BASE,
      token: "fixture",
      fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
        path = new URL(String(input)).pathname;
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        payload = JSON.parse(String(init?.body));
        return Response.json({ answer: "réponse sourcée", model: "fixture-model" });
      }) as unknown as typeof fetch,
    });
    expect(await client.chat([{ role: "user", content: "Namek ?" }])).toEqual({
      answer: "réponse sourcée",
      model: "fixture-model",
    });
    expect(path).toBe("/api/v1/shenron/llm/chat");
    expect(authorization).toBe("Bearer fixture");
    expect(payload).toEqual({ messages: [{ role: "user", content: "Namek ?" }] });
  });

  it("selects Gemini Web for text OCR while keeping page geometry explicit", async () => {
    let payload: Record<string, unknown> | undefined;
    const client = new AphrodyComputeClient({
      baseUrl: TEST_BASE,
      token: "fixture",
      fetcher: (async (_input, init) => {
        payload = JSON.parse(String(init?.body));
        return Response.json({
          text: "悟空",
          language: "ja",
          textless: false,
          suspect: false,
          model: "gemini-web/flash",
        });
      }) as typeof fetch,
    });
    expect((await client.ocr("fixture-base64", "ja")).text).toBe("悟空");
    expect(payload).toEqual({
      image_base64: "fixture-base64",
      engine: "gemini-web",
      language: "ja",
    });
  });

  it("rejects invalid embedding dimensions and nonfinite values", async () => {
    const client = new AphrodyComputeClient({
      baseUrl: TEST_BASE,
      token: "fixture",
      fetcher: (async () => Response.json({ vectors: [[1, null]] })) as unknown as typeof fetch,
    });
    await expect(client.embed(["Goku"])).rejects.toThrow("invalid embedding vectors");
  });

  it("uses passage kind for source embeddings", async () => {
    const client = new AphrodyComputeClient({
      baseUrl: TEST_BASE,
      token: "fixture",
      fetcher: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({ texts: ["source"], kind: "passage" });
        return Response.json({ vectors: [E5_VECTOR] });
      }) as unknown as typeof fetch,
    });
    expect(await client.embed(["source"], "passage")).toEqual([E5_VECTOR]);
  });
});

describe("AphrodyWebClient", () => {
  it("uses native BXC paths on the private VPS listener", async () => {
    const paths: string[] = [];
    const client = new AphrodyWebClient({
      token: "fixture",
      baseUrl: "http://127.0.0.1:3007",
      fetcher: (async (input) => {
        paths.push(new URL(String(input)).pathname);
        return Response.json({
          success: true,
          job: { id: "12345678-1234-1234-1234-123456789abc", status: "completed", stats: {} },
        });
      }) as typeof fetch,
    });
    const job = await client.crawl({ urls: ["https://example.org/news"], maxRequests: 1 });
    await client.status(job.id);
    expect(paths).toEqual(["/api/v1/crawl", "/api/v1/crawl/stats"]);
  });

  it("submits a bounded authenticated crawl and reads its status", async () => {
    const paths: string[] = [];
    const client = new AphrodyWebClient({
      token: "fixture",
      baseUrl: "https://aphrody.com",
      fetcher: (async (input, init) => {
        paths.push(new URL(String(input)).pathname);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture");
        return Response.json({
          success: true,
          job: {
            id: "12345678-1234-1234-1234-123456789abc",
            status: paths.length === 1 ? "running" : "completed",
            stats: {},
          },
        });
      }) as typeof fetch,
    });
    const job = await client.crawl({ urls: ["https://example.org/news"], maxDepth: 1 });
    expect(job.status).toBe("running");
    expect((await client.status(job.id)).status).toBe("completed");
    expect(paths).toEqual(["/api/v1/web/crawl", "/api/v1/web/crawl/stats"]);
  });
});
