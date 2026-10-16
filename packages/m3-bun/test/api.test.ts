// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  defineM3Api,
  jsonl,
  m3Csrf,
  normalizeApi,
  readBody,
  readJsonl,
  reply,
  requestCookies,
  routesToFetch,
  withCookies,
  yaml,
} from "../src/api.ts";

const call = (handler: ReturnType<typeof routesToFetch>, path: string, init?: RequestInit) =>
  handler(new Request(`http://m3.test${path}`, init));

describe("routesToFetch", () => {
  const handler = routesToFetch({
    "/api/hello/:name": (request) => Response.json({ hello: request.params.name }),
    "/api/hello/world": () => Response.json({ hello: "static wins" }),
    "/api/items": {
      GET: () => Response.json([1, 2]),
      POST: async (request) => Response.json(await request.json(), { status: 201 }),
    },
    "/api/files/*": (request) => new Response(new URL(request.url).pathname),
    "/api/version": new Response("1.0"),
  });

  test("params are decoded and static segments outrank them", async () => {
    expect(await (await call(handler, "/api/hello/caf%C3%A9"))!.json()).toEqual({ hello: "café" });
    expect(await (await call(handler, "/api/hello/world"))!.json()).toEqual({
      hello: "static wins",
    });
  });

  test("methods dispatch, others answer 405 with Allow", async () => {
    expect(await (await call(handler, "/api/items"))!.json()).toEqual([1, 2]);
    const created = await call(handler, "/api/items", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });
    expect(created!.status).toBe(201);
    const denied = await call(handler, "/api/items", { method: "DELETE" });
    expect(denied!.status).toBe(405);
    expect(denied!.headers.get("allow")).toBe("GET, POST");
  });

  test("a trailing /* matches everything below, a static Response is cloned per request", async () => {
    expect(await (await call(handler, "/api/files/a/b/c.txt"))!.text()).toBe(
      "/api/files/a/b/c.txt",
    );
    expect(await (await call(handler, "/api/version"))!.text()).toBe("1.0");
    expect(await (await call(handler, "/api/version"))!.text()).toBe("1.0");
  });

  test("an unmatched request resolves to undefined so a host can fall through to its assets", async () => {
    expect(await call(handler, "/nothing")).toBeUndefined();
    expect(await call(handler, "/api/hello")).toBeUndefined();
  });
});

const fetchFallback = () => undefined;

describe("normalizeApi", () => {
  test("routes only, routes plus fetch, and nothing", () => {
    const routes = { "/api/a": () => new Response("a") };
    expect(normalizeApi(routes)).toEqual({ routes });
    expect(normalizeApi({ routes, fetch: fetchFallback })).toEqual({
      routes,
      fetch: fetchFallback,
    });
    expect(normalizeApi({ fetch: fetchFallback })).toEqual({ routes: {}, fetch: fetchFallback });
    expect(normalizeApi(undefined)).toEqual({ routes: {} });
  });
  test("defineM3Api is the identity", () => {
    const api = { "/api/x": () => new Response("x") };
    expect(defineM3Api(api)).toBe(api);
  });
});

describe("cookies (Bun.CookieMap)", () => {
  test("routes read request.cookies and their changes become Set-Cookie headers", async () => {
    const handler = routesToFetch({
      "/api/visit": (request) => {
        const visits = Number(request.cookies.get("visits") ?? 0) + 1;
        request.cookies.set("visits", String(visits), { httpOnly: true, path: "/" });
        return Response.json({ visits });
      },
    });
    const res = (await call(handler, "/api/visit", { headers: { cookie: "visits=2; other=x" } }))!;
    expect(await res.json()).toEqual({ visits: 3 });
    expect(res.headers.getSetCookie()).toEqual(["visits=3; Path=/; HttpOnly; SameSite=Lax"]);
  });

  test("requestCookies parses the header; withCookies leaves untouched maps alone", () => {
    const cookies = requestCookies(new Request("http://m3.test/", { headers: { cookie: "a=1; b=two" } }));
    expect(cookies.get("b")).toBe("two");
    const plain = new Response("x");
    expect(withCookies(plain, cookies)).toBe(plain);
  });
});

describe("m3Csrf (Bun.CSRF)", () => {
  const csrf = m3Csrf({ secret: "s3cret", sessionOf: (request) => request.cookies.get("sid") ?? undefined });
  const handler = routesToFetch({
    "/api/notes": csrf.protect({ GET: () => new Response("list"), POST: () => new Response("created", { status: 201 }) }),
  });

  test("safe methods pass, unsafe ones need a token of the same session", async () => {
    expect(await (await call(handler, "/api/notes"))!.text()).toBe("list");
    expect((await call(handler, "/api/notes", { method: "POST" }))!.status).toBe(403);
    const token = csrf.token("session-a");
    const post = (sid: string) =>
      call(handler, "/api/notes", { method: "POST", headers: { cookie: `sid=${sid}`, "x-csrf-token": token } });
    expect((await post("session-a"))!.status).toBe(201);
    expect((await post("session-b"))!.status).toBe(403);
  });
});

const request = (accept: string) => new Request("http://m3.test/", { headers: { accept } });
async function* rows() {
  yield 1;
  yield { two: 2 };
}
const post = (type: string, text: string) =>
  readBody(new Request("http://m3.test/", { method: "POST", headers: { "content-type": type }, body: text }));

describe("content negotiation (Bun.YAML, Bun.JSONL)", () => {
  test("reply answers YAML, JSON Lines for iterables, else JSON, and varies on Accept", async () => {
    const data = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const asYaml = reply(data, request("application/yaml"));
    expect(asYaml.headers.get("content-type")).toStartWith("application/yaml");
    expect(Bun.YAML.parse(await asYaml.text())).toEqual(data);
    const asLines = reply(data, request("application/jsonl"));
    expect(await asLines.text()).toBe('{"id":1,"name":"a"}\n{"id":2,"name":"b"}\n');
    const asJson = reply({ ok: true }, request("application/jsonl"));
    expect(await asJson.json()).toEqual({ ok: true });
    expect(asJson.headers.get("vary")).toBe("Accept");
  });

  test("jsonl streams async iterables; yaml keeps a given content type", async () => {
    expect(await jsonl(rows()).text()).toBe('1\n{"two":2}\n');
    const typed = yaml({ a: 1 }, { headers: { "Content-Type": "text/yaml" } });
    expect(typed.headers.get("content-type")).toBe("text/yaml");
  });

  test("readJsonl reads values across chunk boundaries; readBody follows Content-Type", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of ['{"a":', '1}\n{"b"', ":2}\n3"]) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    });
    const streamed = new Request("http://m3.test/", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(await Array.fromAsync(readJsonl(streamed))).toEqual([{ a: 1 }, { b: 2 }, 3]);
    expect(await post("application/yaml", "a: 1\nb: [x, y]\n")).toEqual({ a: 1, b: ["x", "y"] });
    expect(await post("application/x-ndjson", '{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(await post("application/x-www-form-urlencoded", "a=1&b=2")).toEqual({ a: "1", b: "2" });
    expect(await post("application/json", '{"x":true}')).toEqual({ x: true });
    await expect(post("application/jsonl", '{"a":1}\n{oops}\n')).rejects.toThrow();
  });
});
