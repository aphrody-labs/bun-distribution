// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { defineM3Api, normalizeApi, routesToFetch } from "../src/api.ts";

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
