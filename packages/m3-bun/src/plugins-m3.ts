// SPDX-License-Identifier: Apache-2.0
// The m3 packages `m3Bun` serves as modules (resolved from the app, then from @aphrody/m3-bun):
//   m3:icons/[style/]name[?fill=1&wght=300]     Material Symbols SVG markup: the local catalogue (`iconsRoot`,
//                                               `M3_ICONS_ROOT`, else @aphrody/material-design-icons), else
//                                               @aphrody/m3-icons rendered natively, else the CDN (src/icons.ts)
//   m3:icon/<style>/<name>?fill&wght&grad&opsz&size
//                                               @aphrody/m3-icons/plugin as is: every axis, native rendering only
//   m3:theme/{tokens,tailwind,spaceui}.css      @aphrody/m3-theme sheets (baseline scheme, seed #6750a4), each
//                                               compiled as its own Tailwind root by m3Plugin
//   m3:assets/<path>[?url]                      @aphrody/assets files; `?url` follows @aphrody/m3's `?url` rules
import type { BunPlugin, OnLoadArgs, OnLoadResult, OnResolveArgs } from "bun";
import { dirname, resolve } from "node:path";
import { loadIcon, parseIconSpecifier, readIcon, type IconRequest } from "./icons.ts";
import { lazyPlugin, recordPlugin, resolveDirs, resolveFrom, type RecordedPlugin } from "./plugins.ts";

const ICONS_NAMESPACE = "m3-icons";
const ASSET_URL_NAMESPACE = "m3-bun-asset-url";

/** `m3:<alias>/` -> package whose files it serves. */
export const M3_PACKAGE_MODULES: Readonly<Record<string, string>> = {
  theme: "@aphrody/m3-theme",
  assets: "@aphrody/assets",
};

export interface M3PackagePluginOptions {
  /** Directory containing the application (default: process.cwd()). */
  configDir?: string;
  /** Material Symbols catalogue directory; default `M3_ICONS_ROOT`, then @aphrody/material-design-icons. */
  iconsRoot?: string;
}

interface SymbolCatalogue {
  hasSymbol(name: string, style: IconRequest["style"], weight: number, filled: boolean): boolean;
  readSymbolSvg(name: string, style: IconRequest["style"], weight: number, filled: boolean): string;
}

const svgModule = (svg: string): OnLoadResult => ({
  contents: `export default ${JSON.stringify(svg)};\n`,
  loader: "js",
});

/** `m3IconPlugin` of @aphrody/m3-icons, once its native library is known to load. */
function nativeIcons(dirs: readonly string[]): () => Promise<BunPlugin> {
  let loaded: Promise<BunPlugin> | undefined;
  return () =>
    (loaded ??= (async () => {
      const path = resolveFrom("@aphrody/m3-icons/plugin", dirs);
      if (!path) throw new Error("m3-bun: native Material Symbols need @aphrody/m3-icons (bun add @aphrody/m3-icons)");
      const ffi = await import(Bun.resolveSync("@aphrody/bun", dirname(path)));
      if (typeof ffi.isAphrodyFfiAvailable === "function" && !ffi.isAphrodyFfiAvailable())
        throw new Error(
          "m3-bun: @aphrody/m3-icons renders through the @aphrody/bun native library, which is not available here",
        );
      return ((await import(path)) as { m3IconPlugin: BunPlugin }).m3IconPlugin;
    })());
}

async function renderNative(plugin: RecordedPlugin, specifier: string): Promise<OnLoadResult> {
  const resolved = await plugin.resolve({
    path: specifier,
    importer: "",
    namespace: "file",
    kind: "import-statement",
  } as OnResolveArgs);
  if (!resolved?.path) throw new Error(`m3-bun: @aphrody/m3-icons does not resolve ${specifier}`);
  const result = await plugin.load({
    path: resolved.path,
    namespace: resolved.namespace ?? "file",
    loader: "js",
  } as OnLoadArgs);
  if (!result) throw new Error(`m3-bun: @aphrody/m3-icons does not load ${specifier}`);
  return result;
}

/** Material Symbols (`m3:icons/`, `m3:icon/`) and the m3 package files (`m3:theme/`, `m3:assets/`). */
export function m3PackagesPlugin(options: M3PackagePluginOptions = {}): BunPlugin {
  const dirs = resolveDirs(options.configDir);
  const native = nativeIcons(dirs);
  let recorded: Promise<RecordedPlugin> | undefined;
  const getRecorded = () => (recorded ??= native().then(plugin => recordPlugin(plugin)));
  let catalogue: Promise<SymbolCatalogue | null> | undefined;
  const getCatalogue = () =>
    (catalogue ??= (async () => {
      const path = resolveFrom("@aphrody/material-design-icons", dirs);
      return path ? ((await import(path)) as SymbolCatalogue) : null;
    })());

  const symbol = async (tail: string): Promise<OnLoadResult> => {
    const request = parseIconSpecifier(tail);
    const root = options.iconsRoot ?? Bun.env.M3_ICONS_ROOT;
    if (root) return svgModule(readIcon(request, resolve(root)));
    const symbols = await getCatalogue();
    const { name, style, weight, fill } = request;
    if (symbols?.hasSymbol(name, style, weight, fill))
      return svgModule(symbols.readSymbolSvg(name, style, weight, fill).trim());
    const rendered = await getRecorded().then(
      plugin => renderNative(plugin, `m3:icon/${style}/${name}?fill=${fill ? 1 : 0}&wght=${weight}`),
      () => undefined,
    );
    return rendered ?? svgModule(await loadIcon(request, null));
  };

  const packageIcons = lazyPlugin({
    name: "m3-bun:m3-icons",
    load: () =>
      native().catch((error: Error) => {
        throw new Error(`${error.message}; m3:icons/[style/]name serves the SVG catalogue without it`, {
          cause: error,
        });
      }),
    onResolve: [{ filter: /^m3:icon\// }],
    onLoad: [{ filter: /.*/, namespace: "m3-icon" }],
  });

  return {
    name: "@aphrody/m3-bun:packages",
    setup(build) {
      build.onResolve({ filter: /^m3:icons\// }, args => ({
        path: args.path.slice("m3:icons/".length),
        namespace: ICONS_NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: ICONS_NAMESPACE }, args => symbol(args.path));
      void packageIcons.setup(build);

      build.onResolve({ filter: /^m3:(?:theme|assets)\// }, async args => {
        const [specifier = "", query] = args.path.split("?", 2);
        const alias = specifier.slice("m3:".length, specifier.indexOf("/"));
        const pkg = M3_PACKAGE_MODULES[alias]!;
        const target = `${pkg}${specifier.slice(specifier.indexOf("/"))}`;
        const path = resolveFrom(target, dirs);
        if (!path) throw new Error(`m3-bun: ${args.path} needs ${target}, which does not resolve (bun add ${pkg})`);
        if (query === undefined) return { path };
        if (query !== "url" || alias !== "assets")
          throw new Error(`m3-bun: ${args.path}: only m3:assets/ takes a query, and only ?url`);
        const { urlImportForm } = await import("@aphrody/m3");
        if (urlImportForm(path) === "file") return { path };
        // The suffix keeps this module apart from a plain import of the same file (Bun deduplicates by path).
        return { path: `${path}?url`, namespace: ASSET_URL_NAMESPACE };
      });
      build.onLoad({ filter: /.*/, namespace: ASSET_URL_NAMESPACE }, async args => {
        const { dataUrlFor } = await import("@aphrody/m3");
        const url = await dataUrlFor(args.path.slice(0, -"?url".length));
        return {
          contents: `export default ${JSON.stringify(url)};\n`,
          loader: "js",
        };
      });
    },
  };
}
