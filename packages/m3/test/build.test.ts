// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildM3, rewriteHtmlReference, TAURI_LAYOUT } from "../src/build.ts";
import { FIXTURE, fakeCss, REPO_ROOT, tempDir } from "./helpers.ts";

describe("buildM3", () => {
  test("Tauri mode writes index.html, app.js, app.css and fonts/ without hashes", async () => {
    await using tmp = await tempDir();
    const uiDist = join(tmp.dir, "ui-dist");
    const result = await buildM3({
      entry: join(FIXTURE, "index.html"),
      tauri: { uiDist },
      plugin: { css: fakeCss().css, theme: {}, root: REPO_ROOT },
    });
    expect(result.outdir).toBe(uiDist);
    const top = (await readdir(uiDist)).toSorted();
    expect(top).toEqual([TAURI_LAYOUT.style, TAURI_LAYOUT.script, TAURI_LAYOUT.fonts, TAURI_LAYOUT.html].toSorted());
    expect((await readdir(join(uiDist, "fonts"))).toSorted()).toEqual([
      "GoogleSansFlex-Variable.ttf",
      "material-symbols-outlined.woff2",
    ]);
    const html = await readFile(join(uiDist, "index.html"), "utf8");
    // The fixture script is main.ts: renamed to app.js and the reference rewritten.
    expect(html).toContain('src="./app.js"');
    expect(html).toContain('href="./app.css"');
    expect(html).not.toContain("main");
    const css = await readFile(join(uiDist, "app.css"), "utf8");
    expect(css).toMatch(/url\("?\.\/fonts\/material-symbols-outlined\.woff2"?\)/);
    expect(css).toContain("--fixture-primary");
    expect(result.outputs.map((o) => o.path).toSorted()).toEqual(
      ["app.css", "app.js", "fonts/GoogleSansFlex-Variable.ttf", "fonts/material-symbols-outlined.woff2", "index.html"],
    );
    expect(result.outputs.every((o) => o.bytes > 0)).toBe(true);
  });

  test("static mode minifies into outdir with hashed chunks and cleans it first", async () => {
    await using tmp = await tempDir();
    const outdir = join(tmp.dir, "dist");
    await Bun.write(join(outdir, "stale.txt"), "old");
    const result = await buildM3({
      entry: join(FIXTURE, "index.html"),
      outdir,
      cwd: FIXTURE,
      define: { __FIXTURE__: "true" },
      plugin: { css: fakeCss().css, theme: {}, root: REPO_ROOT },
    });
    expect(existsSync(join(outdir, "stale.txt"))).toBe(false);
    expect(existsSync(join(outdir, "index.html"))).toBe(true);
    const js = result.outputs.find((o) => o.path.endsWith(".js"));
    expect(js?.path).toMatch(/-[a-z0-9]+\.js$/);
  });

  test("Tauri mode rejects several entries", async () => {
    await expect(buildM3({ entry: ["a.html", "b.html"], tauri: { uiDist: "x" } })).rejects.toThrow("exactly one");
    await expect(buildM3({ entry: "a.ts", tauri: { uiDist: "x" } })).rejects.toThrow(".html");
  });

  test("rewriteHtmlReference touches src/href attributes only", () => {
    const html = '<script src="./main.js"></script><link href="main.js"><p>main.js</p>';
    expect(rewriteHtmlReference(html, "main.js", "app.js")).toBe(
      '<script src="./app.js"></script><link href="./app.js"><p>main.js</p>',
    );
  });
});
