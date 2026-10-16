// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
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
    expect(top).toEqual(
      [
        TAURI_LAYOUT.style,
        TAURI_LAYOUT.script,
        TAURI_LAYOUT.fonts,
        TAURI_LAYOUT.html,
      ].toSorted(),
    );
    expect((await readdir(join(uiDist, "fonts"))).toSorted()).toEqual([
      "GoogleSansFlex-Variable.ttf",
      "logo.svg",
      "material-symbols-outlined.woff2",
    ]);
    const html = await Bun.file(join(uiDist, "index.html")).text();
    // The fixture script is main.ts: renamed to app.js and the reference rewritten.
    expect(html).toContain('src="./app.js"');
    expect(html).toContain('href="./app.css"');
    expect(html).not.toContain("main");
    const css = await Bun.file(join(uiDist, "app.css")).text();
    expect(css).toMatch(
      /url\("?\.\/fonts\/material-symbols-outlined\.woff2"?\)/,
    );
    expect(css).toContain("--fixture-primary");
    expect(result.outputs.map((o) => o.path).toSorted()).toEqual([
      "app.css",
      "app.js",
      "fonts/GoogleSansFlex-Variable.ttf",
      "fonts/logo.svg",
      "fonts/material-symbols-outlined.woff2",
      "index.html",
    ]);
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

  test("`?url` imports are deterministic when the same file is also imported plainly", async () => {
    // Bun 1.4 deduplicates modules by path across namespaces, so a `?url` module and a plain
    // import of the same file used to race (app-ui flipped between 247 and 640 files).
    await using tmp = await tempDir();
    const src = join(tmp.dir, "src");
    const icons = Array.from({ length: 40 }, (_, i) => `i${i}`);
    for (const icon of icons) {
      // oxlint-disable-next-line no-await-in-loop -- Materialize the bounded icon fixtures before the serial build comparisons.
      await Bun.write(
        join(src, `${icon}.svg`),
        `<svg xmlns="http://www.w3.org/2000/svg" id="${icon}"/>`,
      );
      // oxlint-disable-next-line no-await-in-loop -- Complete the matching PNG fixture before advancing to the next icon.
      await Bun.write(
        join(src, `${icon}.png`),
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, icon.length]),
      );
    }
    const lines = (form: (icon: string) => string) =>
      icons.map(form).join("\n");
    await Bun.write(
      join(src, "plain.ts"),
      lines((i) => `export const ${i} = () => import("./${i}.svg");`),
    );
    await Bun.write(
      join(src, "plain-png.ts"),
      lines((i) => `export const ${i} = () => import("./${i}.png");`),
    );
    await Bun.write(
      join(src, "urls.ts"),
      `${lines((i) => `import ${i} from "./${i}.svg?url";\nimport ${i}p from "./${i}.png?url";`)}\nexport default [${icons.flatMap((i) => [i, `${i}p`]).join(", ")}];`,
    );
    // Both import orders, so either module can win the race.
    await Bun.write(
      join(src, "a.ts"),
      'import "./plain.ts"; import "./plain-png.ts"; import u from "./urls.ts"; console.log(u);',
    );
    await Bun.write(
      join(src, "b.ts"),
      'import u from "./urls.ts"; import "./plain.ts"; import "./plain-png.ts"; console.log(u);',
    );
    await Bun.write(
      join(src, "index.html"),
      '<!doctype html><html><body><script type="module" src="./a.ts"></script><script type="module" src="./b.ts"></script></body></html>',
    );
    await Bun.write(join(src, "bunfig.toml"), '[loader]\n".svg" = "text"\n');

    const runs: { files: string[]; js: string }[] = [];
    for (const [i, cwd] of [tmp.dir, src, tmp.dir, src].entries()) {
      const uiDist = join(tmp.dir, `ui-dist-${i}`);
      // oxlint-disable-next-line no-await-in-loop -- Compare build orders serially; each run must finish before starting another bundler.
      const result = await buildM3({
        entry: join(src, "index.html"),
        tauri: { uiDist },
        cwd,
        plugin: {
          css: fakeCss().css,
          theme: {},
          root: REPO_ROOT,
          tailwind: false,
        },
      });
      // oxlint-disable-next-line no-await-in-loop -- Read this completed build before comparing the next independently ordered run.
      const js = await Bun.file(join(uiDist, TAURI_LAYOUT.script)).text();
      runs.push({
        files: result.outputs.map((o) => o.path).toSorted(),
        js: new Bun.CryptoHasher("sha256").update(js).digest("hex"),
      });
      // The chosen forms: every svg is a fonts/ file, every png an inline data URL.
      expect(js).not.toContain("data:image/svg+xml");
      for (const icon of icons)
        expect(result.outputs.map((o) => o.path)).toContain(
          `fonts/${icon}.svg`,
        );
      expect(js.match(/data:image\/png;base64,/g)?.length).toBe(icons.length);
    }
    for (const run of runs.slice(1)) expect(run).toEqual(runs[0]!);
  });

  test("Tauri mode rejects several entries", async () => {
    await expect(
      buildM3({ entry: ["a.html", "b.html"], tauri: { uiDist: "x" } }),
    ).rejects.toThrow("exactly one");
    await expect(
      buildM3({ entry: "a.ts", tauri: { uiDist: "x" } }),
    ).rejects.toThrow(".html");
  });

  test("rewriteHtmlReference touches src/href attributes only", () => {
    const html =
      '<script src="./main.js"></script><link href="main.js"><p>main.js</p>';
    expect(rewriteHtmlReference(html, "main.js", "app.js")).toBe(
      '<script src="./app.js"></script><link href="./app.js"><p>main.js</p>',
    );
  });
});
