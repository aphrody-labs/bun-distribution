// SPDX-License-Identifier: Apache-2.0
// Smoke test of the showcase: the production build of src/index.html emits the page with its
// favicon, script and stylesheet. Token sheets come from a deterministic generator, so the build
// needs no native library (docs/guides/NATIVE.md); the fonts resolve from the synced m3-fonts.
import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildM3 } from "@aphrody/m3/build";

const app = resolve(import.meta.dir, "..");
const repo = resolve(app, "../..");

test("the showcase builds into html, favicon, script and stylesheet", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "m3-web-"));
  try {
    await buildM3({
      entry: join(app, "src/index.html"),
      outdir,
      cwd: app,
      plugin: { theme: { seed: "#6750a4" }, root: repo, css: (config) => `:root { --showcase-sheet: ${config.sheet}; }\n` },
    });
    const files = (await readdir(outdir, { recursive: true })).map(String);
    // Bun keeps the entry's directory relative to the common root: src/index.html.
    const page = files.find((f) => f.endsWith("index.html"));
    expect(page).toBeDefined();
    const html = await Bun.file(join(outdir, page!)).text();
    const icon = /<link[^>]+rel="icon"[^>]+href="([^"]+)"/.exec(html)?.[1];
    expect(icon).toBeDefined();
    expect(await Bun.file(resolve(outdir, page!, "..", icon!)).exists()).toBe(true);
    expect(files.some((f) => f.endsWith(".js"))).toBe(true);
    const css = files.filter((f) => f.endsWith(".css"));
    expect(css.length).toBeGreaterThan(0);
    const style = (await Promise.all(css.map((f) => Bun.file(join(outdir, f)).text()))).join("\n");
    // The M3 Tailwind preset produced the surface utilities the page uses.
    expect(style).toMatch(/--md-sys-color-surface|surface/);
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
