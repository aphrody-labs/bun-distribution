// SPDX-License-Identifier: Apache-2.0
/**
 * Native Bun build preset for the first-party Material Design 3 packages.
 *
 * Utilizes Bun's built-in fast bundler (`Bun.build`) with zero Node / tsup overhead:
 *
 *   import { m3BunBuild } from "@aphrody/m3-config/bun-build";
 *   await m3BunBuild({ entry: ["src/index.ts", "src/react.tsx"] });
 *
 * Provides:
 * - Native ESM bundling with code-splitting
 * - React client directive injection (`'use client';\n`) via Bun.file / Bun.write
 * - Built-in sourcemaps and tree-shaking
 * - CLI runnable via `bun packages/m3-config/bun-build.ts`
 */
import { Glob, type BunPlugin, type BuildArtifact } from "bun";
import { resolve, join } from "node:path";

const USE_CLIENT = "'use client';\n";

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

export interface M3BunBuildOptions {
  /** Entrypoint(s) to bundle. Defaults to `["src/index.ts"]`. */
  entry?: string | string[];
  /** Output directory. Defaults to `"dist"`. */
  outDir?: string;
  /** Runtime target: `"browser"` (default), `"bun"`, or `"node"`. */
  target?: "browser" | "bun" | "node";
  /** Module format: `"esm"` (default) or `"cjs"`. */
  format?: "esm" | "cjs";
  /** Enable code-splitting for multi-entry builds. Defaults to true. */
  splitting?: boolean;
  /** Sourcemap mode. Defaults to `"external"`. */
  sourcemap?: "external" | "inline" | "none";
  /** Minification. Defaults to false. */
  minify?: boolean | { whitespace?: boolean; syntax?: boolean; identifiers?: boolean };
  /** Additional external packages to exclude from bundling. */
  external?: string[];
  /**
   * `true` (default) marks every emitted JS file with `'use client';`,
   * a list limits that to specific file basenames, `false` skips it.
   */
  useClient?: boolean | readonly string[];
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
 * Prepend the React client directive to emitted `.js` files using Bun's native Glob and I/O.
 */
export async function prependUseClient(dir: string, only?: readonly string[]): Promise<number> {
  const glob = new Glob("**/*.js");
  let modified = 0;

  for await (const relativePath of glob.scan({ cwd: dir, onlyFiles: true })) {
    const filename = relativePath.split("/").pop() ?? relativePath;
    if (only && !only.includes(filename) && !only.includes(relativePath)) {
      continue;
    }

    const fullPath = join(dir, relativePath);
    const file = Bun.file(fullPath);
    const content = await file.text();

    if (!content.startsWith(USE_CLIENT)) {
      await Bun.write(fullPath, USE_CLIENT + content);
      modified++;
    }
  }

  return modified;
}

/**
 * Executes a native Bun build for an M3 package.
 */
export async function m3BunBuild(options: M3BunBuildOptions = {}): Promise<M3BunBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const rawEntries = options.entry ?? ["src/index.ts"];
  const entrypoints = (Array.isArray(rawEntries) ? rawEntries : [rawEntries]).map((e) =>
    resolve(cwd, e),
  );
  const outdir = resolve(cwd, options.outDir ?? "dist");
  const target = options.target ?? "browser";
  const format = options.format ?? "esm";
  const splitting = options.splitting ?? true;
  const sourcemap = options.sourcemap ?? "external";
  const minify = options.minify ?? false;
  const external = [...M3_EXTERNAL, ...(options.external ?? [])];
  const useClient = options.useClient ?? true;

  const result = await Bun.build({
    entrypoints,
    outdir,
    target,
    format,
    splitting,
    sourcemap,
    minify,
    external,
    plugins: options.plugins ?? [],
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
      ...options.define,
    },
  });

  if (!result.success) {
    const logs = result.logs.map((log) => String(log));
    return {
      success: false,
      outDir: outdir,
      outputs: result.outputs,
      logs,
    };
  }

  // Prepend 'use client' where required
  if (useClient !== false) {
    const only = Array.isArray(useClient) ? (useClient as readonly string[]) : undefined;
    await prependUseClient(outdir, only);
  }

  return {
    success: true,
    outDir: outdir,
    outputs: result.outputs,
    logs: [],
  };
}

// Direct CLI invocation: `bun packages/m3-config/bun-build.ts`
if (import.meta.main) {
  const args = process.argv.slice(2);
  let entry = "src/index.ts";
  let outDir = "dist";
  let target: "browser" | "bun" | "node" = "browser";
  let minify = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--entry" || arg === "-e") entry = args[++i]!;
    else if (arg === "--outdir" || arg === "-o") outDir = args[++i]!;
    else if (arg === "--target" || arg === "-t") target = args[++i] as any;
    else if (arg === "--minify" || arg === "-m") minify = true;
  }

  const res = await m3BunBuild({ entry, outDir, target, minify });
  if (!res.success) {
    console.error("[m3-bun-build] Failed to build:", res.logs.join("\n"));
    process.exit(1);
  }
  console.log(`[m3-bun-build] Successfully built ${res.outputs.length} artifact(s) to ${res.outDir}`);
}
