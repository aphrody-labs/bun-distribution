// SPDX-License-Identifier: Apache-2.0
// `parcelRequire` for react-server-dom-parcel: a synchronous lookup in the module registry filled by
// the generated entries (client components, server action modules), plus `load(url)` for bundles.
const MODULES_KEY = "@aphrody/m3/app/modules";
const LOADERS_KEY = "@aphrody/m3/app/loaders";
const ALIASES_KEY = "@aphrody/m3/app/aliases";

type Namespace = Record<string, unknown>;
type ParcelRequire = ((id: string) => Namespace) & {
  load(url: string): Promise<unknown>;
  meta: { publicUrl: string };
  extendImportMap(map: Record<string, string>): void;
};

const g = globalThis as typeof globalThis & { parcelRequire?: ParcelRequire } & Record<symbol, unknown>;

/** Module namespaces by module id. */
export const modules: Map<string, Namespace> = (g[Symbol.for(MODULES_KEY)] ??= new Map()) as Map<string, Namespace>;
/** Server realm: loaders by module id (action modules, client modules of the ssr layer). */
export const loaders: Map<string, () => Promise<unknown>> = (g[Symbol.for(LOADERS_KEY)] ??= new Map()) as Map<
  string,
  () => Promise<unknown>
>;
/** Server realm: browser bundle URL to module id (client references name browser chunks). */
export const aliases: Map<string, string> = (g[Symbol.for(ALIASES_KEY)] ??= new Map()) as Map<string, string>;

const serverLoad = (url: string): Promise<unknown> => loaders.get(aliases.get(url) ?? url)?.() ?? Promise.resolve();

/** Install `parcelRequire`; `load` defaults to the server loaders. */
export function installParcelRequire(publicUrl: string, load: (url: string) => Promise<unknown> = serverLoad): void {
  if (g.parcelRequire) return;
  const require = ((id: string) => {
    const ns = modules.get(id);
    if (!ns) throw new Error(`@aphrody/m3: module ${id} is not registered`);
    return ns;
  }) as ParcelRequire;
  require.load = load;
  require.meta = { publicUrl };
  require.extendImportMap = () => {};
  g.parcelRequire = require;
}
