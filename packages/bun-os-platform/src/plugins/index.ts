// SPDX-License-Identifier: Apache-2.0
/**
 * Bun OS plugins, modeled on `Bun.plugin`: a manifest (`plugin.json`: name, version, permissions,
 * entry) and a module whose default export is `{ name, setup(build) }`. `setup` registers hooks
 * through `build`, each guarded by a declared permission:
 *
 *   build.onDetect / build.onPreview        file-type loaders and parsers        ("files")
 *   build.addGameSource                     game sources and libraries           ("library")
 *   build.addTheme                          themes                               ("themes")
 *   build.addLocale                         Fluent catalogs                      ("locales")
 *   build.addMenuEntry / build.addPanel     shell and play menu entries, panels  ("ui")
 *   build.addMachine                        Bun Engine machines (cores)          ("machines")
 *   build.addTransferProvider               CDN / download providers             ("transfer")
 *   build.onCommand                         commands of menu entries             (any)
 *   build.bunPlugin                         a real Bun.plugin (runtime loaders)  ("bun.plugin")
 *
 * Discovery: built-ins in `packages/bun-os-platform/plugins/*` (trusted with the checkout), then
 * `usr/lib/bun-os/plugins/*`, which load only when pinned in `usr/etc/bun-os/plugins.lock.json`
 * (sha256 over every file of the plugin directory) or signed (`plugin.sig`, Ed25519 over that
 * digest) by a key in `usr/etc/bun-os/trusted-keys/*.jwk`. Static `locales/` and `themes/`
 * directories of a plugin are read without running code.
 */
import type { BunPlugin } from "bun";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { contributeCatalog } from "../i18n";
import type { Localizer } from "../i18n/localizer";
import { platformPaths } from "../paths";
import { contributeTheme, readThemeFile } from "../theme";
import type { ThemeFile } from "../theme/resolve";

export type Permission =
  | "files"
  | "library"
  | "themes"
  | "locales"
  | "ui"
  | "machines"
  | "transfer"
  | "bun.plugin"
  | `net:${string}`
  | `fs.read:${string}`;

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  /** Module with `export default { name, setup }`; optional for data-only plugins. */
  entry?: string;
  permissions: Permission[];
  /** Platform contract version this plugin targets. */
  platform?: string;
  /** Where the plugin came from (`git+https://...#<sha>`, `https://...tgz`), for audits. */
  source?: string;
}

export interface Detection {
  kind: string;
  format: string;
  mime?: string;
  platform?: string;
  confidence: number;
  by: string;
  details?: Record<string, unknown>;
}

export interface DetectInput {
  path: string;
  name: string;
  size: number;
  /** First 64 KiB. */
  head: Uint8Array;
}

export interface Preview {
  kind: string;
  /** Thumbnail bytes (WebP) when the kind has a picture. */
  thumbnail?: Uint8Array;
  metadata?: Record<string, unknown>;
  entries?: { path: string; size: number }[];
}

export interface GameEntry {
  id: string;
  title: string;
  system?: string;
  path?: string;
  url?: string;
  art?: string;
}

export interface GameSource {
  id: string;
  /** Fluent id of the source name. */
  labelKey: string;
  list(): Promise<GameEntry[]>;
}

export interface MenuEntry {
  id: string;
  /** Fluent id of the label (from the plugin's catalogs). */
  labelKey: string;
  /** Material Symbols name. */
  icon?: string;
  /** `quick-menu`, `settings`, `library`, `game` (shell) or `nav` (play). */
  location: "quick-menu" | "settings" | "library" | "game" | "nav";
  /** Command id handled by `build.onCommand`. */
  command: string;
}

export interface Panel {
  id: string;
  titleKey: string;
  location: MenuEntry["location"];
  /** Returns the panel content as data the host renders with its own components. */
  render(context: {
    locale: string;
  }): Promise<{ rows: { labelKey: string; value: string }[] }>;
}

export interface MachineContribution {
  id: string;
  systems: string[];
  /** Command line launching the machine for a game image (`{rom}` placeholder). */
  command?: string[];
  /** Or a Bun Engine console plugin id (`bun-engine:<console>`). */
  console?: string;
}

export interface TransferProvider {
  id: string;
  /** Claims a URL or a `scheme:` spec (e.g. `libretro:core/mgba`). */
  match(url: string): boolean;
  /** Candidate URLs, best first (mirrors, CDN edges, LAN caches). */
  resolve(url: string): Promise<string[]>;
}

export interface PluginBuild {
  readonly manifest: PluginManifest;
  readonly dir: string;
  /** The host's localizer (labels are resolved by the host; this is for logs and previews). */
  readonly locale: string;
  onDetect(
    options: { filter?: RegExp; magic?: Uint8Array | string; offset?: number },
    detect: (
      input: DetectInput,
    ) => Detection | null | Promise<Detection | null>,
  ): void;
  onPreview(
    options: { kind?: string; format?: string },
    preview: (
      input: DetectInput & { detection: Detection },
    ) => Promise<Preview | null>,
  ): void;
  addGameSource(source: GameSource): void;
  addTheme(theme: ThemeFile): void;
  addLocale(tag: string, ftl: string): void;
  addMenuEntry(entry: MenuEntry): void;
  addPanel(panel: Panel): void;
  addMachine(machine: MachineContribution): void;
  addTransferProvider(provider: TransferProvider): void;
  onCommand(
    id: string,
    run: (args: Record<string, unknown>) => unknown | Promise<unknown>,
  ): void;
  bunPlugin(plugin: BunPlugin): void;
}

export interface BunOsPlugin {
  name: string;
  setup(build: PluginBuild): void | Promise<void>;
}

/** Typed helper for plugin authors. */
export const definePlugin = (plugin: BunOsPlugin): BunOsPlugin => plugin;

export interface Detector {
  plugin: string;
  filter?: RegExp;
  magic?: Uint8Array;
  offset: number;
  detect(input: DetectInput): Detection | null | Promise<Detection | null>;
}

export interface Previewer {
  plugin: string;
  kind?: string;
  format?: string;
  preview(
    input: DetectInput & { detection: Detection },
  ): Promise<Preview | null>;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  builtin: boolean;
  trust: "builtin" | "pinned" | "signed";
  digest: string;
}

export interface BlockedPlugin {
  name: string;
  dir: string;
  reason: string;
}

/** Everything plugins registered; hosts read it. */
export class PluginRegistry {
  readonly plugins: LoadedPlugin[] = [];
  readonly blocked: BlockedPlugin[] = [];
  readonly detectors: Detector[] = [];
  readonly previewers: Previewer[] = [];
  readonly sources: (GameSource & { plugin: string })[] = [];
  readonly menu: (MenuEntry & { plugin: string })[] = [];
  readonly panels: (Panel & { plugin: string })[] = [];
  readonly machines: (MachineContribution & { plugin: string })[] = [];
  readonly providers: (TransferProvider & { plugin: string })[] = [];
  readonly commands = new Map<
    string,
    (args: Record<string, unknown>) => unknown
  >();
  readonly themes: (ThemeFile & { plugin: string })[] = [];

  /** Menu entries with labels resolved by the host's localizer. */
  menuFor(l10n: Localizer, location?: MenuEntry["location"]) {
    return this.menu
      .filter((m) => !location || m.location === location)
      .map((m) => ({
        plugin: m.plugin,
        id: m.id,
        label: l10n.t(m.labelKey),
        icon: m.icon ?? null,
        location: m.location,
        command: `${m.plugin}:${m.command}`,
      }));
  }

  async run(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const run = this.commands.get(command);
    if (!run) throw new Error(`unknown plugin command ${command}`);
    return run(args);
  }
}

function filesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === "node_modules" || name === "plugin.sig") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** sha256 over `<relative path>\0<bytes>` of every file (except `plugin.sig`), hex. */
export function pluginDigest(dir: string): string {
  const hash = new Bun.CryptoHasher("sha256");
  for (const file of filesOf(dir)) {
    hash.update(`${relative(dir, file).replace(/\\/g, "/")}\0`);
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}

interface LockFile {
  plugins: Record<
    string,
    { version: string; sha256: string; source?: string; pinnedAt: string }
  >;
}

export async function readLock(): Promise<LockFile> {
  const file = Bun.file(platformPaths().pluginLock);
  return (await file.exists())
    ? ((await file.json()) as LockFile)
    : { plugins: {} };
}

/** Pins the current digest of an installed plugin (an explicit trust decision of the owner). */
export async function pinPlugin(
  dir: string,
): Promise<{ name: string; sha256: string }> {
  const manifest = readManifest(dir);
  const lock = await readLock();
  const sha256 = pluginDigest(dir);
  lock.plugins[manifest.name] = {
    version: manifest.version,
    sha256,
    source: manifest.source,
    pinnedAt: new Date().toISOString(),
  };
  const { ensureDir } = await import("../paths");
  ensureDir(platformPaths().etc);
  await Bun.write(
    platformPaths().pluginLock,
    `${JSON.stringify(lock, null, 2)}\n`,
  );
  return { name: manifest.name, sha256 };
}

async function signedBy(dir: string, digest: string): Promise<boolean> {
  const sig = join(dir, "plugin.sig");
  const keysDir = platformPaths().trustedKeys;
  if (!existsSync(sig) || !existsSync(keysDir)) return false;
  const signature = Buffer.from(readFileSync(sig, "utf8").trim(), "base64");
  for (const name of readdirSync(keysDir).filter((f) => f.endsWith(".jwk"))) {
    try {
      const jwk = JSON.parse(
        readFileSync(join(keysDir, name), "utf8"),
      ) as JsonWebKey;
      const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      if (
        await crypto.subtle.verify(
          "Ed25519",
          key,
          signature,
          new TextEncoder().encode(digest),
        )
      )
        return true;
    } catch {
      /* not an Ed25519 key */
    }
  }
  return false;
}

const VALID_PERMISSION =
  /^(files|library|themes|locales|ui|machines|transfer|bun\.plugin|net:[a-z0-9.*-]+|fs\.read:.+)$/;

export function readManifest(dir: string): PluginManifest {
  const manifest = JSON.parse(
    readFileSync(join(dir, "plugin.json"), "utf8"),
  ) as PluginManifest;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name ?? ""))
    throw new Error(`${dir}: invalid plugin name`);
  if (!/^\d+\.\d+\.\d+/.test(manifest.version ?? ""))
    throw new Error(`${dir}: invalid version`);
  for (const p of manifest.permissions ?? [])
    if (!VALID_PERMISSION.test(p))
      throw new Error(`${manifest.name}: unknown permission ${p}`);
  if (
    manifest.entry &&
    resolve(dir, manifest.entry).indexOf(resolve(dir)) !== 0
  )
    throw new Error(`${manifest.name}: entry outside the plugin`);
  return manifest;
}

export function discover(): { dir: string; builtin: boolean }[] {
  const p = platformPaths();
  const out: { dir: string; builtin: boolean }[] = [];
  for (const [root, builtin] of [
    [p.builtinPlugins, true],
    [p.plugins, false],
  ] as const) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort())
      if (existsSync(join(root, name, "plugin.json")))
        out.push({ dir: join(root, name), builtin });
  }
  return out;
}

function guard(manifest: PluginManifest, permission: Permission): void {
  if (!manifest.permissions.includes(permission))
    throw new Error(`${manifest.name} needs the "${permission}" permission`);
}

/** Loads every trusted plugin into a registry. */
export async function loadPlugins(
  options: { locale?: string; only?: string[] } = {},
): Promise<PluginRegistry> {
  const registry = new PluginRegistry();
  const lock = await readLock();
  for (const { dir, builtin } of discover()) {
    let manifest: PluginManifest;
    try {
      manifest = readManifest(dir);
    } catch (error) {
      registry.blocked.push({
        name: dir,
        dir,
        reason: String((error as Error).message),
      });
      continue;
    }
    if (options.only && !options.only.includes(manifest.name)) continue;
    if (registry.plugins.some((p) => p.manifest.name === manifest.name)) {
      registry.blocked.push({
        name: manifest.name,
        dir,
        reason: "duplicate name",
      });
      continue;
    }
    const digest = pluginDigest(dir);
    let trust: LoadedPlugin["trust"] | null = builtin ? "builtin" : null;
    if (!trust && lock.plugins[manifest.name]?.sha256 === digest)
      trust = "pinned";
    if (!trust && (await signedBy(dir, digest))) trust = "signed";
    if (!trust) {
      registry.blocked.push({
        name: manifest.name,
        dir,
        reason: lock.plugins[manifest.name]
          ? "digest differs from the pinned one"
          : "not pinned or signed",
      });
      continue;
    }
    // Static data: catalogs and themes (no code runs).
    if (
      manifest.permissions.includes("locales") &&
      existsSync(join(dir, "locales"))
    )
      for (const tag of readdirSync(join(dir, "locales")))
        for (const f of readdirSync(join(dir, "locales", tag)).filter((f) =>
          f.endsWith(".ftl"),
        ))
          contributeCatalog(
            tag,
            readFileSync(join(dir, "locales", tag, f), "utf8"),
          );
    if (
      manifest.permissions.includes("themes") &&
      existsSync(join(dir, "themes"))
    )
      for (const f of readdirSync(join(dir, "themes")).filter((f) =>
        /\.(json|toml|css)$/.test(f),
      )) {
        const theme = readThemeFile(join(dir, "themes", f));
        theme.id ??= `${manifest.name}/${f.replace(/\.[^.]+$/, "")}`;
        contributeTheme(theme);
        registry.themes.push({ ...theme, plugin: manifest.name });
      }
    if (manifest.entry) {
      const mod = (await import(resolve(dir, manifest.entry))) as {
        default?: BunOsPlugin;
      };
      const plugin = mod.default;
      if (!plugin || typeof plugin.setup !== "function") {
        registry.blocked.push({
          name: manifest.name,
          dir,
          reason: "entry has no default { setup }",
        });
        continue;
      }
      const name = manifest.name;
      const build: PluginBuild = {
        manifest,
        dir,
        locale: options.locale ?? "en",
        onDetect(o, detect) {
          guard(manifest, "files");
          const magic =
            typeof o.magic === "string"
              ? new TextEncoder().encode(o.magic)
              : o.magic;
          registry.detectors.push({
            plugin: name,
            filter: o.filter,
            magic,
            offset: o.offset ?? 0,
            detect,
          });
        },
        onPreview(o, preview) {
          guard(manifest, "files");
          registry.previewers.push({
            plugin: name,
            kind: o.kind,
            format: o.format,
            preview,
          });
        },
        addGameSource(source) {
          guard(manifest, "library");
          registry.sources.push({ ...source, plugin: name });
        },
        addTheme(theme) {
          guard(manifest, "themes");
          contributeTheme(theme);
          registry.themes.push({ ...theme, plugin: name });
        },
        addLocale(tag, ftl) {
          guard(manifest, "locales");
          contributeCatalog(tag, ftl);
        },
        addMenuEntry(entry) {
          guard(manifest, "ui");
          registry.menu.push({ ...entry, plugin: name });
        },
        addPanel(panel) {
          guard(manifest, "ui");
          registry.panels.push({ ...panel, plugin: name });
        },
        addMachine(machine) {
          guard(manifest, "machines");
          registry.machines.push({ ...machine, plugin: name });
        },
        addTransferProvider(provider) {
          guard(manifest, "transfer");
          registry.providers.push({ ...provider, plugin: name });
        },
        onCommand(id, run) {
          registry.commands.set(`${name}:${id}`, run);
        },
        bunPlugin(plugin) {
          guard(manifest, "bun.plugin");
          Bun.plugin(plugin);
        },
      };
      try {
        await plugin.setup(build);
      } catch (error) {
        registry.blocked.push({
          name,
          dir,
          reason: String((error as Error).message),
        });
        continue;
      }
    }
    registry.plugins.push({ manifest, dir, builtin, trust, digest });
  }
  return registry;
}

let shared: Promise<PluginRegistry> | null = null;
/** One registry per process (play server, sidecar, CLI). */
export function plugins(): Promise<PluginRegistry> {
  shared ??= loadPlugins();
  return shared;
}

/**
 * Plugin directories trusted without running code (built-ins and pinned digests), for static
 * readers that cannot wait for `plugins()` (theme lookup). Signed-only plugins join once loaded.
 */
export function trustedPluginDirsSync(): {
  name: string;
  dir: string;
  manifest: PluginManifest;
}[] {
  const lockFile = platformPaths().pluginLock;
  const lock: LockFile = existsSync(lockFile)
    ? (JSON.parse(readFileSync(lockFile, "utf8")) as LockFile)
    : { plugins: {} };
  const out: { name: string; dir: string; manifest: PluginManifest }[] = [];
  for (const { dir, builtin } of discover()) {
    try {
      const manifest = readManifest(dir);
      if (builtin || lock.plugins[manifest.name]?.sha256 === pluginDigest(dir))
        out.push({ name: manifest.name, dir, manifest });
    } catch {
      /* invalid manifests are reported by loadPlugins */
    }
  }
  return out;
}
