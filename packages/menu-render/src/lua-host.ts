/** Browser menu bridge. The caller supplies its qualified Lua runtime and game host. */
export interface LuaCallRecord {
  fn: string;
  args: unknown[];
}
export interface LayerInfo {
  id: number;
  [key: string]: unknown;
}
export interface LuaLayerState {
  calls: LuaCallRecord[];
  layers: LayerInfo[];
}
export interface MenuObjectState {
  name: string | null;
  visible: boolean;
  text?: string;
  number?: number;
}
export interface MenuState {
  layers: Map<number, { visible: boolean; objects: Map<number, MenuObjectState> }>;
}
export interface LuaGameHost {
  state: LuaLayerState;
  include(name: string): string;
}
export interface MenuGameHost extends LuaGameHost {
  menuState: MenuState;
}
export interface RunLuaOptions {
  layerIds?: number[];
  layerArg?: number;
}
export interface LuaRuntimeAdapter {
  createHost(): LuaGameHost;
  createGameHost(names: Map<number, string>): MenuGameHost;
  runLuaSource(
    source: string,
    host: LuaGameHost,
    options: RunLuaOptions,
  ): LuaLayerState | null | undefined;
  loadHashDictionary?(entries: Record<string, string>): void;
  loadMenuCommandNames?(json: unknown): Map<number, string>;
}

/** Adds registered includes to a real host, retaining its fallback and command implementation. */
export class LuaScreenHost {
  protected readonly includes = new Map<string, string>();
  constructor(public readonly host: LuaGameHost) {
    const fallback = host.include.bind(host);
    host.include = (name) => this.includes.get(name) ?? fallback(name);
  }
  get state(): LuaLayerState {
    return this.host.state;
  }
  registerInclude(name: string, source: string): this {
    this.includes.set(name, source);
    return this;
  }
  include(name: string): string {
    return this.host.include(name);
  }
}
export class GameScreenHost extends LuaScreenHost {
  constructor(public override readonly host: MenuGameHost) {
    super(host);
  }
  get menuState(): MenuState {
    return this.host.menuState;
  }
}
export interface RunMenuScreenOptions extends RunLuaOptions {
  runtime?: LuaRuntimeAdapter;
  includes?: Record<string, string>;
  hashEntries?: Record<string, string>;
}
export interface RunMenuStateOptions extends RunMenuScreenOptions {
  menuCommandNames?: Map<number, string>;
  funcluaJson?: unknown;
}
export interface MenuObjectOverride {
  visible?: boolean | undefined;
  text?: string | undefined;
  number?: number | undefined;
}
function requireRuntime(runtime: LuaRuntimeAdapter | undefined): LuaRuntimeAdapter {
  if (!runtime)
    throw new Error("Menu execution requires a caller-supplied Lua runtime adapter and game host.");
  return runtime;
}
function prepareHashes(
  runtime: LuaRuntimeAdapter,
  entries: Record<string, string> | undefined,
): void {
  if (!entries) return;
  if (!runtime.loadHashDictionary)
    throw new Error("The supplied Lua runtime does not support hash dictionaries.");
  runtime.loadHashDictionary(entries);
}
function registerIncludes(host: LuaScreenHost, includes: Record<string, string> | undefined): void {
  for (const [name, source] of Object.entries(includes ?? {})) host.registerInclude(name, source);
}
export function runMenuScreen(source: string, options: RunMenuScreenOptions = {}): LuaLayerState {
  const { runtime: supplied, includes, hashEntries, ...runOptions } = options;
  const runtime = requireRuntime(supplied);
  prepareHashes(runtime, hashEntries);
  const screen = new LuaScreenHost(runtime.createHost());
  registerIncludes(screen, includes);
  return runtime.runLuaSource(source, screen.host, runOptions) ?? screen.state;
}
export function runMenuScreenState(
  source: string,
  options: RunMenuStateOptions = {},
): { layerState: LuaLayerState; menuState: MenuState } {
  const {
    runtime: supplied,
    includes,
    hashEntries,
    menuCommandNames,
    funcluaJson,
    ...runOptions
  } = options;
  const runtime = requireRuntime(supplied);
  prepareHashes(runtime, hashEntries);
  if (funcluaJson !== undefined && !menuCommandNames && !runtime.loadMenuCommandNames)
    throw new Error("The supplied Lua runtime does not support menu command-name loading.");
  const names =
    menuCommandNames ??
    (funcluaJson !== undefined
      ? runtime.loadMenuCommandNames!(funcluaJson)
      : new Map<number, string>());
  const screen = new GameScreenHost(runtime.createGameHost(names));
  registerIncludes(screen, includes);
  const layerState = runtime.runLuaSource(source, screen.host, runOptions) ?? screen.state;
  return { layerState, menuState: screen.menuState };
}

/**
 * Aplatit un {@link MenuState} en overrides indexés par NOM d'objet — la clé que
 * `<GameMenu>` (layout statique) utilise. Combine la visibilité du layer et de l'objet.
 */
export function menuStateToOverrides(menuState: MenuState): Record<string, MenuObjectOverride> {
  const out: Record<string, MenuObjectOverride> = {};
  for (const layer of menuState.layers.values()) {
    const layerVisible = layer.visible;
    for (const obj of layer.objects.values()) {
      if (obj.name === null) continue;
      out[obj.name] = {
        visible: layerVisible && obj.visible,
        text: obj.text,
        number: obj.number,
      };
    }
  }
  return out;
}
