// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../../src/app/build.ts";
import { type AppHandler, loadApp } from "../../src/app/host.ts";
import { type PrerenderResult, prerenderApp } from "../../src/app/prerender.ts";
import { ACTION_HEADER, RSC_CONTENT_TYPE, RSC_HEADER } from "../../src/app/runtime/shared.ts";
import { tempDir } from "../helpers.ts";

const FIXTURE = join(import.meta.dir, "../fixtures/app-router");
const ORIGIN = "http://localhost";

let tmp: Awaited<ReturnType<typeof tempDir>>;
let outDir: string;
let app: AppHandler;
let prerendered: PrerenderResult;

beforeAll(async () => {
  tmp = await tempDir("m3-app-");
  outDir = join(tmp.dir, "dist");
  await buildApp({ root: FIXTURE, outDir, buildId: "test" });
  prerendered = await prerenderApp(outDir, ORIGIN);
  app = await loadApp(outDir);
}, 120_000);
afterAll(() => tmp?.[Symbol.asyncDispose]());

const get = (path: string, init?: RequestInit) => app.fetch(new Request(ORIGIN + path, init));

describe("build", () => {
  test("writes the manifest, client bundles and server entries", () => {
    const { manifest } = app;
    expect(manifest.version).toBe(1);
    expect(manifest.buildId).toBe("test");
    expect(manifest.middleware).toBe(true);
    expect(
      Object.keys(manifest.clientModules)
        .filter((k) => !k.includes("src/app"))
        .toSorted(),
    ).toEqual(["app/counter.tsx", "app/form.tsx"]);
    expect(existsSync(join(outDir, manifest.rscEntry))).toBe(true);
    expect(existsSync(join(outDir, manifest.ssrEntry))).toBe(true);
    expect(existsSync(join(outDir, "client", manifest.bootstrap))).toBe(true);
    expect(manifest.static["/hello.txt"]).toBeDefined();
  });

  test("prerenders static pages and generateStaticParams, leaves request-bound pages dynamic", () => {
    expect(prerendered.pages.toSorted()).toEqual(["/", "/blog/first", "/blog/second"]);
    expect(prerendered.dynamic.map((d) => d.path)).toContain("/dash");
    expect(existsSync(join(outDir, "prerender", "index.html"))).toBe(true);
    expect(existsSync(join(outDir, "prerender", "blog/first.rsc"))).toBe(true);
  });
});

describe("host", () => {
  test("SSR HTML carries the page, metadata, client markup, the inline payload and the bootstrap", async () => {
    const response = await get("/");
    const html = await response.text();
    expect(html).toStartWith("<!DOCTYPE html>");
    expect(html).toContain("<title>Home | Fixture</title>");
    expect(html).toContain('content="m3 App Router fixture"');
    expect(html).toContain("Home page");
    expect(html).toMatch(/count (<!-- -->)?3/);
    expect(html).toContain("self.__m3_f");
    expect(html).toContain(app.manifest.bootstrap);
    expect(html.trimEnd()).toEndWith("</body></html>");
    expect(response.headers.get("x-fixture")).toBe("1");
    expect(response.status).toBe(200);
  });

  test("an RSC request returns the flight payload", async () => {
    const response = await get("/blog/first", { headers: { [RSC_HEADER]: "1" } });
    expect(response.headers.get("content-type")).toStartWith(RSC_CONTENT_TYPE);
    expect(response.headers.get("vary")).toBe(RSC_HEADER);
    expect(await response.text()).toContain("First post body");
  });

  test("dynamic params render with generateMetadata", async () => {
    const html = await (await get("/blog/second")).text();
    expect(html).toContain("<title>Post second | Fixture</title>");
    expect(html).toContain("Second post body");
  });

  test("notFound() and unknown paths render the not-found page with 404", async () => {
    await Promise.all(
      ["/blog/missing", "/nope"].map(async (path) => {
        const response = await get(path);
        expect(await response.text()).toContain("Nothing here");
        expect(response.status).toBe(404);
      }),
    );
  });

  test("request data is read per request", async () => {
    const response = await get("/dash", {
      headers: { "user-agent": "fixture-agent", cookie: "theme=dark" },
    });
    const html = await response.text();
    expect(html).toContain("fixture-agent");
    expect(html).toContain("dark");
  });

  test("route handlers answer by method", async () => {
    expect(await (await get("/api/hello?name=m3")).json()).toEqual({ hello: "m3" });
    const posted = await get("/api/hello", { method: "POST", body: "hi" });
    expect(await posted.json()).toEqual({ echo: "hi" });
    expect(posted.status).toBe(201);
    const deleted = await get("/api/hello", { method: "DELETE" });
    expect(deleted.headers.get("allow")).toContain("GET");
    expect(deleted.status).toBe(405);
  });

  test("the middleware can redirect, and is skipped outside its matcher", async () => {
    const redirected = await get("/old");
    expect(redirected.headers.get("location")).toBe(`${ORIGIN}/`);
    expect([307, 308]).toContain(redirected.status);
    expect((await get("/api/hello")).headers.get("x-fixture")).toBeNull();
  });

  test("a trailing slash redirects with 308", async () => {
    const response = await get("/dash/");
    expect(response.headers.get("location")).toBe("/dash");
    expect(response.status).toBe(308);
  });

  test("server actions run from an encoded reply and return their value in the payload", async () => {
    const response = await get("/", {
      method: "POST",
      headers: { [ACTION_HEADER]: "app/actions.ts#add", [RSC_HEADER]: "1" },
      body: JSON.stringify([2, 3]),
    });
    expect(await response.text()).toContain('"data":5');
    expect(response.status).toBe(200);
  });

  test("redirect() in a server action is reported in the payload", async () => {
    const response = await get("/dash", {
      method: "POST",
      headers: { [ACTION_HEADER]: "app/actions.ts#goHome", [RSC_HEADER]: "1" },
      body: "[]",
    });
    expect(await response.text()).toContain('"redirect":"/"');
  });

  test("metadata routes, public files and hashed assets are served", async () => {
    const robots = await (await get("/robots.txt")).text();
    expect(robots).toContain("User-Agent: *");
    expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
    expect((await (await get("/hello.txt")).text()).trim()).toBe("fixture static");
    const asset = await get("/_m3/" + app.manifest.bootstrap);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.status).toBe(200);
    expect((await get("/_m3/..%2fmanifest.json")).status).toBe(404);
  });

  test("HEAD has headers and no body", async () => {
    const response = await get("/dash", { method: "HEAD" });
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).toStartWith("text/html");
  });

  test("HTMLRewriter transforms the streamed HTML document", async () => {
    const rewrittenApp = await loadApp(outDir, {
      rewriter: (rw) =>
        rw.on("main", {
          element(el) {
            el.setAttribute("data-rewritten", "true");
          },
        }),
    });
    const response = await rewrittenApp.fetch(new Request(ORIGIN + "/"));
    const html = await response.text();
    expect(html).toContain('data-rewritten="true"');
  });
});
