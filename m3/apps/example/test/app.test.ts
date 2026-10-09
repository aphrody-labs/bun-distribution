// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AppHandler,
  buildApp,
  findAppProject,
  loadApp,
  type PrerenderResult,
  prerenderApp,
} from "@aphrody/m3/app";
import { m3Plugin } from "@aphrody/m3/plugin";

const ROOT = join(import.meta.dir, "..");
const ORIGIN = "http://localhost";
const ACTION_HEADER = "m3-action";
const RSC_HEADER = "rsc";

let outDir: string;
let app: AppHandler;
let prerendered: PrerenderResult;

beforeAll(async () => {
  const project = await findAppProject(ROOT);
  if (!project) throw new Error("m3.config.ts of the example must enable `app`");
  outDir = await mkdtemp(join(tmpdir(), "m3-example-"));
  await buildApp({
    root: project.root,
    appDir: project.appDir,
    outDir,
    buildId: "test",
    clientPlugins: [m3Plugin({ theme: project.theme, root: project.fontsRoot, configDir: project.root })],
  });
  prerendered = await prerenderApp(outDir, ORIGIN);
  app = await loadApp(outDir);
}, 120_000);
afterAll(() => outDir && rm(outDir, { recursive: true, force: true }));

const get = (path: string, init?: RequestInit) => app.fetch(new Request(ORIGIN + path, init));

/**
 * The reply `encodeReply([{}, form])` sends from a browser: the root model in field `0`, the FormData argument
 * as `$K1` with its fields prefixed `_1_`. Built by hand because Bun's `FormData.prototype.toJSON` makes React's
 * encoder serialize the form as a plain object.
 */
function signReply(fields: Record<string, string>): FormData {
  const body = new FormData();
  body.set("0", JSON.stringify([{}, "$K1"]));
  for (const [key, value] of Object.entries(fields)) body.set(`_1_${key}`, value);
  return body;
}

describe("m3 example app", () => {
  test("ships the client components only", () => {
    expect(
      Object.keys(app.manifest.clientModules)
        .filter(k => k.startsWith("app/"))
        .toSorted(),
    ).toEqual(["app/counter.tsx", "app/error.tsx", "app/guestbook/sign-form.tsx", "app/people/people-table.tsx"]);
  });

  test("prerenders the static pages, keeps the guestbook dynamic", () => {
    expect(prerendered.pages).toContain("/");
    expect(prerendered.pages).toContain("/people");
    expect(prerendered.pages).toContain("/people/1");
    expect(prerendered.pages).toContain("/people/10");
    expect(prerendered.pages).not.toContain("/people/11");
    expect(prerendered.dynamic.map(d => d.path)).toContain("/guestbook");
  });

  test("home renders metadata and the client counter", async () => {
    const response = await get("/");
    const html = await response.text();
    expect(html).toContain("<title>Home · m3 example</title>");
    expect(html).toMatch(/(<!-- -->)?120(<!-- -->)? people are loaded on the server/);
    expect(html).toMatch(/Clicked (<!-- -->)?0(<!-- -->)? times/);
    expect(response.status).toBe(200);
  });

  test("people table is server data rendered by the M3 DataTable", async () => {
    const html = await (await get("/people")).text();
    expect(html).toContain("120 people");
    expect(html).toContain("Ada Lovelace");
  });

  test("person pages use generateMetadata and notFound()", async () => {
    expect(await (await get("/people/2")).text()).toContain("<title>Grace Ritchie · m3 example</title>");
    const missing = await get("/people/9999");
    expect(await missing.text()).toContain("Not found");
    expect(missing.status).toBe(404);
  });

  test("the guestbook action validates and stores an entry", async () => {
    const invalid = await get("/guestbook", {
      method: "POST",
      headers: { [ACTION_HEADER]: "app/guestbook/actions.ts#sign", [RSC_HEADER]: "1" },
      body: signReply({}),
    });
    expect(await invalid.text()).toContain("Name and message are required.");
    expect(invalid.status).toBe(200);

    const signed = await get("/guestbook", {
      method: "POST",
      headers: { [ACTION_HEADER]: "app/guestbook/actions.ts#sign", [RSC_HEADER]: "1" },
      body: signReply({ name: "Ada", message: "Hello from the test" }),
    });
    expect(await signed.text()).toContain('"signed":"Ada"');
    expect(await (await get("/guestbook")).text()).toContain("Hello from the test");
  });

  test("route handler and sitemap", async () => {
    expect(await (await get("/api/health")).json()).toEqual({ ok: true, runtime: `bun ${Bun.version}` });
    const sitemap = await (await get("/sitemap.xml")).text();
    expect(sitemap).toContain("<loc>http://localhost:3000/people/10</loc>");
  });
});
