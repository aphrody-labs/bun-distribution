import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  createEdgeProxy,
  edgeDiskPath,
  validEdgeKey,
} from "../src/server/edge-proxy";

let upstream: ReturnType<typeof Bun.serve>;
let hits = 0;
const cacheDir = `${Bun.env.TMPDIR ?? "/tmp"}/edge-proxy-test-${process.pid}-${Date.now()}`;
const CSS = `body{src:url(https://up.example/s/a.woff2)}${"x".repeat(4000)}`;

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    routes: {
      "/style.css": async () => {
        hits++;
        await Bun.sleep(30);
        return new Response(CSS, {
          headers: { "content-type": "text/css; charset=utf-8" },
        });
      },
      "/font.woff2": () =>
        new Response(new Uint8Array([119, 79, 70, 50]), {
          headers: { "content-type": "font/woff2" },
        }),
      "/missing": () => new Response("no", { status: 404 }),
    },
  });
});

afterAll(async () => {
  upstream.stop(true);
  await Bun.$`rm -rf ${cacheDir}`.quiet();
});

const proxy = () =>
  createEdgeProxy({
    cacheDir,
    route: (url) => {
      if (url.pathname === "/escape")
        return {
          upstream: new URL("/style.css", upstream.url),
          cacheKey: "../x",
          kind: "text",
        };
      const target = {
        "/css": "/style.css",
        "/f.woff2": "/font.woff2",
        "/gone": "/missing",
      }[url.pathname];
      if (!target) return null;
      return {
        upstream: new URL(target, upstream.url),
        cacheKey: url.pathname === "/css" ? "css/a.css" : url.pathname.slice(1),
        kind: url.pathname === "/f.woff2" ? "immutable" : "text",
        transform:
          url.pathname === "/css"
            ? (s: string) =>
                s.replaceAll("https://up.example", "https://cdn.test")
            : undefined,
      };
    },
  });

test("first request fills, concurrent misses coalesce, later requests hit the disk", async () => {
  const handle = proxy();
  const [a, b] = await Promise.all([
    handle(new Request("http://x/css")),
    handle(new Request("http://x/css")),
  ]);
  expect(hits).toBe(1);
  expect(a.headers.get("x-edge-cache")).toBe("MISS");
  expect(await a.text()).toContain("https://cdn.test/s/a.woff2");
  expect(await b.text()).toContain("https://cdn.test/s/a.woff2");
  const c = await handle(new Request("http://x/css"));
  expect(c.headers.get("x-edge-cache")).toBe("HIT");
  expect(hits).toBe(1);
});

test("brotli twin is served when accepted, identity otherwise", async () => {
  const handle = proxy();
  const br = await handle(
    new Request("http://x/css", { headers: { "accept-encoding": "gzip, br" } }),
  );
  expect(br.headers.get("content-encoding")).toBe("br");
  expect(br.headers.get("vary")).toBe("Accept-Encoding");
  const raw = new Uint8Array(await br.arrayBuffer());
  const plain = await new Response(
    new Blob([raw]).stream().pipeThrough(new DecompressionStream("brotli")),
  ).text();
  expect(plain).toContain("https://cdn.test/s/a.woff2");
  expect(raw.byteLength).toBeLessThan(plain.length / 10);
  const id = await handle(
    new Request("http://x/css", { headers: { "accept-encoding": "gzip" } }),
  );
  expect(id.headers.get("content-encoding")).toBeNull();
});

test("binary immutable entries carry no brotli twin and a one-year cache", async () => {
  const handle = proxy();
  const r = await handle(
    new Request("http://x/f.woff2", { headers: { "accept-encoding": "br" } }),
  );
  expect(r.headers.get("content-encoding")).toBeNull();
  expect(r.headers.get("cache-control")).toContain("immutable");
  expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([119, 79, 70, 50]);
});

test("upstream 404, unknown routes, escaping keys and other methods", async () => {
  const handle = proxy();
  expect((await handle(new Request("http://x/gone"))).status).toBe(404);
  expect((await handle(new Request("http://x/nope"))).status).toBe(404);
  expect((await handle(new Request("http://x/escape"))).status).toBe(404);
  expect(
    (await handle(new Request("http://x/css", { method: "POST" }))).status,
  ).toBe(405);
  expect(validEdgeKey("s/roboto/v1/a.woff2")).toBe(true);
  for (const k of ["../a", "a/../b", "/abs", "a//b", "a/./b", "a b"])
    expect(validEdgeKey(k)).toBe(false);
});

test("cache keys longer than a file name are stored under a digest name", async () => {
  const long = `${"N".repeat(258)}.woff2`;
  const handle = createEdgeProxy({
    cacheDir,
    route: () => ({
      upstream: new URL("/font.woff2", upstream.url),
      cacheKey: `s/v1/${long}`,
      kind: "immutable",
    }),
  });
  const path = edgeDiskPath(cacheDir, `s/v1/${long}`);
  expect(path.slice(path.lastIndexOf("/") + 1).length).toBeLessThanOrEqual(97);
  expect(edgeDiskPath(cacheDir, "s/v1/short.woff2")).toBe(
    `${cacheDir}/s/v1/short.woff2`,
  );
  const miss = await handle(new Request(`http://edge/s/v1/${long}`));
  expect([miss.status, miss.headers.get("x-edge-cache")]).toEqual([
    200,
    "MISS",
  ]);
  expect(new Uint8Array(await miss.arrayBuffer())).toEqual(
    new Uint8Array([119, 79, 70, 50]),
  );
  const hit = await handle(new Request(`http://edge/s/v1/${long}`));
  expect(hit.headers.get("x-edge-cache")).toBe("HIT");
});
