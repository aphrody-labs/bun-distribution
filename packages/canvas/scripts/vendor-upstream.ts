// SPDX-License-Identifier: MIT
// Sync or verify every file @aphrody/canvas copies from another tree, so the published package
// is self-contained (nothing outside `packages/canvas` is imported at runtime or type-check time):
//
//   vendor/                  upstream @napi-rs/canvas JS loader + typings + LICENSE, from the
//                            `third_party/canvas` submodule (never patched: README "Upstream")
//   vendor/UPSTREAM.md       provenance: upstream commit, version, license, SHA-256 per file
//   scene-types.d.ts         runtime-free M3 scene wire types, from `packages/bun/src/scene-types.ts`
//   optionalDependencies     the upstream prebuilt Skia platform packages, at the vendored version
//
//   bun scripts/vendor-upstream.ts          rewrite the copies from their sources
//   bun scripts/vendor-upstream.ts --check  exit 1 on drift (the `prepack` gate; vendor.test.ts)
//
// Copies are byte-identical to their sources after line-ending normalization to LF.

import { readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const PACKAGE_DIR = resolve(import.meta.dir, "..");
export const REPO_DIR = resolve(PACKAGE_DIR, "../../..");
export const UPSTREAM_DIR = join(REPO_DIR, "third_party", "canvas");
export const SCENE_TYPES_SOURCE = join(REPO_DIR, "packages", "interop", "native", "src", "scene-types.ts");
export const UPSTREAM_REPOSITORY = "https://github.com/Brooooooklyn/canvas";
export const UPSTREAM_PACKAGE = "@napi-rs/canvas";

/**
 * Upstream files loaded by the facade root entry (`index.js` requires the three others) plus the
 * typings and the license. `node-canvas.*` (node-canvas compatibility layer) is not exposed.
 */
export const VENDORED_FILES = [
  "index.js",
  "js-binding.js",
  "geometry.js",
  "load-image.js",
  "index.d.ts",
  "LICENSE",
] as const;

/** Upstream JS is CommonJS; the facade package is `"type": "module"`. */
export const VENDOR_MANIFEST = `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`;

export interface UpstreamSnapshot {
  commit: string;
  version: string;
  license: string;
  /** Vendored file name -> LF-normalized content. */
  files: Map<string, string>;
  /** `@napi-rs/canvas-<platform>` packages published by upstream (`npm/*`), sorted. */
  platformPackages: string[];
}

export interface Drift {
  path: string;
  reason: string;
}

export function normalizeEol(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

export async function upstreamCheckedOut(): Promise<boolean> {
  return Bun.file(join(UPSTREAM_DIR, "package.json")).exists();
}

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

export async function readUpstream(): Promise<UpstreamSnapshot> {
  if (!(await upstreamCheckedOut())) {
    throw new Error("third_party/canvas is not checked out: run `git submodule update --init third_party/canvas`");
  }
  const manifest = await Bun.file(join(UPSTREAM_DIR, "package.json")).json();
  if (manifest.name !== UPSTREAM_PACKAGE) {
    throw new Error(`third_party/canvas is ${manifest.name}, expected ${UPSTREAM_PACKAGE}`);
  }
  const files = new Map<string, string>();
  const vendoredTexts = await Promise.all(VENDORED_FILES.map(name => Bun.file(join(UPSTREAM_DIR, name)).text()));
  for (const [index, name] of VENDORED_FILES.entries()) {
    files.set(name, normalizeEol(vendoredTexts[index]));
  }
  const platformDirs = await readdir(join(UPSTREAM_DIR, "npm"), {
    withFileTypes: true,
  });
  const platformPackages = await Promise.all(
    platformDirs
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const platform = await Bun.file(join(UPSTREAM_DIR, "npm", entry.name, "package.json")).json();
        return String(platform.name);
      }),
  );
  return {
    commit: git(UPSTREAM_DIR, "rev-parse", "HEAD"),
    version: String(manifest.version),
    license: String(manifest.license),
    files,
    platformPackages: platformPackages.toSorted(),
  };
}

/** Verify an absorbed upstream against its immutable npm release, without restoring a checkout. */
export async function verifyRegistryCopies(): Promise<Drift[]> {
  const record = await Bun.file(join(PACKAGE_DIR, "vendor/UPSTREAM.md")).text();
  const version = /`@napi-rs\/canvas@([^`]+)`/.exec(record)?.[1];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("invalid recorded upstream version");
  const response = await fetch(`https://registry.npmjs.org/@napi-rs%2fcanvas/${version}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`upstream metadata: HTTP ${response.status}`);
  const metadata = (await response.json()) as {
    dist: { tarball: string; integrity: string };
  };
  if (!metadata.dist.tarball.startsWith("https://registry.npmjs.org/"))
    throw new Error("unexpected upstream tarball origin");
  const download = await fetch(metadata.dist.tarball, {
    signal: AbortSignal.timeout(30000),
  });
  if (!download.ok) throw new Error(`upstream tarball: HTTP ${download.status}`);
  const bytes = await download.arrayBuffer();
  const integrity = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
  if (integrity !== metadata.dist.integrity) throw new Error("upstream tarball integrity mismatch");
  const dir = await mkdtemp(join(tmpdir(), "aphrody-canvas-upstream-"));
  try {
    const tarball = join(dir, "upstream.tgz");
    await Bun.write(tarball, bytes);
    const drift: Drift[] = [];
    const hashes = parseRecordedHashes(record);
    const extracted = VENDORED_FILES.map(name => {
      const result = Bun.spawnSync(["tar", "-xOf", tarball, `package/${name}`], {
        windowsHide: true,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (result.exitCode !== 0) throw new Error(`upstream file missing: ${name}`);
      return { name, expected: normalizeEol(result.stdout.toString()) };
    });
    const actuals = await Promise.all(extracted.map(({ name }) => readText(`vendor/${name}`)));
    for (const [index, { name, expected }] of extracted.entries()) {
      if (sha256(expected) !== hashes.get(name))
        drift.push({
          path: `vendor/${name}`,
          reason: "recorded hash differs from immutable npm upstream",
        });
      if (actuals[index] !== expected)
        drift.push({
          path: `vendor/${name}`,
          reason: "differs from immutable npm upstream",
        });
    }
    if ((await readText("scene-types.d.ts")) !== normalizeEol(await Bun.file(SCENE_TYPES_SOURCE).text()))
      drift.push({
        path: "scene-types.d.ts",
        reason: "differs from the native owner",
      });
    if ((await readText("vendor/package.json")) !== VENDOR_MANIFEST)
      drift.push({
        path: "vendor/package.json",
        reason: "incorrect CommonJS boundary",
      });
    return drift;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function renderUpstreamRecord(upstream: UpstreamSnapshot): string {
  const rows = [...upstream.files].map(([name, text]) => `| \`${name}\` | \`${sha256(text)}\` |`);
  return [
    "# Upstream provenance",
    "",
    "Generated by `bun scripts/vendor-upstream.ts`; do not edit. The `prepack` gate",
    "(`--check`) and `vendor.test.ts` fail when these copies drift from `third_party/canvas`.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Upstream | ${UPSTREAM_REPOSITORY} |`,
    `| Commit | \`${upstream.commit}\` |`,
    `| Package | \`${UPSTREAM_PACKAGE}@${upstream.version}\` |`,
    `| License | ${upstream.license}, copyright notice in [\`LICENSE\`](LICENSE) |`,
    `| Native addon | \`${UPSTREAM_PACKAGE}-<platform>@${upstream.version}\` (\`optionalDependencies\`), \`NAPI_RS_NATIVE_LIBRARY_PATH\`, or \`vendor/skia.<platform>.node\` |`,
    "",
    "Each file is byte-identical to upstream after line-ending normalization (LF):",
    "",
    "| File | SHA-256 |",
    "| --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** `| \`name\` | \`sha\` |` rows of `vendor/UPSTREAM.md`. */
export function parseRecordedHashes(record: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const match of record.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)) {
    hashes.set(match[1] as string, match[2] as string);
  }
  return hashes;
}

export function expectedOptionalDependencies(upstream: UpstreamSnapshot): Record<string, string> {
  return Object.fromEntries(upstream.platformPackages.map(name => [name, upstream.version]));
}

/** Every generated file, keyed by its path relative to the package. */
export async function expectedFiles(upstream: UpstreamSnapshot): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const [name, text] of upstream.files) files.set(`vendor/${name}`, text);
  files.set("vendor/package.json", VENDOR_MANIFEST);
  files.set("vendor/UPSTREAM.md", renderUpstreamRecord(upstream));
  files.set("scene-types.d.ts", normalizeEol(await Bun.file(SCENE_TYPES_SOURCE).text()));
  return files;
}

async function readText(path: string): Promise<string | undefined> {
  const file = Bun.file(join(PACKAGE_DIR, path));
  return (await file.exists()) ? normalizeEol(await file.text()) : undefined;
}

export async function findDrift(upstream: UpstreamSnapshot): Promise<Drift[]> {
  const drift: Drift[] = [];
  const entries = [...(await expectedFiles(upstream))];
  const actuals = await Promise.all(entries.map(([path]) => readText(path)));
  for (const [index, [path, expected]] of entries.entries()) {
    const actual = actuals[index];
    if (actual === undefined) drift.push({ path, reason: "missing" });
    else if (actual !== expected) drift.push({ path, reason: "differs from its source" });
  }
  const manifest = await Bun.file(join(PACKAGE_DIR, "package.json")).json();
  const expectedOptional = expectedOptionalDependencies(upstream);
  if (JSON.stringify(manifest.optionalDependencies ?? {}) !== JSON.stringify(expectedOptional)) {
    drift.push({
      path: "package.json",
      reason: `optionalDependencies must be ${JSON.stringify(expectedOptional)}`,
    });
  }
  return drift;
}

export async function writeCopies(upstream: UpstreamSnapshot): Promise<string[]> {
  const written: string[] = [];
  const entries = [...(await expectedFiles(upstream))];
  const changed = await Promise.all(
    entries.map(async ([path, expected]) => {
      if ((await readText(path)) === expected) return undefined;
      await Bun.write(join(PACKAGE_DIR, path), expected);
      return path;
    }),
  );
  written.push(...changed.filter((path): path is string => path !== undefined));
  const manifestFile = Bun.file(join(PACKAGE_DIR, "package.json"));
  const manifest = await manifestFile.json();
  const expectedOptional = expectedOptionalDependencies(upstream);
  if (JSON.stringify(manifest.optionalDependencies ?? {}) !== JSON.stringify(expectedOptional)) {
    manifest.optionalDependencies = expectedOptional;
    await Bun.write(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    written.push("package.json");
  }
  return written;
}

if (import.meta.main) {
  if (Bun.argv.includes("--check") && !(await upstreamCheckedOut())) {
    const drift = await verifyRegistryCopies();
    for (const { path, reason } of drift) console.error(`drift  ${path}: ${reason}`);
    console.log(`@aphrody/canvas immutable npm provenance: ${drift.length} drift(s)`);
    process.exit(drift.length === 0 ? 0 : 1);
  }
  const upstream = await readUpstream().catch((error: unknown) => {
    console.error(`@aphrody/canvas: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
  const label = `${UPSTREAM_PACKAGE}@${upstream.version} (${upstream.commit.slice(0, 7)})`;
  if (Bun.argv.includes("--check")) {
    const drift = await findDrift(upstream);
    for (const { path, reason } of drift) console.error(`drift  ${path}: ${reason}`);
    console.log(
      drift.length === 0
        ? `@aphrody/canvas copies match ${label}`
        : `${drift.length} drift(s): run \`bun scripts/vendor-upstream.ts\``,
    );
    process.exit(drift.length === 0 ? 0 : 1);
  }
  const written = await writeCopies(upstream);
  for (const path of written) console.log(`wrote  ${path}`);
  console.log(`@aphrody/canvas synced with ${label}: ${written.length} file(s) updated`);
}
