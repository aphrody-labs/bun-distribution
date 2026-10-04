#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// bundle-size.ts: what each workspace package and app weighs once bundled, measured with Bun.build.
//
//   bun scripts/bundle-size.ts [--out snapshot.json] [--only name,..] [--apps] [--root <checkout>]
//   bun scripts/bundle-size.ts --report before.json after.json [--exclude name,..]   # markdown on stdout
//
// A package is measured two ways. `js`/`gzip`/`css`: the way a consumer bundles it, every JS/TS/CSS export entry
// that is not under `dist/` (resolved with the `bun`, `import`, `browser`, `default` conditions, `types` skipped,
// `./*` patterns expanded), browser target, minified, bare imports left external (`packages: "external"`), so the
// number is the package's own code. `dist`: what the package ships, the `.js` files under `dist/` as emitted
// (not minified, no maps or declarations). Apps are measured through their own build script.
import { Glob } from "bun";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { REPO, workspacePackages } from "./lib/workspace.ts";
const JS = /\.(?:[cm]?[jt]sx?)$/;
const SKIP = /\.d\.[cm]?ts$|\.(?:test|spec|stories)\.[jt]sx?$/;

export interface PackageSize {
  entries: number;
  jsBytes: number;
  gzipBytes: number;
  cssBytes: number;
  /** Shipped `dist/*.js`, as emitted. */
  distFiles: number;
  distBytes: number;
  distGzipBytes: number;
  buildMs: number;
  error?: string;
}

export interface Snapshot {
  bun: string;
  date: string;
  packages: Record<string, PackageSize>;
  apps: Record<
    string,
    { files: number; bytes: number; gzipBytes: number; buildMs: number; error?: string }
  >;
}

function pick(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    for (const key of ["bun", "import", "browser", "default"]) {
      if (key in value) {
        const found = pick((value as Record<string, unknown>)[key]);
        if (found) return found;
      }
    }
  }
  return undefined;
}

/** The measurable entry files of a package, absolute. */
export function packageEntries(
  dir: string,
  manifest: { main?: string; module?: string; exports?: unknown },
): string[] {
  const targets = new Set<string>();
  const exp = manifest.exports;
  if (exp && typeof exp === "object" && !Array.isArray(exp)) {
    for (const [key, value] of Object.entries(exp as Record<string, unknown>)) {
      if (!key.startsWith(".")) continue;
      const target = pick(value);
      if (target) targets.add(target);
    }
  } else if (typeof exp === "string") targets.add(exp);
  else if (manifest.module ?? manifest.main) targets.add((manifest.module ?? manifest.main)!);
  const files = new Set<string>();
  for (const target of targets) {
    if (target.startsWith("./dist/")) {
      // An export that only points at `dist/x.js`: measure the source it is built from.
      const rel = target.slice("./dist/".length).replace(/\.js$/, "");
      const source = ["src/", ""]
        .flatMap((base) => [".ts", ".tsx"].map((ext) => join(dir, `${base}${rel}${ext}`)))
        .find((c) => existsSync(c));
      if (source) files.add(source);
      continue;
    }
    if (target.includes("*")) {
      for (const match of new Glob(target.replace(/^\.\//, "")).scanSync({
        cwd: dir,
        onlyFiles: true,
      }))
        files.add(join(dir, match));
      continue;
    }
    const file = resolve(dir, target);
    if (existsSync(file) && statSync(file).isFile()) files.add(file);
  }
  return [...files].filter((f) => (JS.test(f) && !SKIP.test(f)) || f.endsWith(".css")).toSorted();
}

/** The shipped build output: `.js` files under `dist/`. */
export function measureDist(
  dir: string,
): Pick<PackageSize, "distFiles" | "distBytes" | "distGzipBytes"> {
  const out = { distFiles: 0, distBytes: 0, distGzipBytes: 0 };
  const dist = join(dir, "dist");
  if (!existsSync(dist)) return out;
  for (const file of new Glob("**/*.js").scanSync({ cwd: dist, onlyFiles: true })) {
    const bytes = new Uint8Array(readFileSync(join(dist, file)));
    out.distFiles++;
    out.distBytes += bytes.length;
    out.distGzipBytes += Bun.gzipSync(bytes).length;
  }
  return out;
}

async function measurePackage(
  dir: string,
  manifest: { main?: string; module?: string; exports?: unknown },
): Promise<PackageSize> {
  const entries = packageEntries(dir, manifest);
  const size: PackageSize = {
    entries: entries.length,
    jsBytes: 0,
    gzipBytes: 0,
    cssBytes: 0,
    ...measureDist(dir),
    buildMs: 0,
  };
  if (entries.length === 0) return size;
  const started = performance.now();
  try {
    const result = await Bun.build({
      entrypoints: entries,
      root: dir,
      target: "browser",
      format: "esm",
      splitting: true,
      minify: true,
      packages: "external",
      define: { "process.env.NODE_ENV": '"production"' },
      throw: false,
    });
    if (!result.success) {
      size.error = result.logs.slice(0, 2).map(String).join(" | ").slice(0, 300);
    }
    for (const output of result.outputs) {
      if (output.kind === "sourcemap") continue;
      // Read one emitted artifact at a time to bound memory while measuring bundles.
      // oxlint-disable-next-line no-await-in-loop
      const bytes = new Uint8Array(await output.arrayBuffer());
      if (output.path.endsWith(".css")) size.cssBytes += bytes.length;
      else if (output.path.endsWith(".js")) {
        size.jsBytes += bytes.length;
        size.gzipBytes += Bun.gzipSync(bytes).length;
      }
    }
  } catch (error) {
    size.error = String((error as Error).message ?? error).slice(0, 300);
  }
  size.buildMs = Math.round(performance.now() - started);
  return size;
}

async function measureApp(dir: string) {
  const started = performance.now();
  const proc = Bun.spawnSync(["bun", "run", "build"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const outdir = join(dir, "dist");
  const out = {
    files: 0,
    bytes: 0,
    gzipBytes: 0,
    buildMs: Math.round(performance.now() - started),
  } as Snapshot["apps"][string];
  if (proc.exitCode !== 0) {
    out.error = proc.stderr.toString().slice(0, 300);
    return out;
  }
  for (const file of new Glob("**/*").scanSync({ cwd: outdir, onlyFiles: true })) {
    if (file.endsWith(".map")) continue;
    const bytes = new Uint8Array(readFileSync(join(outdir, file)));
    out.files++;
    out.bytes += bytes.length;
    out.gzipBytes += Bun.gzipSync(bytes).length;
  }
  return out;
}

const kb = (n: number) => (n / 1024).toFixed(1);
const delta = (before: number | undefined, after: number | undefined) => {
  if (before === undefined || after === undefined) return "n/a";
  if (before === 0) return after === 0 ? "0" : "new";
  const pct = ((after - before) / before) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
};

/** Markdown comparison of two snapshots. */
export function renderReport(
  before: Snapshot,
  after: Snapshot,
  exclude: readonly string[] = [],
): string {
  const names = [
    ...new Set([...Object.keys(before.packages), ...Object.keys(after.packages)]),
  ].toSorted();
  const rows = names.map((name) => {
    const b = before.packages[name]?.error ? undefined : before.packages[name];
    const a = after.packages[name]?.error ? undefined : after.packages[name];
    return `| ${name} | ${a?.entries ?? b?.entries ?? 0} | ${b ? kb(b.jsBytes) : "-"} | ${a ? kb(a.jsBytes) : "-"} | ${delta(b?.jsBytes, a?.jsBytes)} | ${b ? kb(b.gzipBytes) : "-"} | ${a ? kb(a.gzipBytes) : "-"} | ${b ? kb(b.cssBytes) : "-"} | ${a ? kb(a.cssBytes) : "-"} | ${b?.distFiles ? kb(b.distBytes) : "-"} | ${a?.distFiles ? kb(a.distBytes) : "-"} | ${b?.distFiles && a?.distFiles ? delta(b.distBytes, a.distBytes) : "-"} |`;
  });
  const inScope = (s: Snapshot) =>
    Object.entries(s.packages).filter(
      ([name, p]) =>
        !p.error &&
        !exclude.includes(name) &&
        before.packages[name] &&
        !before.packages[name]!.error &&
        after.packages[name] &&
        !after.packages[name]!.error,
    );
  const sum = (s: Snapshot, key: "jsBytes" | "gzipBytes" | "cssBytes" | "distBytes") =>
    inScope(s).reduce((n, [, p]) => n + p[key], 0);
  const apps = [...new Set([...Object.keys(before.apps), ...Object.keys(after.apps)])]
    .toSorted()
    .map((name) => {
      const b = before.apps[name];
      const a = after.apps[name];
      return `| ${name} | ${b ? `${kb(b.bytes)} (${b.files} files)` : "-"} | ${a ? `${kb(a.bytes)} (${a.files} files)` : "-"} | ${delta(b?.bytes, a?.bytes)} | ${b ? kb(b.gzipBytes) : "-"} | ${a ? kb(a.gzipBytes) : "-"} |`;
    });
  return [
    `Measured with Bun ${after.bun} (before: ${before.bun}), \`Bun.build\`, browser target, minified, bare imports external. KiB.`,
    "",
    "| package | entries | JS before | JS after | delta | gzip before | gzip after | CSS before | CSS after | dist before | dist after | delta |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    `| **total (packages measured in both, excluding ${exclude.length} concurrent)** | | ${kb(sum(before, "jsBytes"))} | ${kb(sum(after, "jsBytes"))} | ${delta(sum(before, "jsBytes"), sum(after, "jsBytes"))} | ${kb(sum(before, "gzipBytes"))} | ${kb(sum(after, "gzipBytes"))} | ${kb(sum(before, "cssBytes"))} | ${kb(sum(after, "cssBytes"))} | ${kb(sum(before, "distBytes"))} | ${kb(sum(after, "distBytes"))} | ${delta(sum(before, "distBytes"), sum(after, "distBytes"))} |`,
    "",
    "| app (`m3 build`, production) | before | after | delta | gzip before | gzip after |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...apps,
  ].join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  if (args.includes("--report")) {
    const [beforeFile, afterFile] = args.slice(args.indexOf("--report") + 1);
    const before = JSON.parse(readFileSync(resolve(beforeFile!), "utf8")) as Snapshot;
    const after = JSON.parse(readFileSync(resolve(afterFile!), "utf8")) as Snapshot;
    console.log(renderReport(before, after, flag("--exclude")?.split(",") ?? []));
    process.exit(0);
  }
  const root = resolve(flag("--root") ?? REPO);
  const only = flag("--only")?.split(",");
  const snapshot: Snapshot = {
    bun: Bun.version,
    date: new Date().toISOString().slice(0, 10),
    packages: {},
    apps: {},
  };
  for (const { name, dir, manifest } of workspacePackages(root)) {
    if (!name.startsWith("@aphrody/") && only === undefined) continue;
    if (only && !only.includes(name) && !only.includes(relative(REPO, dir))) continue;
    // Keep benchmark jobs serial so concurrent builds do not distort sizes or resource measurements.
    // oxlint-disable-next-line no-await-in-loop
    snapshot.packages[name] = await measurePackage(dir, manifest);
  }
  if (args.includes("--apps") || only === undefined) {
    const appsDir = join(root, "apps");
    if (existsSync(appsDir))
      for (const name of readdirSync(appsDir).toSorted()) {
        if (!existsSync(join(appsDir, name, "package.json"))) continue;
        const manifest = JSON.parse(readFileSync(join(appsDir, name, "package.json"), "utf8")) as {
          name: string;
          scripts?: Record<string, string>;
        };
        if (manifest.scripts?.build) {
          // Each app measurement owns its build outputs and completes before the next app starts.
          // oxlint-disable-next-line no-await-in-loop
          snapshot.apps[manifest.name] = await measureApp(join(appsDir, name));
        }
      }
  }
  const out = flag("--out");
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (out) await Bun.write(resolve(out), text);
  else process.stdout.write(text);
  const failed = Object.entries(snapshot.packages).filter(([, p]) => p.error);
  for (const [name, p] of failed) console.error(`bundle-size: ${name}: ${p.error}`);
}
