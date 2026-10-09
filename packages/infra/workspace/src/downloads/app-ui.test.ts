// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler, siteOptions } from "./server";

const workspace = mkdtempSync(join(tmpdir(), "aphrody-public-ui-"));
const root = join(workspace, "downloads");
const site = join(workspace, "site");
const ui = join(workspace, "ui");
for (const directory of [root, site, ui, join(ui, "fonts"), join(site, "docs")])
  mkdirSync(directory, { recursive: true });
writeFileSync(join(site, "index.html"), "original static home");
writeFileSync(join(site, "docs", "index.html"), "preserved Bun documentation");
writeFileSync(join(site, "runtime.html"), "preserved runtime page");
writeFileSync(join(site, "install"), "preserved installer");
writeFileSync(
  join(ui, "index.html"),
  '<html><head><base href="/"></head><body><div id="root"></div></body></html>',
);
writeFileSync(
  join(ui, "public-home.html"),
  '<html lang="en"><head><base href="/"><title>Aphrody</title></head><body><h1>Aphrody</h1><a href="/os">Open Aphrody OS</a></body></html>',
);
writeFileSync(join(ui, "app.js"), "app script");
writeFileSync(join(ui, "app.css"), "app style");
writeFileSync(join(ui, "fonts", "pet.webp"), "pet image");
const catalogue = await Bun.file(
  join(import.meta.dir, "../../../../../crates/web/site/data/docs.json"),
).json();
writeFileSync(join(ui, "public-docs.json"), JSON.stringify(catalogue));
mkdirSync(join(ui, "public-docs"));
for (const article of catalogue)
  writeFileSync(
    join(ui, "public-docs", article.id + ".html"),
    `<html><head><base href="/"></head><body><article><h1>${article.title}</h1></article></body></html>`,
  );
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
const options = { SITE_ROOT: site, APP_UI_ROOT: ui };
const handler = createHandler(root, siteOptions(root, options));
const request = (path: string, method = "GET", host = "aphrody.com") =>
  handler(new Request(`https://${host}${path}`, { method }));

test("public UI integration is explicit and validates the complete artifact", async () => {
  const original = createHandler(root, siteOptions(root, { SITE_ROOT: site }));
  expect(await (await original(new Request("https://aphrody.com/"))).text()).toBe(
    "original static home",
  );
  expect(() => siteOptions(root, { SITE_ROOT: site, APP_UI_ROOT: workspace })).toThrow(
    "complete canonical",
  );
});
test("explicit declaration enables only the protected current artifact and env takes precedence", () => {
  const base = join(workspace, "declaration");
  const downloads = join(base, "downloads");
  const directory = join(base, "app-ui");
  const current = join(directory, "current");
  mkdirSync(downloads, { recursive: true });
  cpSync(ui, current, { recursive: true });
  expect(siteOptions(downloads, {}).appUiRoot).toBeUndefined();
  const declaration = join(directory, "deployment.json");
  writeFileSync(declaration, JSON.stringify({ schemaVersion: 1, root: "current" }));
  expect(siteOptions(downloads, {}).appUiRoot).toBe(current);
  for (const invalid of [
    "{}",
    "{",
    JSON.stringify({ schemaVersion: 2, root: "current" }),
    JSON.stringify({ schemaVersion: 1, root: "../ui" }),
    JSON.stringify({ schemaVersion: 1, root: "current", proxy: "http://localhost" }),
  ]) {
    writeFileSync(declaration, invalid);
    expect(() => siteOptions(downloads, {})).toThrow("Invalid app-ui deployment declaration");
    expect(siteOptions(downloads, { APP_UI_ROOT: ui }).appUiRoot).toBe(ui);
  }
  writeFileSync(declaration, JSON.stringify({ schemaVersion: 1, root: "current" }));
  rmSync(current, { recursive: true });
  const release = join(directory, "releases", "verified-release");
  cpSync(ui, release, { recursive: true });
  symlinkSync(release, current, process.platform === "win32" ? "junction" : "dir");
  expect(siteOptions(downloads, {}).appUiRoot).toBe(release);
  rmSync(current, { recursive: true });
  symlinkSync(ui, current, process.platform === "win32" ? "junction" : "dir");
  expect(() => siteOptions(downloads, {})).toThrow("Invalid app-ui deployment declaration");
});
test("canonical homepage and OS serve namespaced assets without exposing native RPC", async () => {
  const home = await request("/");
  expect(home.status).toBe(200);
  expect(await home.text()).toContain('href="/_app-ui/"');
  const os = await request("/os");
  expect(await os.text()).toContain('name="aphrody-rpc" content="unavailable"');
  expect(os.headers.get("content-security-policy")).toContain("base-uri 'self'");
  expect(await (await request("/_app-ui/app.js")).text()).toBe("app script");
  expect((await request("/_app-ui/fonts/pet.webp")).headers.get("content-type")).toBe("image/webp");
  expect(await (await request("/os", "HEAD")).text()).toBe("");
  expect((await request("/rpc", "POST")).status).toBe(405);
});
test("public product catalogue preserves all five IDs and static Bun routes take precedence", async () => {
  const api = await request("/api/docs");
  expect(api.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await api.json()).toEqual(catalogue);
  expect(catalogue).toHaveLength(5);
  const article = await request("/docs/runtime-architecture");
  expect(await article.text()).toContain('href="/_app-ui/"');
  expect(await (await request("/api/docs", "HEAD")).text()).toBe("");
  expect((await request("/api/docs", "POST")).status).toBe(405);
  expect((await request("/docs/not-a-product-article")).status).toBe(404);
  writeFileSync(join(site, "docs", "runtime-architecture.html"), "existing Bun page wins");
  expect(await (await request("/docs/runtime-architecture")).text()).toBe("existing Bun page wins");
});
test("static docs runtime installers and download host remain isolated", async () => {
  await Promise.all(
    [
      ["/docs", "preserved Bun documentation"],
      ["/runtime", "preserved runtime page"],
      ["/install", "preserved installer"],
    ].map(async ([path, expected]) => {
      expect(await (await request(path!)).text()).toBe(expected!);
    }),
  );
  expect((await request("/os", "GET", "downloads.aphrody.com")).status).toBe(404);
  expect((await request("/_app-ui/%2e%2e%2fsite/index.html")).status).toBe(404);
  expect((await request("/_app-ui/.env")).status).toBe(404);
});
