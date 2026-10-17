import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aphrodyCanvasVersion } from "./site";
import {
  PACKAGE_DIR,
  UPSTREAM_PACKAGE,
  VENDORED_FILES,
  findDrift,
  normalizeEol,
  parseRecordedHashes,
  readUpstream,
  sha256,
  upstreamCheckedOut,
} from "./scripts/vendor-upstream";

const manifest = await Bun.file(join(PACKAGE_DIR, "package.json")).json();
const packDir = mkdtempSync(join(tmpdir(), "aphrody-canvas-pack-"));
afterAll(() => rmSync(packDir, { recursive: true, force: true }));
const archive = join(packDir, "canvas.tgz");
const pack = Bun.spawnSync(["bun", "pm", "pack", "--ignore-scripts", "--filename", archive], {
  windowsHide: true,
  cwd: PACKAGE_DIR,
  stdout: "pipe",
  stderr: "pipe",
});
if (pack.exitCode !== 0) throw new Error(pack.stderr.toString());
const packed = await new Bun.Archive(await Bun.file(archive).bytes()).files("package/package.json");
const publishManifest = JSON.parse(await packed.get("package/package.json")!.text());
const record = await Bun.file(join(PACKAGE_DIR, "vendor", "UPSTREAM.md")).text();
const hasUpstream = await upstreamCheckedOut();

describe("@aphrody/canvas vendored upstream", () => {
  test.skipIf(!hasUpstream)("copies match third_party/canvas and @aphrody/bun", async () => {
    expect(await findDrift(await readUpstream())).toEqual([]);
  });

  test("vendored files match the SHA-256 recorded in vendor/UPSTREAM.md", async () => {
    const hashes = parseRecordedHashes(record);
    expect([...hashes.keys()]).toEqual([...VENDORED_FILES]);
    await Promise.all(
      [...hashes].map(async ([name, hash]) => {
        const text = normalizeEol(await Bun.file(join(PACKAGE_DIR, "vendor", name)).text());
        expect({ name, hash: sha256(text) }).toEqual({ name, hash });
      }),
    );
  });

  test("platform packages pin the vendored upstream version", () => {
    const upstreamVersion = /`@napi-rs\/canvas@([^`]+)`/.exec(record)?.[1];
    expect(upstreamVersion).toBeDefined();
    const optional: Record<string, string> = publishManifest.optionalDependencies;
    expect(Object.keys(optional)).toContain(`${UPSTREAM_PACKAGE}-win32-x64-msvc`);
    expect(Object.keys(optional)).toContain(`${UPSTREAM_PACKAGE}-linux-x64-gnu`);
    for (const [name, version] of Object.entries(optional)) {
      expect({ name, version }).toEqual({
        name,
        version: upstreamVersion as string,
      });
    }
  });
});

describe("@aphrody/canvas publishable manifest", () => {
  test("version constants equal package.json", async () => {
    expect(aphrodyCanvasVersion).toBe(manifest.version);
    const declared = await Bun.file(join(PACKAGE_DIR, "site.d.ts")).text();
    expect(declared).toContain(`aphrodyCanvasVersion: "${manifest.version}"`);
  });

  test("index.d.ts re-declares the site contract verbatim", async () => {
    const site = normalizeEol(await Bun.file(join(PACKAGE_DIR, "site.d.ts")).text());
    const root = normalizeEol(await Bun.file(join(PACKAGE_DIR, "index.d.ts")).text());
    const missing = site.split("\n").filter(line => line.trim() && !root.includes(line));
    expect(missing).toEqual([]);
  });

  test("no workspace:, catalog:, file: or link: specifier reaches the registry", () => {
    const sections = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"] as const;
    const offenders = sections.flatMap(section =>
      Object.entries<string>(publishManifest[section] ?? {})
        .filter(([, spec]) => /^(workspace|catalog|file|link):/.test(spec))
        .map(([name, spec]) => `${section}.${name}=${spec}`),
    );
    expect(offenders).toEqual([]);
    expect(manifest.peerDependenciesMeta?.["@aphrody/bun"]?.optional).toBe(true);
  });

  test("files ship every module the entry points import", async () => {
    const files: string[] = manifest.files;
    for (const entry of ["index.ts", "index.d.ts", "site.ts", "site.d.ts", "scene-types.d.ts"]) {
      expect(files).toContain(entry);
    }
    for (const name of [...VENDORED_FILES, "package.json", "UPSTREAM.md"]) {
      expect(files).toContain(`vendor/${name}`);
    }
    const present = await Promise.all(files.map(file => Bun.file(join(PACKAGE_DIR, file)).exists()));
    for (const ok of present) expect(ok).toBe(true);
  });
});
