// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { JsonTransportError, parseRetryAfter, requestJson } from "../src/http.ts";
const servers: ReturnType<typeof Bun.serve>[] = [];
function serve(fetch: (request: Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
describe("shared service JSON transport", () => {
  test("real HTTP preserves URL, headers, method, body, status and ETag", async () => {
    const origin = serve(async request => {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).searchParams.get("q")).toBe("悟空");
      expect(request.headers.get("authorization")).toBe("Bearer isolated-test");
      return Response.json(await request.json(), {
        status: 201,
        headers: { ETag: '"one"' },
      });
    });
    const result = await requestJson(
      origin + "/compute?q=悟空",
      {
        method: "POST",
        headers: {
          authorization: "Bearer isolated-test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ persona: "assistant", message: "bonjour" }),
      },
      { timeoutMs: 1000 },
    );
    expect(result.value).toEqual({ persona: "assistant", message: "bonjour" });
    expect(result.response.status).toBe(201);
    expect(result.response.headers.get("etag")).toBe('"one"');
  });
  test("redirect is refused before another endpoint can receive credentials", async () => {
    let forwarded = 0;
    const destination = serve(() => {
      forwarded++;
      return Response.json({ ok: true });
    });
    const origin = serve(() => Response.redirect(destination + "/private"));
    await expect(
      requestJson(origin, { headers: { authorization: "Bearer isolated-test" } }, { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ name: "JsonTransportError", stage: "request" });
    expect(forwarded).toBe(0);
  });
  test("deadline includes the response body, and there is no retry", async () => {
    let calls = 0;
    const origin = serve(() => {
      calls++;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("{"));
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    await expect(requestJson(origin, {}, { timeoutMs: 35 })).rejects.toMatchObject({
      stage: "body",
      timedOut: true,
    });
    expect(calls).toBe(1);
  });
  test("caller cancellation is propagated without being classified as a deadline", async () => {
    const controller = new AbortController();
    controller.abort();
    const origin = serve(() => Response.json({ ok: true }));
    await expect(requestJson(origin, { signal: controller.signal }, { timeoutMs: 1000 })).rejects.toMatchObject({
      stage: "request",
      timedOut: false,
    });
  });
  test("discarded errors and absent documents cancel their bodies", async () => {
    await Promise.all(
      [404, 503].map(async status => {
        let cancelled = false;
        const fetcher = (async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { status },
          )) as unknown as typeof fetch;
        const result = await requestJson(
          "http://127.0.0.1/",
          {},
          {
            timeoutMs: 1000,
            fetch: fetcher,
            ...(status === 404 ? { emptyStatus: 404 } : {}),
          },
        );
        expect(cancelled).toBe(true);
        expect(result.value).toBeUndefined();
        expect(result.response.status).toBe(status);
      }),
    );
  });
  test("optional domain error envelope is read; invalid error JSON retains its HTTP status", async () => {
    const origin = serve(request =>
      new URL(request.url).pathname === "/json"
        ? Response.json({ error: "denied" }, { status: 403 })
        : new Response("not JSON", { status: 503 }),
    );
    const json = await requestJson(origin + "/json", {}, { timeoutMs: 1000, readErrorBody: true });
    expect(json.value).toEqual({ error: "denied" });
    const text = await requestJson(origin, {}, { timeoutMs: 1000, readErrorBody: true });
    expect(text.response.status).toBe(503);
    expect(text.value).toBeUndefined();
  });
  test("bad success JSON is a distinct parse error", async () => {
    const origin = serve(() => new Response("not JSON"));
    try {
      await requestJson(origin, {}, { timeoutMs: 1000 });
      throw new Error("expected a parse error");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonTransportError);
      expect(error).toMatchObject({ stage: "json", timedOut: false });
      expect((error as JsonTransportError).message).not.toContain(origin);
    }
  });
  test("global fetch is resolved per request", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => Response.json({ generation: 1 })) as unknown as typeof fetch;
      expect((await requestJson("http://127.0.0.1/", {}, { timeoutMs: 1000 })).value).toEqual({
        generation: 1,
      });
      globalThis.fetch = (async () => Response.json({ generation: 2 })) as unknown as typeof fetch;
      expect((await requestJson("http://127.0.0.1/", {}, { timeoutMs: 1000 })).value).toEqual({
        generation: 2,
      });
    } finally {
      globalThis.fetch = original;
    }
  });
  test("Retry-After retains delta and date semantics", () => {
    expect(parseRetryAfter("5")).toBe(5);
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:05 GMT", 1000)).toBe(4);
    expect(parseRetryAfter("invalid")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
