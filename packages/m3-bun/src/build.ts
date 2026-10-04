// SPDX-License-Identifier: Apache-2.0
// `m3-bun build`: the production build of an M3 app. It is `buildM3` of `@aphrody/m3` (one `Bun.build`) with the
// one m3-bun plugin, then a layout a file server and every deploy target can use as is:
//   dist/index.html            the entry, hoisted to the root with its asset references rewritten
//   dist/chunk-<hash>.{js,css} content-hashed assets (immutable caching)
//   dist/m3-bun.manifest.json  files, sizes, gzip sizes, SHA-256 and a build id derived from them
import { buildM3, type BuildM3Options } from "@aphrody/m3";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { loadApp, type M3App } from "./config.ts";
import { m3Bun } from "./plugin.ts";
import { sha256 } from "./util.ts";

export type MinifyLevel = "none" | "basic" | "full";

/** `Bun.build` minify options of a level: `basic` is whitespace and syntax, `full` adds identifiers. */
export function minifyOptions(level: MinifyLevel): NonNullable<BuildM3Options["minify"]> {
  if (level === "none") return false;
  return { whitespace: true, syntax: true, identifiers: level === "full" };
}

export interface BuildFile {
  /** Path relative to the build directory, `/`-separated. */
  path: string;
  bytes: number;
  gzipBytes: number;
  sha256: string;
}

export interface BuildManifest {
  schema: "m3-bun.manifest/1";
  name: string;
  version: string;
  bun: string;
  minify: MinifyLevel;
  /** Hash of the file hashes: the identity of this build, reproducible for the same inputs. */
  buildId: string;
  entry: "index.html";
  files: BuildFile[];
}

export interface BuildReport {
  app: M3App;
  outdir: string;
  manifest: BuildManifest;
  totalBytes: number;
  totalGzipBytes: number;
  ms: number;
}

/**
 * Move the HTML entry that `Bun.build` placed at `<depth dirs>/index.html` to the build root and strip the
 * `../` the entry used to reach its siblings. `depth` is the number of directories the entry sat in.
 */
export function hoistHtml(html: string, depth: number): string {
  if (depth === 0) return html;
  return html.replace(/((?:src|href)=["'])((?:\.\.\/)+)/g, (_match, prefix: string, ups: string) => {
    const remaining = ups.length / 3 - depth;
    return `${prefix}${remaining > 0 ? "../".repeat(remaining) : "./"}`;
  });
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(relative(base, full).replaceAll("\\", "/"));
  }
  return out.toSorted();
}

/** Every file of a build directory with sizes and hashes; `manifestName` itself is not listed. */
export async function listBuild(outdir: string, manifestName = "m3-bun.manifest.json"): Promise<BuildFile[]> {
  const files: BuildFile[] = [];
  for (const path of await walk(outdir)) {
    if (path === manifestName || path.endsWith(".map")) continue;
    const bytes = new Uint8Array(await Bun.file(join(outdir, path)).arrayBuffer());
    files.push({ path, bytes: bytes.length, gzipBytes: Bun.gzipSync(bytes).length, sha256: sha256(bytes) });
  }
  return files;
}

export interface BuildAppOptions {
  /** App directory (default: the working directory). */
  dir?: string;
  /** `m3.config.ts` path, relative to `dir`. */
  configFile?: string;
  minify?: MinifyLevel;
  /** Development build: no `NODE_ENV=production`, linked sourcemaps. */
  dev?: boolean;
  /** Override the output directory. */
  outdir?: string;
  /** A pre-loaded app, for callers that already read the config. */
  app?: M3App;
}

/** Build the UI of an M3 app into its output directory. */
export async function buildApp(options: BuildAppOptions = {}): Promise<BuildReport> {
  const started = performance.now();
  const app = options.app ?? (await loadApp(resolve(options.dir ?? process.cwd()), options.configFile));
  const outdir = resolve(options.outdir ?? app.outdir);
  const minify = options.minify ?? app.minify;
  const { m3 } = app;

  await buildM3({
    entry: m3.entry,
    outdir,
    production: options.dev !== true,
    minify: minifyOptions(minify),
    ...(m3.define ? { define: m3.define } : {}),
    ...(m3.drop ? { drop: m3.drop } : {}),
    ...(m3.optimizeImports ? { optimizeImports: m3.optimizeImports } : {}),
    plugin: false,
    plugins: [m3Bun({ ...(m3.theme ? { theme: m3.theme } : {}), ...(m3.root ? { root: m3.root } : {}), configDir: m3.dir })],
    cwd: m3.dir,
  });

  await hoistEntry(outdir, m3.dir, m3.entry);

  const files = await listBuild(outdir);
  const manifest: BuildManifest = {
    schema: "m3-bun.manifest/1",
    name: app.name,
    version: app.version,
    bun: Bun.version,
    minify,
    buildId: sha256(files.map((f) => `${f.path}:${f.sha256}`).join("\n")).slice(0, 16),
    entry: "index.html",
    files,
  };
  await Bun.write(join(outdir, "m3-bun.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    app,
    outdir,
    manifest,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    totalGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
    ms: Math.round(performance.now() - started),
  };
}

/** `Bun.build` keeps the HTML entry at its source-relative path (`src/index.html`): make it `index.html`. */
async function hoistEntry(outdir: string, appDir: string, entry: string): Promise<void> {
  const rel = relative(appDir, entry).replaceAll("\\", "/");
  const built = join(outdir, rel);
  if (!existsSync(built)) throw new Error(`m3-bun: the build produced no ${rel} in ${outdir}`);
  const depth = dirname(rel) === "." ? 0 : dirname(rel).split("/").length;
  const html = hoistHtml(readFileSync(built, "utf8"), depth);
  await Bun.write(join(outdir, "index.html"), html);
  if (basename(built) !== "index.html" || depth > 0) {
    await rm(built, { force: true });
    // Drop the now empty source-relative directories.
    for (let dir = dirname(built); dir !== outdir && dir.startsWith(outdir); dir = dirname(dir)) {
      if ((await readdir(dir)).length > 0) break;
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** The manifest of an existing build directory. */
export function readManifest(outdir: string): BuildManifest | undefined {
  const file = join(outdir, "m3-bun.manifest.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as BuildManifest) : undefined;
}
