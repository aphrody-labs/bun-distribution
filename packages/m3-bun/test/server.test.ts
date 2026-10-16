// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import type { M3Request } from "../src/api.ts";
import {
  cacheControl,
  createM3App,
  DEFAULT_CSP,
  dirSource,
  embeddedSource,
  pickEncoding,
  resolvePort,
  startM3Server,
} from "../src/server.ts";
import { cleanup, tmp } from "./helpers.ts";

const BIG_JS = `export const x = "${"abcdefghij".repeat(400)}";\n`;
let dir = "";

beforeAll(() => {
  dir = tmp();
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>home</title>");
  writeFileSync(join(dir, "chunk-abcd1234.js"), BIG_JS);
  writeFileSync(join(dir, "app.js"), BIG_JS);
  writeFileSync(
    join(dir, "assets", "logo.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg">${"<g/>".repeat(400)}</svg>`,
  );
  writeFileSync(join(dir, "app.js.map"), "{}");
  writeFileSync(join(dir, "docs.html"), "<title>docs</title>");
  utimesSync(join(dir, "index.html"), 1_700_000_000, 1_700_000_000);
});
afterAll(cleanup);

const get = (
  app: ReturnType<typeof createM3App>,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) => app.fetch(new Request(`http://m3.test${path}`, { method, headers }));

const staticApp = () =>
  createM3App({ name: "t", version: "9.9.9", files: dirSource(dir) });

describe("static files", () => {
  test("the entry answers / and keeps no-cache; sourcemaps are not served", async () => {
    const res = await get(staticApp(), "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("<title>home</title>");
    expect((await get(staticApp(), "/app.js.map")).status).toBe(404);
  });

  test("security headers and the default CSP are on every file response", async () => {
    const res = await get(staticApp(), "/index.html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe(DEFAULT_CSP);
    const none = createM3App({ files: dirSource(dir), csp: false });
    expect(
      (await get(none, "/index.html")).headers.get("content-security-policy"),
    ).toBeNull();
    const custom = createM3App({
      files: dirSource(dir),
      csp: "default-src 'none'",
    });
    expect(
      (await get(custom, "/index.html")).headers.get("content-security-policy"),
    ).toBe("default-src 'none'");
  });

  test("content-hashed names are immutable, others expire in an hour", async () => {
    expect(
      (await get(staticApp(), "/chunk-abcd1234.js")).headers.get(
        "cache-control",
      ),
    ).toBe("public, max-age=31536000, immutable");
    expect(
      (await get(staticApp(), "/app.js")).headers.get("cache-control"),
    ).toBe("public, max-age=3600");
    expect(cacheControl("/x.html", "text/html;charset=utf-8")).toBe("no-cache");
  });

  test("ETag revalidation answers 304 and a changed validator does not", async () => {
    const first = await get(staticApp(), "/app.js");
    const etag = first.headers.get("etag")!;
    expect(etag).toStartWith('W/"');
    expect(
      (await get(staticApp(), "/app.js", { "if-none-match": etag })).status,
    ).toBe(304);
    expect(
      (await get(staticApp(), "/app.js", { "if-none-match": 'W/"other"' }))
        .status,
    ).toBe(200);
  });

  test("compressible files are served br or gzip when accepted, identity otherwise, and round-trip", async () => {
    const br = await get(staticApp(), "/app.js", {
      "accept-encoding": "gzip, br",
    });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("vary")).toContain("Accept-Encoding");
    expect(
      brotliDecompressSync(new Uint8Array(await br.arrayBuffer())).toString(),
    ).toBe(BIG_JS);
    const gz = await get(staticApp(), "/app.js", { "accept-encoding": "gzip" });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(new Uint8Array(await gz.arrayBuffer())).toString()).toBe(
      BIG_JS,
    );
    const plain = await get(staticApp(), "/app.js");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe(BIG_JS);
    expect(
      (
        await get(staticApp(), "/assets/logo.svg", { "accept-encoding": "br" })
      ).headers.get("content-encoding"),
    ).toBe("br");
  });

  test("HEAD returns headers and no body", async () => {
    const res = await get(staticApp(), "/app.js", {}, "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(BIG_JS.length));
    expect(await res.text()).toBe("");
  });

  test("SPA fallback: extension-less HTML navigations get index.html, assets and other methods do not", async () => {
    const nav = await get(staticApp(), "/some/client/route", {
      accept: "text/html,application/xhtml+xml",
    });
    expect(nav.status).toBe(200);
    expect(await nav.text()).toContain("<title>home</title>");
    expect(
      (await get(staticApp(), "/some/route", { accept: "application/json" }))
        .status,
    ).toBe(404);
    expect(
      (await get(staticApp(), "/missing.js", { accept: "text/html" })).status,
    ).toBe(404);
    expect(
      (
        await staticApp().fetch(
          new Request("http://m3.test/some/route", {
            method: "POST",
            headers: { accept: "text/html" },
          }),
        )
      ).status,
    ).toBe(404);
    const off = createM3App({ files: dirSource(dir), spa: false });
    expect(
      (await get(off, "/some/route", { accept: "text/html" })).status,
    ).toBe(404);
  });

  test("a directory path serves its index, a bare name serves name/index.html when present", async () => {
    mkdirSync(join(dir, "guide"), { recursive: true });
    writeFileSync(join(dir, "guide", "index.html"), "<title>guide</title>");
    const withGuide = createM3App({ files: dirSource(dir) });
    expect(await (await get(withGuide, "/guide/")).text()).toContain("guide");
    expect(await (await get(withGuide, "/guide")).text()).toContain("guide");
  });

  test("path traversal and bad encodings are refused", async () => {
    // The URL parser already folds `%2e%2e` dot segments, so those arrive as plain missing paths; encoded
    // separators and bad encodings reach the guard. Either way nothing outside the build directory is served.
    for (const path of [
      "/%2e%2e/%2e%2e/etc/passwd",
      "/..%2f..%2fetc/passwd",
      "/%2e%2e%2f%2e%2e%2fetc/passwd",
      "/%E0%A4%A",
      "/a%00b",
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- Check each rejected path against the shared fixture app before proceeding.
      const res = await get(staticApp(), path);
      expect([400, 404]).toContain(res.status);
    }
    expect((await get(staticApp(), "/%E0%A4%A")).status).toBe(400);
    expect((await get(staticApp(), "/a%00b")).status).toBe(400);
    expect((await get(staticApp(), "/..%2f..%2fetc/passwd")).status).toBe(400);
  });
});

describe("health, info and the API", () => {
  const app = createM3App({
    name: "demo",
    version: "1.0.0",
    buildId: "abc",
    files: dirSource(dir),
    info: { extra: true },
    api: {
      "/api/ping": () => Response.json({ pong: true }),
      "/api/shadow": () => Response.json({ from: "api" }),
    },
  });

  test("/healthz and /api/m3/info", async () => {
    const health = await (await get(app, "/healthz")).json();
    expect(health).toMatchObject({ ok: true, name: "demo", version: "1.0.0" });
    const info = await (await get(app, "/api/m3/info")).json();
    expect(info).toMatchObject({
      name: "demo",
      version: "1.0.0",
      buildId: "abc",
      bun: Bun.version,
      extra: true,
    });
    expect(info.api).toEqual(["/api/ping", "/api/shadow"]);
    expect(info.files).toBeGreaterThan(3);
    expect((await get(createM3App({ health: false }), "/healthz")).status).toBe(
      404,
    );
    expect(
      (await get(createM3App({ health: "/ready" }), "/ready")).status,
    ).toBe(200);
  });

  test("API routes answer before static files, a fallback fetch can pass or answer", async () => {
    expect(await (await get(app, "/api/ping")).json()).toEqual({ pong: true });
    const fallback = createM3App({
      files: dirSource(dir),
      api: {
        routes: {},
        fetch: (request: Request) =>
          new URL(request.url).pathname === "/custom"
            ? new Response("custom")
            : undefined,
      },
    });
    expect(await (await get(fallback, "/custom")).text()).toBe("custom");
    expect(await (await get(fallback, "/index.html")).text()).toContain("home");
  });

  test("no files: only API and health answer, anything else is 404", async () => {
    const apiOnly = createM3App({ api: { "/api/x": () => new Response("x") } });
    expect(await (await get(apiOnly, "/api/x")).text()).toBe("x");
    expect((await get(apiOnly, "/")).status).toBe(404);
  });
});

describe("embedded files", () => {
  test("an embedded source serves what the generated entry maps, with a build-id ETag", async () => {
    const source = embeddedSource(
      {
        "/index.html": join(dir, "index.html"),
        "/app.js": join(dir, "app.js"),
      },
      "build1",
    );
    expect(source.paths()).toEqual(["/app.js", "/index.html"]);
    expect(source.etag("/app.js")).toBe(
      `W/"${BIG_JS.length.toString(16)}-build1"`,
    );
    const app = createM3App({ files: source });
    expect(await (await get(app, "/")).text()).toContain("home");
  });
});

describe("encoding and port helpers", () => {
  test("pickEncoding prefers br, then gzip", () => {
    expect(pickEncoding("gzip, deflate, br")).toBe("br");
    expect(pickEncoding("gzip")).toBe("gzip");
    expect(pickEncoding("identity")).toBeUndefined();
    expect(pickEncoding(null)).toBeUndefined();
  });
  test("resolvePort: PORT first, then the option, then 3000", () => {
    const saved = Bun.env.PORT;
    try {
      delete Bun.env.PORT;
      expect(resolvePort()).toBe(3000);
      expect(resolvePort(4000)).toBe(4000);
      Bun.env.PORT = "5000";
      expect(resolvePort(4000)).toBe(5000);
      Bun.env.PORT = "nope";
      expect(resolvePort(4000)).toBe(4000);
    } finally {
      if (saved === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = saved;
    }
  });
});

describe("one process, one socket: UI and API over real HTTP", () => {
  test("Bun.serve answers native API routes and the file server from the same port", async () => {
    const saved = Bun.env.PORT;
    delete Bun.env.PORT;
    const server = startM3Server({
      port: 0,
      hostname: "127.0.0.1",
      name: "real",
      files: dirSource(dir),
      api: {
        "/api/echo/:word": (request: M3Request) =>
          Response.json({ word: request.params.word }),
      },
    });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      expect(await (await fetch(`${base}/api/echo/hi`)).json()).toEqual({
        word: "hi",
      });
      const page = await fetch(base);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("home");
      expect(
        ((await (await fetch(`${base}/healthz`)).json()) as { name: string })
          .name,
      ).toBe("real");
      const asset = await fetch(`${base}/app.js`, {
        headers: { "accept-encoding": "br" },
      });
      expect(asset.headers.get("content-encoding")).toBe("br");
    } finally {
      await server.stop(true);
      if (saved !== undefined) Bun.env.PORT = saved;
    }
  });
});

describe("serving a build", () => {
  test("an uncaught API error answers a plain 500, not the development error page", async () => {
    const server = startM3Server({
      port: 0,
      hostname: "127.0.0.1",
      files: dirSource(dir),
      api: {
        "/api/boom": () => {
          throw new Error("secret detail");
        },
      },
    });
    try {
      expect(server.development).toBe(false);
      const res = await fetch(`http://127.0.0.1:${server.port}/api/boom`);
      expect(res.status).toBe(500);
      const body = await res.text();
      expect(body).not.toContain("secret detail");
      expect(body).not.toContain("__bunfallback");
    } finally {
      await server.stop(true);
    }
  });
});
