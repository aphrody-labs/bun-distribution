// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createRecordingFetch, type RecordedCall } from "@shenron/config/testing";
import { type AphrodyCompute, createAphrodyCompute, parseRetryAfter } from "../../src/ai/aphrody";
import { fixture, json, loopbackBase, TOKEN, vector } from "./helpers";

type LegacyMethod = (...args: never[]) => Promise<unknown>;
type LegacyInstance = Record<string, LegacyMethod>;
type LegacyClient = new (o: {
  baseUrl: string;
  token: string;
  fetcher: typeof fetch;
}) => LegacyInstance;
// Dynamic path import: the legacy client lives in @shenron/pipeline/aphrody (parity reference only).
const legacyPath = join(import.meta.dir, "..", "..", "src", "aphrody", "compute.ts");
const { AphrodyComputeClient } = (await import(legacyPath)) as {
  AphrodyComputeClient: LegacyClient;
};

const BASE = loopbackBase();

const ROUTES = {
  "GET /api/v1/shenron/health": () => json(fixture("health").response),
  "POST /api/v1/shenron/llm/chat": () => json(fixture("chat").response),
  "POST /api/v1/shenron/embed": async (req: Request) => {
    const body = (await req.json()) as { texts: string[] };
    return json({
      vectors: body.texts.map((_, i) => vector(i)),
      model: "Xenova/multilingual-e5-small",
    });
  },
  "POST /api/v1/shenron/ocr": () => json(fixture("ocr").response),
  "POST /api/v1/shenron/vision/structured": () => json(fixture("vision-structured").response),
};

function shape(call: RecordedCall) {
  const headers: Record<string, string> = {};
  call.headers.forEach((value, key) => {
    if (key !== "authorization") headers[key] = value;
  });
  return {
    method: call.method,
    url: call.url,
    headers,
    auth: call.headers.get("authorization") === `Bearer ${TOKEN}`,
    body: call.body === null ? null : JSON.parse(call.body),
  };
}

function call(c: LegacyInstance, name: string, ...args: unknown[]): Promise<unknown> {
  const method = c[name] as unknown as (...a: unknown[]) => Promise<unknown>;
  return method.apply(c, args);
}

async function both(
  runNew: (c: AphrodyCompute) => Promise<unknown>,
  runOld: (c: LegacyInstance) => Promise<unknown>,
) {
  const a = createRecordingFetch(ROUTES);
  const b = createRecordingFetch(ROUTES);
  const fresh = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: a.fetch });
  const legacy = new AphrodyComputeClient({ baseUrl: BASE.href, token: TOKEN, fetcher: b.fetch });
  const nv = await runNew(fresh);
  const ov = await runOld(legacy);
  return { newCalls: a.calls.map(shape), oldCalls: b.calls.map(shape), nv, ov };
}

describe("createAphrodyCompute: request parity with AphrodyComputeClient", () => {
  const chatReq = fixture("chat").request as {
    messages: { role: "system" | "user"; content: string }[];
    model: string;
  };
  const cases: [
    string,
    (c: AphrodyCompute) => Promise<unknown>,
    (c: LegacyInstance) => Promise<unknown>,
  ][] = [
    ["health", (c) => c.health(), (c) => call(c, "health")],
    [
      "chat",
      (c) => c.chat({ messages: chatReq.messages, model: chatReq.model }),
      (c) => call(c, "chat", chatReq.messages, chatReq.model),
    ],
    [
      "embed",
      (c) => c.embed({ texts: ["Qui est Goku ?", "Kamehameha"], kind: "passage" }),
      (c) => call(c, "embed", ["Qui est Goku ?", "Kamehameha"], "passage"),
    ],
    [
      "ocr (explicit gemini-web engine)",
      (c) => c.ocr({ imageBase64: "iVBORw0KGgo=", engine: "gemini-web", language: "ja" }),
      (c) => call(c, "ocr", "iVBORw0KGgo=", "ja"),
    ],
  ];
  for (const [name, runNew, runOld] of cases) {
    test(name, async () => {
      const { newCalls, oldCalls, nv } = await both(runNew, runOld);
      expect(newCalls).toEqual(oldCalls);
      expect(newCalls.length).toBeGreaterThan(0);
      expect(newCalls.every((c) => c.auth)).toBe(true);
      expect((nv as { ok: boolean }).ok).toBe(true);
    });
  }

  test("health values match the legacy client on the same fixtures", async () => {
    const h = await both(
      (c) => c.health(),
      (c) => call(c, "health"),
    );
    expect((h.nv as { value: unknown }).value).toEqual(h.ov);
  });
});

describe("createAphrodyCompute: documented differences", () => {
  test("ocr defaults to the ppocr engine", async () => {
    const rec = createRecordingFetch(ROUTES);
    const c = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
    const r = await c.ocr({ imageBase64: "iVBORw0KGgo=" });
    expect(r.ok).toBe(true);
    expect(JSON.parse(rec.calls[0]?.body ?? "null")).toEqual({
      image_base64: "iVBORw0KGgo=",
      engine: "ppocr",
    });
  });

  test("embed: no client prefix, whitespace collapsed, batches of 16", async () => {
    const rec = createRecordingFetch(ROUTES);
    const c = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
    const texts = Array.from({ length: 40 }, (_, i) => `  texte\n\t${i}  `);
    const r = await c.embed({ texts, kind: "query" });
    expect(r.ok && r.value.vectors.length).toBe(40);
    const bodies = rec.calls.map(
      (c2) => JSON.parse(c2.body ?? "null") as { texts: string[]; kind: string },
    );
    expect(bodies.map((b) => b.texts.length)).toEqual([16, 16, 8]);
    expect(bodies[0]?.texts[0]).toBe("texte 0");
    expect(bodies.flatMap((b) => b.texts).some((t) => t.startsWith("query: "))).toBe(false);
  });

  test("embed: 383 dimensions or a missing vector is invalid", async () => {
    for (const vectors of [[vector(1, 383)], []]) {
      const rec = createRecordingFetch({ "POST /api/v1/shenron/embed": () => json({ vectors }) });
      const c = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
      const r = await c.embed({ texts: ["x"], kind: "query" });
      expect(r).toMatchObject({ ok: false, kind: "invalid_response" });
    }
  });

  test("chat limits: 33 messages rejected before any call", async () => {
    const rec = createRecordingFetch(ROUTES);
    const c = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
    const messages = Array.from({ length: 33 }, () => ({ role: "user" as const, content: "x" }));
    expect(await c.chat({ messages })).toMatchObject({ ok: false, kind: "invalid_request" });
    expect(rec.calls.length).toBe(0);
  });
});

describe("createAphrodyCompute: failures", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("the token never appears in any failure", async () => {
    const failures: unknown[] = [];
    const scenarios: ((req: Request) => Response | Promise<Response>)[] = [
      () => json({ error: `boom ${TOKEN}` }, { status: 503, headers: { "retry-after": "7" } }),
      () => new Response(`not json ${TOKEN}`, { status: 200 }),
      () => json({ status: "ok", capabilities: TOKEN }),
    ];
    for (const handler of scenarios) {
      const rec = createRecordingFetch({ "*": handler });
      const c = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
      failures.push(await c.health(), await c.chat({ messages: [{ role: "user", content: "x" }] }));
    }
    const unreachable = createAphrodyCompute(
      { baseUrl: BASE, token: TOKEN },
      { fetch: createRecordingFetch({}).fetch },
    );
    failures.push(await unreachable.health());
    const slow = createRecordingFetch({ "*": () => new Promise<Response>(() => undefined) });
    const timed = createAphrodyCompute(
      { baseUrl: BASE, token: TOKEN },
      { fetch: slow.fetch, timeouts: { health: 20 } },
    );
    failures.push(await timed.health());

    expect(failures.every((f) => (f as { ok: boolean }).ok === false)).toBe(true);
    const text = JSON.stringify(failures);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("boom");
    expect(failures[0]).toMatchObject({
      kind: "http",
      status: 503,
      retryAfterSeconds: 7,
      detail: "HTTP 503 /api/v1/shenron/health",
    });
    expect(failures[2]).toMatchObject({ kind: "invalid_json" });
    expect(failures[4]).toMatchObject({ kind: "invalid_response" });
    expect(failures[6]).toMatchObject({ kind: "unreachable", path: "/api/v1/shenron/health" });
    expect(failures[7]).toMatchObject({ kind: "timeout", path: "/api/v1/shenron/health" });
  });

  test("replacing globalThis.fetch after client creation is honoured", async () => {
    const c = createAphrodyCompute({ baseUrl: BASE, token: TOKEN });
    const rec = createRecordingFetch(ROUTES);
    globalThis.fetch = rec.fetch;
    expect(await c.health()).toEqual({ ok: true, value: { rag: true, llm: true, ocr: false } });
    expect(rec.calls.length).toBe(1);
  });

  test("redirects are refused and every call carries a signal", async () => {
    let seen: RequestInit | undefined;
    const f = (async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return json(fixture("health").response);
    }) as unknown as typeof fetch;
    await createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: f }).health();
    expect(seen?.redirect).toBe("error");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  test("never gates ocr on health().ocr", async () => {
    const rec = createRecordingFetch(ROUTES);
    const c = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
    await c.ocr({ imageBase64: "iVBORw0KGgo=" });
    expect(rec.calls.map((c2) => new URL(c2.url).pathname)).toEqual(["/api/v1/shenron/ocr"]);
  });

  test("visionStructured posts the wire field names", async () => {
    const rec = createRecordingFetch(ROUTES);
    const c = createAphrodyCompute({ baseUrl: BASE, token: TOKEN }, { fetch: rec.fetch });
    const r = await c.visionStructured({
      imageBase64: "iVBORw0KGgo=",
      mime: "image/png",
      prompt: "Décris la carte.",
    });
    expect(r).toEqual({
      ok: true,
      value: { result: { name: "Goku", power: 9001 }, model: "gemini-web/flash" },
    });
    expect(JSON.parse(rec.calls[0]?.body ?? "null")).toEqual(fixture("vision-structured").request);
  });
});

describe("parseRetryAfter", () => {
  test("seconds and HTTP dates", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("12")).toBe(12);
    const now = Date.parse("2026-09-24T10:00:00Z");
    expect(parseRetryAfter("Thu, 24 Sep 2026 10:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Thu, 24 Sep 2026 09:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});
