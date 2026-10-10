// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildApp,
  checkEngine,
  hoistHtml,
  listBuild,
  minifyOptions,
  readManifest,
} from "../src/build.ts";
import { sha256 } from "../src/util.ts";
import { cleanup, fixtureCopy } from "./helpers.ts";

afterAll(cleanup);

describe("hoistHtml", () => {
  test("strips the directory depth the entry sat in, from every src and href", () => {
    const html =
      '<link rel="stylesheet" href="../chunk-a.css"><script type="module" src="../chunk-b.js"></script><a href="../../x/y">';
    expect(hoistHtml(html, 1)).toBe(
      '<link rel="stylesheet" href="./chunk-a.css"><script type="module" src="./chunk-b.js"></script><a href="../x/y">',
    );
    expect(hoistHtml(html, 2)).toBe(
      '<link rel="stylesheet" href="./chunk-a.css"><script type="module" src="./chunk-b.js"></script><a href="./x/y">',
    );
    expect(hoistHtml(html, 0)).toBe(html);
  });
  test("absolute and external references are left alone", () => {
    const html = '<script src="https://cdn.example.com/x.js"></script><img src="/logo.svg">';
    expect(hoistHtml(html, 1)).toBe(html);
  });
  test("only attributes are rewritten: script text and comments that look like attributes stay as they are", () => {
    const html =
      '<!-- <img src="../c.png"> --><script>document.write(\x27<img src="../a.png">\x27)</script><img data-src="../b.png" src="../b.png">';
    expect(hoistHtml(html, 1)).toBe(
      '<!-- <img src="../c.png"> --><script>document.write(\x27<img src="../a.png">\x27)</script><img data-src="../b.png" src="./b.png">',
    );
  });
});

describe("checkEngine", () => {
  test("warns when the running Bun does not satisfy engines.bun of the app", async () => {
    const dir = fixtureCopy();
    expect(checkEngine(dir, "1.4.3")).toBeUndefined();
    const manifest = await Bun.file(join(dir, "package.json")).json();
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({ ...manifest, engines: { bun: ">=1.5.0" } }),
    );
    expect(checkEngine(dir, "1.5.2")).toBeUndefined();
    expect(checkEngine(dir, "1.4.3")).toContain(">=1.5.0");
  });
});

describe("minifyOptions", () => {
  test("none, basic and full", () => {
    expect(minifyOptions("none")).toBe(false);
    expect(minifyOptions("basic")).toEqual({ whitespace: true, syntax: true, identifiers: false });
    expect(minifyOptions("full")).toEqual({ whitespace: true, syntax: true, identifiers: true });
  });
});

describe("buildApp", () => {
  test("builds the fixture to a deployable layout: index.html at the root, hashed assets, manifest", async () => {
    const dir = fixtureCopy();
    const report = await buildApp({ dir });
    const names = readdirSync(report.outdir).toSorted();
    expect(names).toContain("index.html");
    expect(names).toContain("m3-bun.manifest.json");
    expect(names.some((n) => /^chunk-[a-z0-9]{8}\.js$/.test(n))).toBe(true);
    expect(names.some((n) => /^chunk-[a-z0-9]{8}\.css$/.test(n))).toBe(true);
    expect(existsSync(join(report.outdir, "src"))).toBe(false);

    const html = readFileSync(join(report.outdir, "index.html"), "utf8");
    expect(html).toContain('href="./chunk-');
    expect(html).toContain('src="./chunk-');
    expect(html).not.toContain("../");
  });

  test("the manifest lists every file with true sizes and hashes, and a build id derived from them", async () => {
    const dir = fixtureCopy();
    const report = await buildApp({ dir });
    const manifest = readManifest(report.outdir)!;
    expect(manifest.schema).toBe("m3-bun.manifest/1");
    expect(manifest).toMatchObject({
      name: "hello-m3",
      version: "1.2.3",
      minify: "full",
      entry: "index.html",
      bun: Bun.version,
    });
    expect(manifest.files.map((f) => f.path)).toEqual(
      readdirSync(report.outdir)
        .filter((n) => n !== "m3-bun.manifest.json")
        .toSorted(),
    );
    for (const file of manifest.files) {
      const bytes = new Uint8Array(readFileSync(join(report.outdir, file.path)));
      expect(file.bytes).toBe(bytes.length);
      expect(file.sha256).toBe(sha256(bytes));
      expect(file.gzipBytes).toBe(Bun.gzipSync(bytes).length);
      expect(file.zstdBytes).toBe(Bun.zstdCompressSync(bytes).length);
    }
    expect(report.totalZstdBytes).toBe(manifest.files.reduce((n, f) => n + f.zstdBytes, 0));
    expect(report.memory.heapSize).toBeGreaterThan(0);
    expect(report.memory.objectCount).toBeGreaterThan(0);
    expect(report.memory.peakRss).toBeGreaterThanOrEqual(report.memory.rss);
    expect(report.warnings).toEqual([]);
    expect(manifest.buildId).toBe(
      sha256(manifest.files.map((f) => `${f.path}:${f.sha256}`).join("\n")).slice(0, 16),
    );
    expect(await listBuild(report.outdir)).toEqual(manifest.files);
    expect(report.totalBytes).toBe(manifest.files.reduce((n, f) => n + f.bytes, 0));
  });

  test("the one plugin is in the build: theme sheet from the seed, the icon as an SVG string", async () => {
    const dir = fixtureCopy();
    const report = await buildApp({ dir });
    const css = readFileSync(
      join(report.outdir, report.manifest.files.find((f) => f.path.endsWith(".css"))!.path),
      "utf8",
    );
    expect(css).toContain("--md-sys-color-primary:#65558f");
    // The Rust token sheet's `@theme inline` twins are compiled by Tailwind, not left to Bun's CSS parser.
    expect(css).not.toContain("@theme");
    const js = readFileSync(
      join(report.outdir, report.manifest.files.find((f) => f.path.endsWith(".js"))!.path),
      "utf8",
    );
    expect(js).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(js).toContain("M240-200h120v-240h240v240h120v-360L480-740");
  });

  test("minify levels shrink the output; the same inputs give the same file contents", async () => {
    const none = await buildApp({ dir: fixtureCopy(), minify: "none" });
    const full = await buildApp({ dir: fixtureCopy(), minify: "full" });
    expect(full.totalBytes).toBeLessThan(none.totalBytes);
    expect(none.manifest.minify).toBe("none");
    const again = await buildApp({ dir: fixtureCopy(), minify: "full" });
    // Bun derives chunk file names in a way that differs between builds in one process, so compare contents.
    const contents = (r: typeof full) =>
      r.manifest.files
        .filter((f) => !f.path.endsWith(".html"))
        .map((f) => `${f.bytes}:${f.sha256}`)
        .toSorted();
    expect(contents(again)).toEqual(contents(full));
  });

  test("two builds in separate processes give the same build id: the build is reproducible", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const dir = fixtureCopy();
      const proc = Bun.spawnSync(
        ["bun", join(import.meta.dir, "../bin/m3-bun.ts"), "build", "--json"],
        { windowsHide: true, cwd: dir, stdout: "pipe", stderr: "pipe" },
      );
      expect(proc.exitCode).toBe(0);
      ids.push(
        (JSON.parse(proc.stdout.toString()) as { manifest: { buildId: string } }).manifest.buildId,
      );
    }
    expect(ids[0]).toBe(ids[1]!);
    expect(ids[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a rebuild replaces the output directory instead of accumulating files", async () => {
    const dir = fixtureCopy();
    const first = await buildApp({ dir });
    await Bun.write(join(first.outdir, "stale.txt"), "old");
    const second = await buildApp({ dir });
    expect(existsSync(join(second.outdir, "stale.txt"))).toBe(false);
  });
});
