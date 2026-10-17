// SPDX-License-Identifier: Apache-2.0
/**
 * The one build preset of the first-party Material Design 3 packages, on `Bun.build`.
 *
 * Declarative, per package (`build.config.ts`):
 *
 *   import { m3Package } from "@aphrody/m3-config/bun-build";
 *   export default m3Package({ entry: ["src/index.ts", "src/react.tsx"], useClient: ["react.js"] });
 *
 * `scripts/build.ts` at the repository root reads every `build.config.ts`, builds the packages in dependency
 * order with a content-hash cache and emits the declarations. Imperative, for one-off use:
 *
 *   import { m3BunBuild } from "@aphrody/m3-config/bun-build";
 *   await m3BunBuild({ entry: ["src/index.ts"] });   // or: bun packages/m3-config/bun-build.ts --entry src/index.ts
 *
 * Provides native ESM bundling with code splitting, the React client directive (`'use client';`)
 * through `Bun.file` / `Bun.write`, external sourcemaps and the shared external list.
 */
import { Glob, type BuildArtifact, type BunPlugin } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const USE_CLIENT = "'use client';\n";

/** Everything the M3 packages never bundle: React, Lit, motion, Tailwind and the workspace scope. */
export const M3_EXTERNAL: string[] = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "lit",
  "lit/*",
  "@lit/*",
  "motion",
  "motion/*",
  "tailwindcss",
  "@aphrody/*",
];

export type M3Target = "browser" | "bun" | "node";

/** What a package declares in `build.config.ts`. Entry paths may be globs, relative to the package. */
export interface M3PackageConfig {
  /** Entrypoint(s). Default `["src/index.ts"]`. */
  entry?: string | readonly string[];
  /** Runtime target (default `browser`). */
  target?: M3Target;
  /** Code splitting across entries (default true). */
  splitting?: boolean;
  /** Packages left unbundled in addition to {@link M3_EXTERNAL} and the package's own dependencies and peers; wildcards allowed. */
  external?: readonly string[];
  /**
   * `true` (default) marks every emitted JS file with `'use client';`, a list limits that to the
   * named files (`react.js`, `shims/link.js`), `false` skips it (packages without React code).
   */
  useClient?: boolean | readonly string[];
}

/** Types a `build.config.ts`; the identity otherwise. */
export function m3Package(config: M3PackageConfig = {}): M3PackageConfig {
  return config;
}

export interface M3BunBuildOptions extends M3PackageConfig {
  /** Output directory. Defaults to `"dist"`. */
  outDir?: string;
  /** Module format: `"esm"` (default) or `"cjs"`. */
  format?: "esm" | "cjs";
  /** Sourcemap mode. Defaults to `"external"`. */
  sourcemap?: "external" | "inline" | "none";
  /** Minification. Defaults to false. */
  minify?: boolean | { whitespace?: boolean; syntax?: boolean; identifiers?: boolean };
  /** Additional Bun plugins. */
  plugins?: BunPlugin[];
  /** Compile-time constant defines. */
  define?: Record<string, string>;
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;
}

export interface M3BunBuildResult {
  success: boolean;
  outDir: string;
  outputs: BuildArtifact[];
  logs: string[];
}

/**
 * The packages a build leaves unbundled: {@link M3_EXTERNAL}, `node:*`, the `dependencies` and `peerDependencies` of the
 * package at `cwd` (consumers install them) and `extra`. Anything else a package imports is bundled in.
 */
export function externals(cwd: string, extra: readonly string[] = []): string[] {
  const manifest = join(cwd, "package.json");
  const names = new Set<string>();
  if (existsSync(manifest)) {
    const { dependencies, peerDependencies } = JSON.parse(readFileSync(manifest, "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const name of [...Object.keys(dependencies ?? {}), ...Object.keys(peerDependencies ?? {})]) {
      names.add(name);
      names.add(`${name}/*`);
    }
  }
  // `node:*` stays an import in every target: the browser target would otherwise inline Node polyfills.
  return [...new Set([...M3_EXTERNAL, "node:*", ...names, ...extra])];
}

/** Expand glob entries (`wrappers/*.ts`) against `cwd`; plain paths pass through. */
export function expandEntries(entries: string | readonly string[], cwd: string): string[] {
  const out: string[] = [];
  for (const entry of typeof entries === "string" ? [entries] : entries) {
    if (/[*?{]/.test(entry)) {
      // eslint-disable-next-line unicorn/no-array-sort -- Sorting a fresh array keeps the shared ES2022 type contract.
      const matches = [...new Glob(entry).scanSync({ cwd, onlyFiles: true })].sort();
      if (matches.length === 0) throw new Error(`m3-config: entry glob matches nothing: ${entry}`);
      out.push(...matches.map(m => resolve(cwd, m)));
    } else out.push(resolve(cwd, entry));
  }
  return out;
}

/** Deepest directory that contains every entry: the base of the output layout (`src/a.ts` -> `dist/a.js`). */
export function commonDir(files: readonly string[]): string {
  const [first, ...rest] = files.map(f => dirname(f).replaceAll("\\", "/").split("/"));
  let common = first ?? [];
  for (const parts of rest) {
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join("/") || "/";
}

/**
 * Prepend the React client directive to emitted `.js` files using Bun's native Glob and I/O.
 * Returns the number of files changed; a second run changes none.
 */
export async function prependUseClient(dir: string, only?: readonly string[]): Promise<number> {
  const files: string[] = [];
  for await (const found of new Glob("**/*.js").scan({
    cwd: dir,
    onlyFiles: true,
  })) {
    const path = found.replaceAll("\\", "/");
    if (!only || only.includes(path.split("/").pop() ?? path) || only.includes(path)) files.push(path);
  }
  const changed = await Promise.all(
    files.map(async path => {
      const file = join(dir, path);
      const content = await Bun.file(file).text();
      if (content.startsWith(USE_CLIENT)) return 0;
      await Bun.write(file, USE_CLIENT + content);
      return 1;
    }),
  );
  return changed.reduce<number>((sum, n) => sum + n, 0);
}

/** Executes a native Bun build for an M3 package. */
export async function m3BunBuild(options: M3BunBuildOptions = {}): Promise<M3BunBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const entrypoints = expandEntries(options.entry ?? ["src/index.ts"], cwd);
  const outdir = resolve(cwd, options.outDir ?? "dist");
  const useClient = options.useClient ?? true;

  const result = await Bun.build({
    entrypoints,
    root: commonDir(entrypoints),
    outdir,
    target: options.target ?? "browser",
    format: options.format ?? "esm",
    splitting: options.splitting ?? true,
    sourcemap: options.sourcemap ?? "external",
    minify: options.minify ?? false,
    external: externals(cwd, options.external),
    plugins: options.plugins ?? [],
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
      ...options.define,
    },
    throw: false,
  });

  if (!result.success) {
    return {
      success: false,
      outDir: outdir,
      outputs: result.outputs,
      logs: result.logs.map(log => String(log)),
    };
  }
  if (useClient !== false)
    await prependUseClient(outdir, Array.isArray(useClient) ? (useClient as readonly string[]) : undefined);
  return { success: true, outDir: outdir, outputs: result.outputs, logs: [] };
}

// Direct CLI invocation: `bun packages/m3-config/bun-build.ts --entry src/index.ts`
if (import.meta.main) {
  const args = process.argv.slice(2);
  const options: M3BunBuildOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--entry" || arg === "-e") options.entry = args[++i]!;
    else if (arg === "--outdir" || arg === "-o") options.outDir = args[++i]!;
    else if (arg === "--target" || arg === "-t") options.target = args[++i] as M3Target;
    else if (arg === "--minify" || arg === "-m") options.minify = true;
  }
  const res = await m3BunBuild(options);
  if (!res.success) {
    console.error("[m3-bun-build] Failed to build:", res.logs.join("\n"));
    process.exit(1);
  }
  console.log(`[m3-bun-build] Successfully built ${res.outputs.length} artifact(s) to ${res.outDir}`);
}
