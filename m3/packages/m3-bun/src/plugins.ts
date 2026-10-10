// SPDX-License-Identifier: Apache-2.0
// The Bun plugins of the Aphrody fork that `m3Bun` composes, each behind an option of `M3BunPluginOptions`:
//   yaml    @aphrody/bun-plugin-yaml    .yaml/.yml through js-yaml           default off: Bun loads YAML natively
//   svelte  @aphrody/bun-plugin-svelte  .svelte, .svelte.{ts,js}             default on, imported on the first Svelte module
//   mdx     @aphrody/bun-mdx-rs         .mdx through mdxjs-rs (onBeforeParse) default off: a native hook loads with the build
//   n2b     @aphrody/bun-plugin-n2b     Node→Bun report or codemods          default off
//   oxc     @aphrody/bun-plugin-oxc     Oxc transform, lint, isolated .d.ts  default off
// Packages resolve from the app directory first, then from @aphrody/m3-bun. A plugin is imported on the first module
// its hooks match (`lazyPlugin`); a missing package or a failing import is a build error that names the option.
// Native `onBeforeParse` hooks (mdx, oxc `native: true`) must be registered during setup: Bun ignores later ones.
import type {
  BuildOutput,
  BunPlugin,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
  PluginBuilder,
} from "bun";
import { dirname } from "node:path";

/** m3 barrels whose unused re-exports `Bun.build` skips (`optimizeImports`). */
export const M3_OPTIMIZE_IMPORTS: readonly string[] = [
  "@aphrody/m3-react",
  "@aphrody/m3-primitives",
  "@aphrody/m3-baseui",
  "@aphrody/m3-ai",
  "@aphrody/m3-explorer",
  "@aphrody/m3-forms",
  "@aphrody/m3-reader",
  "@aphrody/m3-icons",
  "@aphrody/m3-motion",
  "@aphrody/app-ui",
  "@aphrody/identity",
];

/** `optimizeImports` of an m3 build: the m3 barrels, then the app's own entries. */
export function m3OptimizeImports(extra: readonly string[] = []): string[] {
  return [...new Set([...M3_OPTIMIZE_IMPORTS, ...extra])];
}

/** Directories a composed package resolves from: the app, then this package. */
export function resolveDirs(configDir: string = process.cwd()): string[] {
  return [configDir, import.meta.dir];
}

/** Absolute path of `specifier` from the first directory that resolves it. */
export function resolveFrom(specifier: string, dirs: readonly string[]): string | undefined {
  for (const dir of dirs) {
    try {
      return Bun.resolveSync(specifier, dir);
    } catch {}
  }
  return undefined;
}

/** Import `specifier` for `feature`, or throw an error that says what to install. */
export async function importFrom<T = Record<string, any>>(
  specifier: string,
  dirs: readonly string[],
  feature: string,
): Promise<T> {
  const path = resolveFrom(specifier, dirs);
  if (!path)
    throw new Error(
      `m3-bun: ${feature} needs ${specifier}, which resolves neither from ${dirs[0]} nor from @aphrody/m3-bun (bun add ${packageName(specifier)})`,
    );
  try {
    return (await import(path)) as T;
  } catch (error) {
    throw new Error(`m3-bun: ${feature}: importing ${specifier} failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

export interface Hook {
  filter: RegExp;
  namespace?: string;
}

interface Handler<A, R> extends Hook {
  callback: (args: A) => R | Promise<R>;
}

/** The hooks a plugin registered, replayable on any module. */
export interface RecordedPlugin {
  load(args: OnLoadArgs): Promise<OnLoadResult>;
  resolve(args: OnResolveArgs): Promise<OnResolveResult | undefined>;
  end(result: BuildOutput): Promise<void>;
}

const matches = (hook: Hook, path: string, namespace: string | undefined) =>
  (hook.namespace ?? "file") === (namespace || "file") && hook.filter.test(path);

/** Run `plugin.setup` against a recording builder; native hooks are refused (they only work during setup). */
export async function recordPlugin(plugin: BunPlugin, config?: PluginBuilder["config"]): Promise<RecordedPlugin> {
  const loads: Handler<OnLoadArgs, OnLoadResult>[] = [];
  const resolves: Handler<OnResolveArgs, OnResolveResult | undefined | null>[] = [];
  const ends: ((result: BuildOutput) => void | Promise<void>)[] = [];
  const builder = {
    config: config ?? ({ plugins: [] } as unknown as PluginBuilder["config"]),
    onLoad(hook: Hook, callback: Handler<OnLoadArgs, OnLoadResult>["callback"]) {
      loads.push({ ...hook, callback });
      return builder;
    },
    onResolve(hook: Hook, callback: Handler<OnResolveArgs, OnResolveResult | undefined | null>["callback"]) {
      resolves.push({ ...hook, callback });
      return builder;
    },
    onStart(callback: () => void | Promise<void>) {
      void callback();
      return builder;
    },
    onEnd(callback: (result: BuildOutput) => void | Promise<void>) {
      ends.push(callback);
      return builder;
    },
    onBeforeParse() {
      throw new Error(`m3-bun: ${plugin.name} registers a native onBeforeParse hook, which must load with the build`);
    },
    module() {
      throw new Error(`m3-bun: ${plugin.name} registers runtime modules, which a composed plugin cannot defer`);
    },
  };
  await plugin.setup(builder as unknown as PluginBuilder);
  return {
    async load(args) {
      for (const hook of loads) {
        if (!matches(hook, args.path, args.namespace)) continue;
        // oxlint-disable-next-line no-await-in-loop -- Hooks run in registration order until one answers.
        const result = await hook.callback(args);
        if (result !== undefined) return result;
      }
      return undefined;
    },
    async resolve(args) {
      for (const hook of resolves) {
        if (!matches(hook, args.path, args.namespace)) continue;
        // oxlint-disable-next-line no-await-in-loop -- Hooks run in registration order until one answers.
        const result = await hook.callback(args);
        if (result) return result;
      }
      return undefined;
    },
    async end(result) {
      // oxlint-disable-next-line no-await-in-loop -- onEnd callbacks run in registration order.
      for (const callback of ends) await callback(result);
    },
  };
}

export interface LazyPluginSpec {
  name: string;
  /** Imports and creates the plugin; runs once, on the first module a hook below matches. */
  load: () => Promise<BunPlugin>;
  /** The filters the plugin registers: they trigger the import, then forward to its own hooks. */
  onLoad?: Hook[];
  onResolve?: Hook[];
}

/** A plugin whose package is imported on the first module that needs it. */
export function lazyPlugin(spec: LazyPluginSpec): BunPlugin {
  return {
    name: spec.name,
    setup(build) {
      let recorded: Promise<RecordedPlugin> | undefined;
      const get = () => (recorded ??= spec.load().then(plugin => recordPlugin(plugin, build.config)));
      for (const hook of spec.onResolve ?? []) build.onResolve(hook, async args => (await get()).resolve(args));
      for (const hook of spec.onLoad ?? []) build.onLoad(hook, async args => (await get()).load(args));
      build.onEnd?.(async result => {
        // A failed import already failed the module that triggered it.
        const plugin = await recorded?.catch(() => undefined);
        await plugin?.end(result);
      });
    },
  };
}

/** A plugin that needs its package during setup (native hooks). */
function eagerPlugin(name: string, load: () => Promise<BunPlugin>): BunPlugin {
  return {
    name,
    async setup(build) {
      await (await load()).setup(build);
    },
  };
}

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const OXC_SOURCE = /\.(?:[cm]?ts|tsx|jsx)$/;

/** Options of `SveltePlugin` (`@aphrody/bun-plugin-svelte`). */
export interface SvelteOptions {
  forceSide?: "client" | "server";
  development?: boolean;
  compilerOptions?: Record<string, unknown>;
}

/** Options of `n2bPlugin` (`@aphrody/bun-plugin-n2b/plugin`); `root` defaults to the app directory. */
export interface N2BOptions {
  root?: string;
  mode?: "report" | "fix" | "aggressive";
  onFindings?: "warn" | "error";
  quiet?: boolean;
  ignore?: string[];
  jobs?: number;
  filter?: RegExp;
}

/** Options of `oxcPlugin` (`@aphrody/bun-plugin-oxc`). */
export interface OxcOptions {
  filter?: RegExp;
  transform?: Record<string, unknown>;
  sourcemap?: boolean;
  minify?: boolean | Record<string, unknown>;
  lint?: false | "warn" | "error" | ({ level: "warn" | "error" } & Record<string, unknown>);
  dts?: { outdir: string; root?: string; stripInternal?: boolean };
  /** `Bun.build` only: Oxc as a native `onBeforeParse` hook, imported during setup. */
  native?: boolean;
}

export interface ForkPluginOptions {
  /** `.yaml`/`.yml` through `@aphrody/bun-plugin-yaml` (js-yaml). Default false: Bun loads YAML natively. */
  yaml?: boolean;
  /** `.svelte` and `.svelte.{ts,js}` through `@aphrody/bun-plugin-svelte` (needs `svelte`), or its options. Default true. */
  svelte?: boolean | SvelteOptions;
  /** `.mdx` compiled to JSX by `@aphrody/bun-mdx-rs` (native `onBeforeParse`, `Bun.build` only). Default false. */
  mdx?: boolean;
  /** Node→Bun findings or codemods at load time through `@aphrody/bun-plugin-n2b`. Default false. */
  n2b?: boolean | N2BOptions;
  /** Oxc transform, lint and isolated declarations through `@aphrody/bun-plugin-oxc`. Default false. */
  oxc?: boolean | OxcOptions;
}

const objectOf = <T extends object>(value: boolean | T | undefined): T | undefined =>
  typeof value === "object" ? value : undefined;

/** The fork plugins selected by `options`, in composition order. */
export function forkPlugins(options: ForkPluginOptions, configDir: string = process.cwd()): BunPlugin[] {
  const dirs = resolveDirs(configDir);
  const plugins: BunPlugin[] = [];
  if (options.yaml === true)
    plugins.push(
      lazyPlugin({
        name: "m3-bun:yaml",
        load: async () => {
          const mod = await importFrom<{ default: () => BunPlugin }>("@aphrody/bun-plugin-yaml", dirs, "yaml");
          return mod.default();
        },
        onLoad: [{ filter: /\.(yaml|yml)$/ }],
      }),
    );
  if (options.svelte !== false)
    plugins.push(
      lazyPlugin({
        name: "m3-bun:svelte",
        load: async () => {
          const mod = await importFrom<{ SveltePlugin: (options?: SvelteOptions) => BunPlugin }>(
            "@aphrody/bun-plugin-svelte",
            dirs,
            "svelte",
          );
          return mod.SveltePlugin(objectOf(options.svelte));
        },
        onLoad: [{ filter: /\.svelte$/ }, { filter: /\.svelte.[tj]s$/ }, { filter: /\.css$/, namespace: "bun-svelte" }],
        onResolve: [{ filter: /^bun-svelte:/ }],
      }),
    );
  if (options.mdx === true)
    plugins.push(
      eagerPlugin("m3-bun:mdx", async () => {
        const mod = await importFrom<{ default: () => BunPlugin }>("@aphrody/bun-mdx-rs", dirs, "mdx");
        return mod.default();
      }),
    );
  if (options.n2b) {
    const n2b: N2BOptions = { root: configDir, ...objectOf(options.n2b) };
    plugins.push(
      lazyPlugin({
        name: "m3-bun:n2b",
        load: async () => {
          const mod = await importFrom<{ n2bPlugin: (options: N2BOptions) => BunPlugin }>(
            "@aphrody/bun-plugin-n2b/plugin",
            dirs,
            "n2b",
          );
          return mod.n2bPlugin(n2b);
        },
        onLoad: [{ filter: n2b.filter ?? SOURCE }],
      }),
    );
  }
  if (options.oxc) {
    const oxc = objectOf(options.oxc) ?? {};
    const load = async () => {
      const mod = await importFrom<{ oxcPlugin: (options: OxcOptions) => BunPlugin }>(
        "@aphrody/bun-plugin-oxc",
        dirs,
        "oxc",
      );
      return mod.oxcPlugin(oxc);
    };
    plugins.push(
      oxc.native
        ? eagerPlugin("m3-bun:oxc", load)
        : lazyPlugin({ name: "m3-bun:oxc", load, onLoad: [{ filter: oxc.filter ?? OXC_SOURCE }] }),
    );
  }
  return plugins;
}


/** Directory of the module `specifier` resolves to, for packages that resolve their own dependencies. */
export function packageDir(specifier: string, dirs: readonly string[]): string | undefined {
  const path = resolveFrom(specifier, dirs);
  return path ? dirname(path) : undefined;
}
