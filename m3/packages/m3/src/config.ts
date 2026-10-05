// SPDX-License-Identifier: Apache-2.0
// `m3.config.ts`: what an application declares once for `m3 dev`, `m3 build` and the plugin.
//
//   import { defineM3Config } from "@aphrody/m3/config";
//   export default defineM3Config({
//     entry: "src/index.html",
//     proxy: { "/rpc": "http://localhost:8080" },
//     tauri: { uiDist: "../../../crates/ui/app/ui-dist" },
//     theme: { seed: "#6750a4", variant: "tonalSpot" },
//   });
//
// Every path is relative to the directory of the config file.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Dynamic colour inputs of the `m3:theme.css` sheet. */
export interface M3ThemeConfig {
  /** Seed colour, `#rrggbb`. */
  seed?: string;
  /** Scheme variant (`tonalSpot`, `content`, `fidelity`, `expressive`, `vibrant`, `neutral`, `monochrome`). */
  variant?: string;
  /** Contrast level, -1 to 1. */
  contrast?: number;
  /** Emit the dark scheme. */
  dark?: boolean;
}

export interface M3TauriConfig {
  /** Output directory of the Tauri webview (`frontendDist`). */
  uiDist: string;
}

export interface M3Config {
  /** HTML entry: served on `/*` by `m3 dev`, bundled by `m3 build`. */
  entry: string;
  /** Extra HTML pages, `route -> file`, served next to the entry. */
  routes?: Record<string, string>;
  /** Optional React page directory for streamed SSR in `m3 dev`. */
  pagesDir?: string;
  /** Proxy prefixes, `"/rpc" -> "http://localhost:8080"`; the prefix and everything below it. */
  proxy?: Record<string, string>;
  /** Dev server port. `PORT` overrides it; default 3000. */
  port?: number;
  /** Hot module reloading in `m3 dev` (default true). */
  hmr?: boolean;
  /** Static build output (default `dist`). */
  outdir?: string;
  /** Build-time constants for `Bun.build` `define`. */
  define?: Record<string, string>;
  /** Function calls or statements to drop from the bundle (e.g. `["debugger"]`). */
  drop?: string[];
  /** Minification options or boolean override. */
  minify?: boolean | { whitespace?: boolean; syntax?: boolean; identifiers?: boolean };
  /** Modules with barrel files whose unused exports should be skipped during bundling. */
  optimizeImports?: string[];
  /** Tauri webview build (`m3 build --tauri`). */
  tauri?: M3TauriConfig;
  /** Inputs of the `m3:theme.css` virtual sheet. */
  theme?: M3ThemeConfig;
  /** Aphrody OS checkout holding the fonts (default: discovered, see `resolveRepoRoot`). */
  root?: string;
}

/** A config whose paths are absolute. */
export interface ResolvedM3Config extends M3Config {
  /** Directory the relative paths were resolved against. */
  dir: string;
  /** The config file, when one was loaded. */
  file?: string;
  outdir: string;
  routes: Record<string, string>;
  proxy: Record<string, string>;
}

/** Identity helper that types an `m3.config.ts`. */
export function defineM3Config(config: M3Config): M3Config {
  return config;
}

/** Config file names, in lookup order. */
export const CONFIG_FILES = ["m3.config.ts", "m3.config.mts", "m3.config.js", "m3.config.mjs"] as const;

/** The first config file in `dir`, if any. */
export function findM3Config(dir: string): string | undefined {
  for (const name of CONFIG_FILES) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

function assertConfig(value: unknown, source: string): asserts value is M3Config {
  if (typeof value !== "object" || value === null) throw new Error(`${source}: the default export must be an object`);
  const entry = (value as { entry?: unknown }).entry;
  if (typeof entry !== "string" || entry.length === 0) throw new Error(`${source}: \`entry\` must be a non-empty string`);
  const proxy = (value as { proxy?: unknown }).proxy;
  if (proxy !== undefined) {
    if (typeof proxy !== "object" || proxy === null) throw new Error(`${source}: \`proxy\` must be an object`);
    for (const [prefix, target] of Object.entries(proxy)) {
      if (!prefix.startsWith("/")) throw new Error(`${source}: proxy prefix ${prefix} must start with "/"`);
      if (typeof target !== "string" || !URL.canParse(target)) throw new Error(`${source}: proxy target for ${prefix} is not a URL`);
    }
  }
}

/** Resolve the relative paths of `config` against `dir`. */
export function resolveM3Config(config: M3Config, dir: string, file?: string): ResolvedM3Config {
  assertConfig(config, file ?? "m3 config");
  const abs = (path: string) => resolve(dir, path);
  return {
    ...config,
    dir,
    file,
    entry: abs(config.entry),
    pagesDir: config.pagesDir ? abs(config.pagesDir) : undefined,
    outdir: abs(config.outdir ?? "dist"),
    routes: Object.fromEntries(Object.entries(config.routes ?? {}).map(([route, path]) => [route, abs(path)])),
    proxy: { ...config.proxy },
    tauri: config.tauri ? { ...config.tauri, uiDist: abs(config.tauri.uiDist) } : undefined,
    root: config.root ? abs(config.root) : undefined,
  };
}

/**
 * Load `m3.config.*` from `cwd` (or the explicit `file`) and resolve its paths.
 * Throws when no config exists.
 */
export async function loadM3Config(cwd: string = process.cwd(), file?: string): Promise<ResolvedM3Config> {
  const path = file ? resolve(cwd, file) : findM3Config(cwd);
  if (!path || !existsSync(path)) {
    throw new Error(`no ${CONFIG_FILES[0]} in ${cwd}`);
  }
  try {
    delete require.cache[path];
  } catch {}
  const mod = (await import(path)) as { default?: unknown };
  const config = mod.default;
  assertConfig(config, path);
  return resolveM3Config(config, dirname(path), path);
}
