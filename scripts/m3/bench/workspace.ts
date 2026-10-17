// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable eslint/no-await-in-loop -- bundles are measured one at a time */
// Workspace discovery and per-package bundle measurement for the benchmark harness.
import { Glob } from "bun";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface Manifest {
  name: string;
  version?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  scripts?: Record<string, string>;
}

export interface WorkspacePackage {
  /** Directory name, used in metric keys (`m3-ai`). */
  id: string;
  /** Relative directory (`packages/m3-ai`). */
  rel: string;
  dir: string;
  manifest: Manifest;
}

/** The packages named by the root `workspaces.packages` globs minus their `!` exclusions. */
export function workspacePackages(root: string): WorkspacePackage[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    workspaces?: { packages?: string[] } | string[];
  };
  const globs = Array.isArray(manifest.workspaces) ? manifest.workspaces : (manifest.workspaces?.packages ?? []);
  const excluded = new Set(globs.filter(g => g.startsWith("!")).map(g => g.slice(1)));
  const out: WorkspacePackage[] = [];
  for (const glob of globs.filter(g => !g.startsWith("!"))) {
    const base = glob.replace(/\/\*$/, "");
    if (!existsSync(join(root, base))) continue;
    for (const name of readdirSync(join(root, base)).toSorted()) {
      const rel = `${base}/${name}`;
      const file = join(root, rel, "package.json");
      if (excluded.has(rel) || !existsSync(file)) continue;
      out.push({
        id: basename(rel),
        rel,
        dir: join(root, rel),
        manifest: JSON.parse(readFileSync(file, "utf8")) as Manifest,
      });
    }
  }
  return out;
}

const JS = /\.(?:[cm]?[jt]sx?)$/;
const SKIP = /\.d\.[cm]?ts$|\.(?:test|spec|stories)\.[jt]sx?$/;

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

/** The JS/TS/CSS files a consumer can import from a package: one per `exports` entry (`types` skipped, `*` expanded). */
export function packageEntries(dir: string, manifest: Manifest): string[] {
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
  return [...files].filter(f => (JS.test(f) && !SKIP.test(f)) || f.endsWith(".css")).toSorted();
}

export interface BundleSize {
  entries: number;
  jsBytes: number;
  gzipBytes: number;
  cssBytes: number;
  ms: number;
  error?: string;
}

/** Bundle every export entry of a package the way a consumer would: browser, ESM, split, minified, bare imports external. */
export async function bundlePackage(pkg: WorkspacePackage): Promise<BundleSize> {
  const entries = packageEntries(pkg.dir, pkg.manifest);
  const size: BundleSize = {
    entries: entries.length,
    jsBytes: 0,
    gzipBytes: 0,
    cssBytes: 0,
    ms: 0,
  };
  if (entries.length === 0) return size;
  const started = performance.now();
  try {
    const result = await Bun.build({
      entrypoints: entries,
      root: pkg.dir,
      target: "browser",
      format: "esm",
      splitting: true,
      minify: true,
      packages: "external",
      define: { "process.env.NODE_ENV": '"production"' },
      throw: false,
    });
    if (!result.success) size.error = result.logs.slice(0, 2).map(String).join(" | ").slice(0, 300);
    for (const output of result.outputs) {
      if (output.kind === "sourcemap") continue;
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
  size.ms = performance.now() - started;
  return size;
}
