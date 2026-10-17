// The Bun Engine package manager: cores from the console catalog, and firmware and game images
// in a content-addressed store, declared in package.json and pinned in bep.lock.
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type ConsoleCatalogComponent, loadConsoleCatalog } from "./console/catalog";
import { defaultFirmwareStore, type FirmwareManifest, importFirmware, listFirmware } from "./firmware/import";
import { installRelease, releaseCatalog, uninstallRelease, usrRoot } from "./usr";
import { installCore, libretroCatalog, removeCore } from "./libretro";
import { fetchFromMirrors } from "./mirrors";

const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const lockName = "bep.lock";

export type PackageKind = "core" | "bin" | "libretro" | "firmware" | "rom";

/** The `bunEngine` field of package.json. */
export interface EngineManifest {
  cores: string[];
  binaries: string[];
  libretro: string[];
  firmware: Record<string, string[]>;
  roms: Record<string, { console: string; sha256: string }>;
}

export interface LockedCore {
  console: string;
  sourceRev: string;
  sources: string[];
  license: string;
  firmwarePolicy: string;
}

export interface LockedBinary {
  version: string;
  asset: string;
  url: string;
  sha256: string;
}

export interface EngineLock {
  lockfileVersion: 1;
  cores: Record<string, LockedCore>;
  binaries: Record<string, LockedBinary>;
  libretro: Record<string, { url: string; sha256: string; file: string }>;
  firmware: Record<string, FirmwareManifest>;
  roms: Record<string, FirmwareManifest>;
}

interface Project {
  dir: string;
  packageJson: Record<string, unknown>;
  manifest: EngineManifest;
}

function emptyManifest(): EngineManifest {
  return { cores: [], binaries: [], libretro: [], firmware: {}, roms: {} };
}

/** Finds the nearest package.json, like bun does. */
async function findProject(start = process.cwd()): Promise<Project> {
  let dir = resolve(start);
  for (;;) {
    const file = Bun.file(join(dir, "package.json"));
    if (await file.exists()) {
      const packageJson = (await file.json()) as Record<string, unknown>;
      const manifest = {
        ...emptyManifest(),
        ...(packageJson.bunEngine as Partial<EngineManifest> | undefined),
      };
      return { dir, packageJson, manifest };
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("no package.json found; run `bep init`");
    dir = parent;
  }
}

async function saveManifest(project: Project): Promise<void> {
  const manifest = project.manifest;
  manifest.cores = [...new Set(manifest.cores)].sort();
  manifest.binaries = [...new Set(manifest.binaries)].sort();
  manifest.libretro = [...new Set(manifest.libretro)].sort();
  project.packageJson.bunEngine = manifest;
  await Bun.write(join(project.dir, "package.json"), `${JSON.stringify(project.packageJson, null, 2)}\n`);
}

async function readLock(dir: string): Promise<EngineLock | undefined> {
  const file = Bun.file(join(dir, lockName));
  return (await file.exists()) ? ((await file.json()) as EngineLock) : undefined;
}

function romStore(): string {
  return join(dirname(defaultFirmwareStore()), "roms");
}

function pinnedRevision(path: string): string | undefined {
  const out = Bun.spawnSync(["git", "-C", repoRoot, "ls-files", "-s", "--", path]).stdout.toString();
  const [mode, sha] = out.split(/\s+/);
  return mode === "160000" ? sha : undefined;
}

async function catalogById(): Promise<Map<string, ConsoleCatalogComponent>> {
  return new Map((await loadConsoleCatalog()).components.map(component => [component.id, component]));
}

function lockCore(component: ConsoleCatalogComponent): LockedCore {
  return {
    console: component.console,
    sourceRev: component.sourceRev,
    sources: component.sources.map(source => source.path),
    license: component.license,
    firmwarePolicy: component.firmwarePolicy,
  };
}

async function storedImage(store: string, owner: string, sha256: string): Promise<FirmwareManifest | undefined> {
  const file = Bun.file(join(store, owner, `${sha256}.json`));
  return (await file.exists()) ? ((await file.json()) as FirmwareManifest) : undefined;
}

/** Resolves the manifest into a lock; with `frozen`, fails instead of changing bep.lock. */
export async function install(
  options: { frozen?: boolean; sources?: boolean; latest?: string[] } = {},
): Promise<EngineLock> {
  const project = await findProject();
  const catalog = await catalogById();
  const previous = await readLock(project.dir);
  const lock: EngineLock = {
    lockfileVersion: 1,
    cores: {},
    binaries: {},
    libretro: {},
    firmware: {},
    roms: {},
  };
  const missing: string[] = [];

  for (const id of project.manifest.cores) {
    const component = catalog.get(id);
    if (!component) {
      missing.push(`core ${id} is not in the console catalog`);
      continue;
    }
    lock.cores[id] = lockCore(component);
    if (component.integration === "submodule") {
      for (const source of component.sources) {
        const pinned = pinnedRevision(source.path);
        if (pinned !== component.sourceRev)
          missing.push(`core ${id}: ${source.path} is pinned at ${pinned ?? "nothing"}`);
        else if (options.sources) {
          const result = Bun.spawnSync(
            ["git", "-C", repoRoot, "submodule", "update", "--init", "--depth", "1", "--", source.path],
            { stdout: "inherit", stderr: "inherit" },
          );
          if (!result.success) missing.push(`core ${id}: could not check out ${source.path}`);
        }
      }
    }
  }
  const releases = await releaseCatalog();
  for (const id of project.manifest.binaries) {
    if (!releases[id]) {
      missing.push(`binary ${id} has no upstream release package; see bep search`);
      continue;
    }
    const pinned = options.latest?.includes(id) ? undefined : previous?.binaries?.[id];
    if (options.latest?.includes(id)) await uninstallRelease(id);
    try {
      const record = await installRelease(id, pinned && { version: pinned.version, sha256: pinned.sha256 });
      lock.binaries[id] = {
        version: record.version,
        asset: record.asset,
        url: record.url,
        sha256: record.sha256,
      };
    } catch (error) {
      missing.push(error instanceof Error ? error.message : String(error));
    }
  }
  const libretroIds = new Set((await libretroCatalog()).map(core => core.id));
  for (const id of project.manifest.libretro) {
    if (!libretroIds.has(id)) {
      missing.push(`libretro core ${id} is not in libretro-core-info`);
      continue;
    }
    const pinned = options.latest?.includes(id) ? undefined : previous?.libretro?.[id];
    const installed = pinned && existsSync(join(usrRoot(), pinned.file));
    try {
      lock.libretro[id] = installed ? pinned : await installCore(id, options.frozen ? pinned?.sha256 : undefined);
    } catch (error) {
      missing.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const [consoleName, hashes] of Object.entries(project.manifest.firmware)) {
    for (const sha256 of hashes) {
      const manifest = await storedImage(defaultFirmwareStore(), consoleName, sha256);
      if (manifest) lock.firmware[`${consoleName}@${sha256}`] = manifest;
      else
        missing.push(
          `firmware ${consoleName}@${sha256} is not in the store; run bep add firmware ${consoleName} <dump>`,
        );
    }
  }
  for (const [name, rom] of Object.entries(project.manifest.roms)) {
    const manifest = await storedImage(romStore(), rom.console, rom.sha256);
    if (manifest) lock.roms[name] = manifest;
    else missing.push(`rom ${name} (${rom.sha256}) is not in the store; run bep add rom ${rom.console} <image>`);
  }
  if (missing.length) throw new Error(missing.join("\n"));

  const text = `${JSON.stringify(lock, null, 2)}\n`;
  const lockPath = join(project.dir, lockName);
  const previousText = (await Bun.file(lockPath).exists()) ? await Bun.file(lockPath).text() : "";
  if (options.frozen && previousText !== text) throw new Error(`${lockName} is out of date; run bep install`);
  if (previousText !== text) await Bun.write(lockPath, text);
  return lock;
}

export async function init(): Promise<string> {
  const dir = process.cwd();
  const path = join(dir, "package.json");
  const file = Bun.file(path);
  const packageJson = (await file.exists())
    ? ((await file.json()) as Record<string, unknown>)
    : { name: basename(dir), private: true };
  packageJson.bunEngine ??= emptyManifest();
  await Bun.write(path, `${JSON.stringify(packageJson, null, 2)}\n`);
  return path;
}

/** `bep add <core...>`, `bep add bin <emulator...>`, `bep add firmware <console> <dump>`, `bep add rom <console> <image> [name]`. */
export async function add(args: string[]): Promise<void> {
  const project = await findProject();
  const [kind, consoleName, path, name] = args;
  if (kind === "free-firmware") {
    const { firmware } = (await Bun.file(
      join(import.meta.dir, "..", "plugins", "consoles", "free-firmware.json"),
    ).json()) as {
      firmware: Record<
        string,
        {
          console: string;
          file: string;
          url?: string;
          mirror?: { service: string; path: string };
          path?: string;
          sha512?: string;
        }
      >;
    };
    for (const id of args.slice(1)) {
      const entry = firmware[id];
      if (!entry) throw new Error(`no free firmware ${id}; known: ${Object.keys(firmware).join(", ")}`);
      const source = entry.path ? join(repoRoot, entry.path) : join(usrRoot(), "var", "cache", "bep", entry.file);
      if (entry.path && !existsSync(source))
        Bun.spawnSync([
          "git",
          "-C",
          repoRoot,
          "submodule",
          "update",
          "--init",
          "--recursive",
          "--depth",
          "1",
          "--",
          entry.path.split("/").slice(0, 2).join("/"),
        ]);
      if ((entry.url || entry.mirror) && !existsSync(source)) {
        const response = entry.mirror
          ? await fetchFromMirrors(entry.mirror.service, entry.mirror.path)
          : await fetch(entry.url!, { headers: { "user-agent": "bep" } });
        if (!response.ok) throw new Error(`${id}: download failed with ${response.status}`);
        await Bun.write(source, response);
      }
      if (entry.sha512) {
        const digest = new Bun.CryptoHasher("sha512").update(await Bun.file(source).bytes()).digest("hex");
        if (digest !== entry.sha512) throw new Error(`${id}: sha512 ${digest} does not match the registry`);
      }
      if (!existsSync(source)) throw new Error(`${id}: ${source} is missing`);
      const manifest = await importFirmware(entry.console, source);
      const hashes = (project.manifest.firmware[manifest.console] ??= []);
      if (!hashes.includes(manifest.sha256)) hashes.push(manifest.sha256);
    }
  } else if (kind === "libretro") {
    const known = new Set((await libretroCatalog()).map(core => core.id));
    for (const id of args.slice(1).map(name => name.replace(/_libretro$/, ""))) {
      if (!known.has(id)) throw new Error(`${id} is not a libretro core; see bep search`);
      project.manifest.libretro.push(id);
    }
  } else if (kind === "bin") {
    const releases = await releaseCatalog();
    for (const id of args.slice(1)) {
      if (!releases[id]) throw new Error(`${id} has no upstream release package; see bep search`);
      project.manifest.binaries.push(id);
    }
  } else if (kind === "firmware" || kind === "rom") {
    if (!consoleName || !path)
      throw new Error(`usage: bep add ${kind} <console> <file>${kind === "rom" ? " [name]" : ""}`);
    const consoles = new Set((await loadConsoleCatalog()).components.map(component => component.console));
    if (!consoles.has(consoleName)) throw new Error(`unknown console ${consoleName}; see bep consoles`);
    const manifest = await importFirmware(consoleName, path, kind === "firmware" ? undefined : romStore());
    if (kind === "firmware") {
      const hashes = (project.manifest.firmware[manifest.console] ??= []);
      if (!hashes.includes(manifest.sha256)) hashes.push(manifest.sha256);
    } else {
      project.manifest.roms[name ?? basename(path).replace(/\.[^.]+$/, "")] = {
        console: manifest.console,
        sha256: manifest.sha256,
      };
    }
  } else {
    const catalog = await catalogById();
    for (const id of args) {
      if (!catalog.has(id)) throw new Error(`core ${id} is not in the console catalog; see bep search`);
      project.manifest.cores.push(id);
    }
  }
  await saveManifest(project);
  await install();
}

export async function remove(names: string[]): Promise<void> {
  const project = await findProject();
  for (const name of names) {
    const before = JSON.stringify(project.manifest);
    project.manifest.cores = project.manifest.cores.filter(id => id !== name);
    if (project.manifest.binaries.includes(name)) await uninstallRelease(name);
    project.manifest.binaries = project.manifest.binaries.filter(id => id !== name);
    if (project.manifest.libretro.includes(name)) await removeCore(name);
    project.manifest.libretro = project.manifest.libretro.filter(id => id !== name);
    delete project.manifest.roms[name];
    delete project.manifest.firmware[name];
    for (const [consoleName, hashes] of Object.entries(project.manifest.firmware)) {
      project.manifest.firmware[consoleName] = hashes.filter(hash => hash !== name && !hash.startsWith(name));
    }
    if (JSON.stringify(project.manifest) === before) throw new Error(`${name} is not a dependency`);
  }
  await saveManifest(project);
  await install();
}

export async function list(): Promise<Array<{ kind: PackageKind; name: string; console: string; version: string }>> {
  const project = await findProject();
  const lock = (await readLock(project.dir)) ?? (await install());
  return [
    ...Object.entries(lock.cores).map(([name, core]) => ({
      kind: "core" as const,
      name,
      console: core.console,
      version: core.sourceRev.slice(0, 12),
    })),
    ...Object.entries(lock.libretro ?? {}).map(([name, core]) => ({
      kind: "libretro" as const,
      name,
      console: "",
      version: core.sha256.slice(0, 12),
    })),
    ...Object.entries(lock.binaries ?? {}).map(([name, bin]) => ({
      kind: "bin" as const,
      name,
      console: "",
      version: bin.version,
    })),
    ...Object.entries(lock.firmware).map(([name, image]) => ({
      kind: "firmware" as const,
      name,
      console: image.console,
      version: image.sha256.slice(0, 12),
    })),
    ...Object.entries(lock.roms).map(([name, image]) => ({
      kind: "rom" as const,
      name,
      console: image.console,
      version: image.sha256.slice(0, 12),
    })),
  ];
}

/** Which manifest entries pull in a core, and which firmware/roms target its console. */
export async function why(name: string): Promise<string[]> {
  const project = await findProject();
  const catalog = await catalogById();
  const component = catalog.get(name);
  const reasons: string[] = [];
  if (project.manifest.cores.includes(name)) reasons.push(`package.json bunEngine.cores: ${name}`);
  if (component) {
    for (const [rom, image] of Object.entries(project.manifest.roms))
      if (image.console === component.console) reasons.push(`rom ${rom} runs on ${component.console}`);
    if (project.manifest.firmware[component.console]) reasons.push(`firmware for ${component.console} is declared`);
  }
  return reasons;
}

export async function info(name: string): Promise<unknown> {
  const catalog = await catalogById();
  const component = catalog.get(name);
  if (component)
    return {
      ...component,
      pinned: component.sources.map(source => ({
        path: source.path,
        revision: pinnedRevision(source.path) ?? null,
      })),
    };
  const cores = [...catalog.values()].filter(item => item.console === name);
  if (cores.length)
    return {
      console: name,
      cores: cores.map(core => core.id),
      firmware: await listFirmware(name).catch(() => []),
    };
  throw new Error(`${name} is neither a core nor a console`);
}

export async function search(
  term = "",
): Promise<Array<{ id: string; kind: PackageKind; console: string; runtime: string }>> {
  const needle = term.toLowerCase();
  const cores = [...(await catalogById()).values()]
    .filter(component =>
      [component.id, component.console, component.runtime, ...component.cpu].some(field => field.includes(needle)),
    )
    .map(({ id, console, runtime }) => ({
      id,
      kind: "core" as const,
      console,
      runtime,
    }));
  const bins = Object.entries(await releaseCatalog())
    .filter(
      ([id, pkg]) => id.includes(needle) || pkg.console.includes(needle) || pkg.repo.toLowerCase().includes(needle),
    )
    .map(([id, pkg]) => ({
      id,
      kind: "bin" as const,
      console: pkg.console,
      runtime: `release ${pkg.repo}`,
    }));
  const libretro = (await libretroCatalog())
    .filter(core =>
      [core.id, core.name, core.system, core.database].some(field => field.toLowerCase().includes(needle)),
    )
    .map(core => ({
      id: core.id,
      kind: "libretro" as const,
      console: core.system,
      runtime: `libretro ${core.name}`,
    }));
  return [...cores, ...bins, ...libretro];
}

/** Compares each submodule pin with its fork's default branch. */
export async function outdated(ids?: string[]): Promise<Array<{ id: string; current: string; latest: string }>> {
  const project = await findProject().catch(() => undefined);
  const catalog = await catalogById();
  const wanted = ids?.length ? ids : (project?.manifest.cores ?? [...catalog.keys()]);
  const rows: Array<{ id: string; current: string; latest: string }> = [];
  for (const id of wanted) {
    const component = catalog.get(id);
    if (!component || component.integration !== "submodule") continue;
    const path = component.sources[0]!.path;
    const url = Bun.spawnSync(["git", "-C", repoRoot, "config", "-f", ".gitmodules", `submodule.${path}.url`])
      .stdout.toString()
      .trim();
    if (!url) continue;
    const head = Bun.spawnSync(["git", "ls-remote", url, "HEAD"]).stdout.toString().split(/\s+/)[0];
    if (head && head !== component.sourceRev)
      rows.push({
        id,
        current: component.sourceRev.slice(0, 12),
        latest: head.slice(0, 12),
      });
  }
  return rows;
}

/** Moves core pins to their fork heads: gitlink, catalog sourceRev and bep.lock together. */
export async function update(ids: string[]): Promise<Array<{ id: string; from: string; to: string }>> {
  const project = await findProject().catch(() => undefined);
  const binaries = project ? project.manifest.binaries.filter(id => !ids.length || ids.includes(id)) : [];
  const moved: Array<{ id: string; from: string; to: string }> = [];
  if (project && binaries.length) {
    const before = (await readLock(project.dir))?.binaries ?? {};
    const lock = await install({ latest: binaries });
    for (const id of binaries)
      if (before[id]?.version !== lock.binaries[id]?.version)
        moved.push({
          id,
          from: before[id]?.version ?? "",
          to: lock.binaries[id]?.version ?? "",
        });
  }
  const stale = await outdated(ids.filter(id => !binaries.includes(id)));
  if (!stale.length) return moved;
  const manifestPath = join(import.meta.dir, "..", "plugins", "consoles", "manifest.json");
  const catalog = (await Bun.file(manifestPath).json()) as {
    components: ConsoleCatalogComponent[];
  };
  for (const row of stale) {
    const component = catalog.components.find(item => item.id === row.id)!;
    const path = component.sources[0]!.path;
    const url = Bun.spawnSync(["git", "-C", repoRoot, "config", "-f", ".gitmodules", `submodule.${path}.url`])
      .stdout.toString()
      .trim();
    const head = Bun.spawnSync(["git", "ls-remote", url, "HEAD"]).stdout.toString().split(/\s+/)[0]!;
    const result = Bun.spawnSync(["git", "-C", repoRoot, "update-index", "--cacheinfo", `160000,${head},${path}`]);
    if (!result.success) throw new Error(`could not repin ${path}: ${result.stderr.toString()}`);
    moved.push({ id: row.id, from: component.sourceRev, to: head });
    component.sourceRev = head;
  }
  await Bun.write(manifestPath, `${JSON.stringify(catalog, null, 2)}\n`);
  if (await findProject().catch(() => undefined)) await install();
  return moved;
}

/** Maps a locked rom or firmware name to its store file; other arguments pass through. */
export async function resolveImage(name: string): Promise<string> {
  if (existsSync(name)) return name;
  const project = await findProject().catch(() => undefined);
  const lock = project && (await readLock(project.dir));
  const rom = lock?.roms[name];
  if (rom) return join(romStore(), rom.console, rom.file);
  const firmware = lock?.firmware[name];
  if (firmware) return join(defaultFirmwareStore(), firmware.console, firmware.file);
  return name;
}

interface RomPack {
  id: string;
  console: string;
  kind: "homebrew" | "test";
  /** Vendored source checkout holding the images. */
  source?: string;
  /** Upstream release download, verified against `sha256`; archives are unpacked. */
  url?: string;
  sha256?: string;
  glob: string;
  license: string;
}

/** Downloads a release pack into the bep cache once and returns its directory. */
async function downloadPack(pack: RomPack): Promise<string> {
  const dir = join(usrRoot(), "var", "cache", "bep", "roms", pack.id);
  const name = basename(new URL(pack.url!).pathname);
  if (existsSync(join(dir, name))) return dir;
  const response = await fetch(pack.url!, { headers: { "user-agent": "bep" } });
  if (!response.ok) throw new Error(`${pack.id}: download failed with ${response.status}`);
  const bytes = await response.bytes();
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (pack.sha256 && digest !== pack.sha256)
    throw new Error(`${pack.id}: sha256 ${digest} does not match the registry`);
  if (/\.(zip|tar|tgz|tar\.gz)$/i.test(name)) await new Bun.Archive(bytes).extract(dir);
  await Bun.write(join(dir, name), bytes);
  return dir;
}

/** Free ROMs from vendored sources or upstream releases (`bep roms [console]`), fetched on demand. */
export async function freeRoms(
  consoleName?: string,
): Promise<Array<{ pack: string; console: string; kind: string; path: string }>> {
  const file = join(import.meta.dir, "..", "plugins", "consoles", "roms.json");
  const { packs } = (await Bun.file(file).json()) as { packs: RomPack[] };
  const rows: Array<{
    pack: string;
    console: string;
    kind: string;
    path: string;
  }> = [];
  for (const pack of packs.filter(item => !consoleName || item.console === consoleName)) {
    if (pack.url) {
      const dir = await downloadPack(pack);
      for await (const path of new Bun.Glob(pack.glob).scan({
        cwd: dir,
        onlyFiles: true,
      }))
        rows.push({
          pack: pack.id,
          console: pack.console,
          kind: pack.kind,
          path: join(dir, path),
        });
      continue;
    }
    if (!pack.source) continue;
    const dir = join(repoRoot, pack.source);
    if (!existsSync(join(dir, ".git")))
      Bun.spawnSync([
        "git",
        "-C",
        repoRoot,
        "submodule",
        "update",
        "--init",
        "--recursive",
        "--depth",
        "1",
        "--",
        pack.source,
      ]);
    for await (const path of new Bun.Glob(pack.glob).scan({
      cwd: dir,
      onlyFiles: true,
    }))
      rows.push({
        pack: pack.id,
        console: pack.console,
        kind: pack.kind,
        path: join(pack.source, path),
      });
  }
  return rows;
}

export function cacheDirectories(): {
  usr: string;
  firmware: string;
  roms: string;
} {
  return { usr: usrRoot(), firmware: defaultFirmwareStore(), roms: romStore() };
}

/** Removes store images no project lock references (`bep cache prune <project-dir...>`). */
export async function pruneCache(projectDirs: string[]): Promise<string[]> {
  const keep = new Set<string>();
  for (const dir of projectDirs.length ? projectDirs : [process.cwd()]) {
    const lock = await readLock(resolve(dir));
    for (const image of [...Object.values(lock?.firmware ?? {}), ...Object.values(lock?.roms ?? {})])
      keep.add(image.sha256);
  }
  const removed: string[] = [];
  for (const store of [defaultFirmwareStore(), romStore()]) {
    if (!existsSync(store)) continue;
    for await (const path of new Bun.Glob("*/*.json").scan({
      cwd: store,
      absolute: true,
      onlyFiles: true,
    })) {
      const manifest = (await Bun.file(path).json()) as FirmwareManifest & { origin?: string };
      // Owned dumps belong to `bep owned`, never to a project lock.
      if (keep.has(manifest.sha256) || manifest.origin === "owned") continue;
      await Bun.file(join(dirname(path), manifest.file)).delete();
      await Bun.file(path).delete();
      removed.push(`${manifest.console}/${manifest.file}`);
    }
  }
  return removed;
}
