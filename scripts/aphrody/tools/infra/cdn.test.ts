// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type Catalog, contentType, hashedName, loadCatalog, scan } from "./cdn.ts";

async function checkout(root: string, files: Record<string, string>) {
  for (const [path, body] of Object.entries(files)) await Bun.write(join(root, path), body);
  await $`git -C ${root} init -q && git -C ${root} add -A`.quiet();
}

// Every test spawns git (fixture checkouts, `git ls-files` of the active monorepo) and
// hashes real assets; on a loaded Windows host that exceeds bun's 5 s default.
const GIT_TIMEOUT_MS = 60_000;

const catalog = (sources: Catalog["sources"]): Catalog => ({
  schemaVersion: 1,
  cdn: {
    service: "cdn",
    host: "cdn.test",
    releaseRoot: "/home/ubuntu/apps/cdn",
    paths: { scoped: "/s/", hashed: "/h/", manifest: "/s/manifest.json" },
    hashLength: 16,
  },
  sources,
});

describe("asset CDN", () => {
  test(
    "one owner per content across sources",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "cdn-"));
      try {
        await checkout(root, {
          "a/assets/logo.png": "LOGO",
          "a/assets/art.psd": "PSD",
          "b/assets/copy/logo.png": "LOGO",
          "b/assets/own.svg": "<svg/>",
        });
        const sources = [
          { scope: "a", path: "a/assets", exclude: ["**/*.psd"] },
          { scope: "b", path: "b/assets", exclude: [] },
        ];
        const { entries, problems } = await scan(catalog(sources), root);
        expect(entries.map(e => `${e.scope}:${e.path}`)).toEqual(["a:logo.png", "b:copy/logo.png", "b:own.svg"]);
        expect(problems.map(p => p.kind)).toEqual(["cross-source-duplicate"]);

        const missing = await scan(catalog([...sources, { scope: "c", path: "nope/assets", exclude: [] }]), root);
        expect(missing.problems.some(p => p.kind === "missing-source")).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    GIT_TIMEOUT_MS,
  );

  test(
    "build writes scoped, hashed and manifest trees",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "cdn-"));
      try {
        await checkout(root, {
          "assets/fonts/x.ttf": "FONT",
          "assets/ui/y.webp": "IMG",
        });
        const cat = catalog([
          { scope: "os", path: "assets/ui", exclude: [] },
          {
            scope: "os",
            path: "assets/fonts",
            mount: "fonts",
            exclude: [],
          },
        ]);
        const { entries } = await scan(cat, root);
        const out = join(root, "out");
        const manifest = await build(cat, entries, out);
        expect(Object.keys(manifest.files).toSorted()).toEqual(["os/fonts/x.ttf", "os/y.webp"]);
        expect(await Bun.file(join(out, "s/os/fonts/x.ttf")).text()).toBe("FONT");
        const hashed = manifest.files["os/y.webp"]!.hashed;
        expect(hashed).toBe(
          `/h/${hashedName(
            entries.find(e => e.path === "y.webp")!,
            16,
          )}`,
        );
        expect(await Bun.file(join(out, hashed)).text()).toBe("IMG");
        expect((await readdir(join(out, "h"))).length).toBe(2);
        expect(await Bun.file(join(out, "RELEASE_SHA")).exists()).toBe(true);
        expect(contentType("a/b.woff2")).toBe("font/woff2");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    GIT_TIMEOUT_MS,
  );

  test(
    "the real catalog is clean",
    async () => {
      const cat = await loadCatalog();
      const { entries, problems } = await scan(cat);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some(entry => entry.path.startsWith("fonts/"))).toBe(true);
      expect(problems).toEqual([]);
    },
    GIT_TIMEOUT_MS,
  );
});
