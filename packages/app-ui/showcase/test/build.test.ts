// SPDX-License-Identifier: Apache-2.0
// Smoke test of the single M3 showcase (it absorbed m3/apps/web): the production build of
// src/index.html through the m3-bun pipeline of `yolo m3 bun build` emits the page with its
// favicon, script and stylesheet.
import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildApp } from "@aphrody/m3-bun";

const app = resolve(import.meta.dir, "..");

test("the showcase builds into html, favicon, script and stylesheet", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "m3-showcase-"));
  try {
    const report = await buildApp({ dir: app, outdir });
    expect(report.manifest.entry).toBe("index.html");
    const files = (await readdir(outdir, { recursive: true })).map(String);
    const page = files.find(f => f.endsWith("index.html"));
    expect(page).toBeDefined();
    const html = await Bun.file(join(outdir, page!)).text();
    const icon = /<link[^>]+rel="icon"[^>]+href="([^"]+)"/.exec(html)?.[1];
    expect(icon).toBeDefined();
    expect(await Bun.file(resolve(outdir, page!, "..", icon!)).exists()).toBe(true);
    expect(files.some(f => f.endsWith(".js"))).toBe(true);
    const css = files.filter(f => f.endsWith(".css"));
    expect(css.length).toBeGreaterThan(0);
    const style = (await Promise.all(css.map(f => Bun.file(join(outdir, f)).text()))).join("\n");
    expect(style).toMatch(/--md-sys-color-surface|surface/);
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}, 120_000);
