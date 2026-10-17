// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { join } from "node:path";
import { buildRoutes, createProxy, fileRoutes, proxyRoutes, resolvePort, serveM3 } from "../src/server.ts";

const SPA_HTML = join(import.meta.dir, "fixtures/spa/index.html");
const PAGES = join(import.meta.dir, "fixtures/pages");

/** Upstream that echoes what it received. */
let upstream: Server<undefined>;
beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      return Response.json({
        method: req.method,
        path: url.pathname,
        query: url.search,
        body: req.method === "GET" ? null : await req.text(),
        host: req.headers.get("host"),
        custom: req.headers.get("x-custom"),
      });
    },
  });
});
afterAll(() => upstream.stop(true));

describe("serveM3", () => {
  test("serves the SPA entry on every unmatched path, extra routes first", async () => {
    await using server = await serveM3({
      index: SPA_HTML,
      routes: { "/health": new Response("ok") },
      port: 0,
      hmr: false,
    });
    const root = await fetch(new URL("/", server.url));
    expect(root.status).toBe(200);
    const html = await root.text();
    expect(html).toContain('id="spa-root"');
    const deep = await fetch(new URL("/some/client/route", server.url)).then(r => r.text());
    expect(deep).toContain('id="spa-root"');
    expect(await fetch(new URL("/health", server.url)).then(r => r.text())).toBe("ok");
    // The bundled client script referenced by the HTML is served too.
    const script = /src="([^"]+\.js)"/.exec(html)?.[1];
    expect(script).toBeDefined();
    const js = await fetch(new URL(script!, server.url));
    expect(js.status).toBe(200);
    expect(await js.text()).toContain("spa fixture mounted");
  });

  test("streams file-based React pages before the SPA fallback while preserving explicit routes and proxies", async () => {
    await using server = await serveM3({
      index: SPA_HTML,
      pagesDir: PAGES,
      routes: { "/health": new Response("explicit") },
      proxy: { "/rpc": upstream.url.href },
      port: 0,
      hmr: false,
    });
    const home = await fetch(new URL("/", server.url));
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toContain("SSR home");
    expect(await fetch(new URL("/about", server.url)).then(res => res.text())).toContain("SSR about");
    const user = await fetch(new URL("/users/%3Cadmin%3E?view=full", server.url)).then(res => res.text());
    expect(user).toContain("&lt;admin&gt;");
    expect(user).toContain("full");
    expect(await fetch(new URL("/health", server.url)).then(res => res.text())).toBe("explicit");
    expect(await fetch(new URL("/rpc/echo", server.url)).then(res => res.json())).toMatchObject({ path: "/rpc/echo" });
    expect(await fetch(new URL("/client/route", server.url)).then(res => res.text())).toContain('id="spa-root"');
  });

  test("proxies a prefix and everything below it, keeping method, query, headers and body", async () => {
    await using server = await serveM3({
      proxy: { "/rpc": upstream.url.href },
      port: 0,
      hmr: false,
    });
    const exact = await fetch(new URL("/rpc", server.url)).then(r => r.json());
    expect(exact).toMatchObject({ method: "GET", path: "/rpc" });
    const nested = await fetch(new URL("/rpc/a/b?x=1", server.url), {
      method: "POST",
      body: "payload",
      headers: { "x-custom": "kept" },
    }).then(r => r.json());
    expect(nested).toMatchObject({
      method: "POST",
      path: "/rpc/a/b",
      query: "?x=1",
      body: "payload",
      custom: "kept",
    });
    expect(nested.host).toBe(new URL(upstream.url).host);
    // Unmatched paths without an index fall through to 404.
    expect((await fetch(new URL("/other", server.url))).status).toBe(404);
  });

  test("an unreachable upstream answers 502", async () => {
    const dead = Bun.serve({ port: 0, fetch: () => new Response("") });
    const target = dead.url.href;
    dead.stop(true);
    await using server = await serveM3({
      proxy: { "/api": target },
      port: 0,
      hmr: false,
    });
    const res = await fetch(new URL("/api/x", server.url));
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("upstream unreachable");
  });

  test("a custom fetch handles unmatched requests", async () => {
    await using server = await serveM3({
      port: 0,
      hmr: false,
      fetch: () => new Response("fallback", { status: 418 }),
    });
    const res = await fetch(new URL("/anything", server.url));
    expect(res.status).toBe(418);
  });
});

describe("routing helpers", () => {
  test("proxyRoutes maps each prefix to itself and prefix/*", () => {
    const routes = proxyRoutes({
      "/rpc/": "http://127.0.0.1:1",
      "/api": "http://127.0.0.1:2",
    });
    expect(Object.keys(routes).toSorted()).toEqual(["/api", "/api/*", "/rpc", "/rpc/*"]);
    expect(() => proxyRoutes({ rpc: "http://127.0.0.1:1" })).toThrow("must start with");
  });

  test("buildRoutes orders proxy, routes, then the /* fallback", async () => {
    const routes = await buildRoutes({
      proxy: { "/rpc": "http://127.0.0.1:1" },
      routes: { "/a": new Response("a") },
      index: SPA_HTML,
    });
    expect(Object.keys(routes)).toEqual(["/rpc", "/rpc/*", "/a", "/*"]);
    await expect(buildRoutes({ index: "not-html.txt" })).rejects.toThrow("not an .html file");
  });

  test("fileRoutes maps index, nested pages and dynamic segments", async () => {
    const routes = await fileRoutes(PAGES);
    expect(Object.keys(routes).toSorted()).toEqual(["/", "/about", "/health", "/rpc/echo", "/users/:id"]);
    await expect(fileRoutes(join(PAGES, "missing"))).rejects.toThrow("not a directory");
  });

  test("createProxy keeps a base path of the target", async () => {
    const proxy = createProxy(new URL("/base/", upstream.url).href);
    const res = await proxy(new Request("http://localhost/rpc/x?y=2"));
    expect(await res.json()).toMatchObject({
      path: "/base/rpc/x",
      query: "?y=2",
    });
  });

  test("resolvePort: explicit, then PORT, then 3000", () => {
    const saved = Bun.env.PORT;
    try {
      expect(resolvePort(1234)).toBe(1234);
      Bun.env.PORT = "4321";
      expect(resolvePort()).toBe(4321);
      delete Bun.env.PORT;
      expect(resolvePort()).toBe(3000);
    } finally {
      if (saved === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = saved;
    }
  });
});
