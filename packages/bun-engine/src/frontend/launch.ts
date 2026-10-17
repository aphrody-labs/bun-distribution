// Launch routing: the native Bun Engine machine first, then the bep-installed release emulator
// (usr/lib/<id>), then RetroArch with a libretro core (usr/lib/libretro). Per-system defaults and
// per-game overrides live in library.db.
import { existsSync, mkdirSync } from "node:fs";
import { link } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { nativeEngine } from "../formats/tools";
import { defaultFirmwareStore, listFirmware } from "../firmware/import";
import { libretroCatalog, libretroDir } from "../libretro";
import { listInstalled, usrRoot } from "../usr";
import { defaultRoute, type Game, recordPlay } from "./library";
import { extensionOf, loadSystems, type SystemDefinition, systemById } from "./systems";

export type RouteKind = "native" | "bin" | "libretro";

export interface Route {
  id: string;
  kind: RouteKind;
  label: string;
  available: boolean;
  reason?: string;
  /** Extensions this route accepts (native machines load a subset of the system's formats). */
  extensions?: string[];
}

export interface LaunchResult {
  ok: boolean;
  game: number;
  route: string;
  command: string[];
  mode: "launch" | "check";
  pid?: number;
  exitCode?: number | null;
  alive?: boolean;
  ms: number;
  output?: string;
  error?: string;
}

function coreFile(core: string): string | undefined {
  return ["dll", "so", "dylib"]
    .map(ext => join(libretroDir(), `${core}_libretro.${ext}`))
    .find(path => existsSync(path));
}

async function installedExecutables(): Promise<Map<string, string>> {
  const rows = await listInstalled();
  return new Map(rows.map(row => [row.id, join(usrRoot(), row.exe)] as const).filter(([, exe]) => existsSync(exe)));
}

/** The BIOS the native machine boots: a firmware-store image for the system's console. */
async function nativeBios(system: SystemDefinition): Promise<string | undefined> {
  const bios = system.native?.bios;
  if (!bios) return undefined;
  const images = await listFirmware(bios.console).catch(() => []);
  const wanted = system.native!.machine === "psx" ? images.filter(image => image.bytes === 512 * 1024) : images;
  const image = wanted[0];
  return image && join(defaultFirmwareStore(), image.console, image.file);
}

/** Every route of a system in priority order, with availability on this host. */
export async function routesFor(systemId: string): Promise<Route[]> {
  const system = await systemById(systemId);
  const routes: Route[] = [];
  if (system.native) {
    const engine = nativeEngine();
    const bios = system.native.bios && (await nativeBios(system));
    const missingBios = system.native.bios?.required && !bios;
    routes.push({
      id: `native:${system.native.machine}`,
      kind: "native",
      label: `Bun Engine ${system.native.machine.toUpperCase()}`,
      available: Boolean(engine) && !missingBios,
      reason: !engine
        ? "native bun-engine is not built (target/debug or target/release)"
        : missingBios
          ? `needs a ${system.native.bios!.console} BIOS: bep add free-firmware ${system.native.bios!.freeFirmware}`
          : undefined,
      extensions: system.native.extensions,
    });
  }
  const installed = await installedExecutables();
  for (const id of system.binaries) {
    routes.push({
      id: `bin:${id}`,
      kind: "bin",
      label: id,
      available: installed.has(id),
      reason: installed.has(id) ? undefined : `not installed: bep add bin ${id}`,
    });
  }
  const retroarch = installed.get("retroarch");
  for (const core of system.libretro) {
    const file = coreFile(core);
    routes.push({
      id: `libretro:${core}`,
      kind: "libretro",
      label: `RetroArch ${core}`,
      available: Boolean(retroarch && file),
      reason: !retroarch
        ? "RetroArch is not installed: bep add bin retroarch"
        : file
          ? undefined
          : `core missing: bep add libretro ${core}`,
    });
  }
  return routes;
}

function accepts(route: Route, game: Game): boolean {
  return !route.extensions || route.extensions.includes(extensionOf(game.path));
}

/** The route a game launches with: its override, the system default, then the first available. */
export async function chooseRoute(game: Game, requested?: string): Promise<Route> {
  const routes = await routesFor(game.system);
  for (const id of [requested, game.route, defaultRoute(game.system)]) {
    if (!id) continue;
    const route = routes.find(item => item.id === id);
    if (!route) {
      if (id === requested) throw new Error(`${game.system} has no route ${id}`);
      continue;
    }
    if (route.available && accepts(route, game)) return route;
    if (id === requested)
      throw new Error(`${id} cannot launch ${basename(game.path)}: ${route.reason ?? "unsupported format"}`);
  }
  const route = routes.find(item => item.available && accepts(item, game));
  if (!route) {
    throw new Error(
      `no available route for ${game.system}: ${routes.map(item => `${item.id} (${item.reason ?? "format"})`).join("; ") || "none defined"}`,
    );
  }
  return route;
}

function substitute(args: string[], values: Record<string, string>): string[] {
  return args.map(arg => arg.replaceAll(/\{(\w+)\}/g, (_, key: string) => values[key] ?? ""));
}

/**
 * RetroArch reads BIOS from its system directory: link every firmware-store image whose MD5
 * matches a core-info requirement under the file name the core expects.
 */
async function retroarchConfig(core: string): Promise<string> {
  const system = join(usrRoot(), "share", "bun-engine", "system");
  mkdirSync(system, { recursive: true });
  const info = (await libretroCatalog()).find(item => item.id === core);
  const wanted = new Map((info?.firmware ?? []).filter(fw => fw.md5).map(fw => [fw.md5!, fw.path]));
  if (wanted.size) {
    const store = defaultFirmwareStore();
    for await (const path of new Bun.Glob("*/*").scan({
      cwd: store,
      absolute: true,
      onlyFiles: true,
    })) {
      if (path.endsWith(".json")) continue;
      const md5 = new Bun.CryptoHasher("md5").update(await Bun.file(path).bytes()).digest("hex");
      const target = wanted.get(md5);
      if (!target || existsSync(join(system, target))) continue;
      mkdirSync(dirname(join(system, target)), { recursive: true });
      await link(path, join(system, target)).catch(() => Bun.write(join(system, target), Bun.file(path)));
    }
  }
  const config = join(usrRoot(), "var", "lib", "bep", "retroarch-frontend.cfg");
  await Bun.write(
    config,
    `system_directory = "${system.replaceAll("\\", "/")}"\nlibretro_directory = "${libretroDir().replaceAll("\\", "/")}"\n`,
  );
  return config;
}

/** The command line of a route; `check` gives a bounded, non-interactive variant. */
export async function commandFor(route: Route, game: Game, check: boolean, frames: number): Promise<string[]> {
  const [kind, id] = route.id.split(":") as [RouteKind, string];
  const values = {
    file: game.path,
    dir: dirname(game.path),
    stem: basename(game.path).replace(/\.[^.]+$/, ""),
  };
  if (kind === "native") {
    const system = await systemById(game.system);
    const bios = await nativeBios(system);
    return [
      nativeEngine()!,
      "run",
      id,
      game.path,
      ...(bios ? ["--bios", bios] : []),
      ...(check ? ["--headless", "--frames", String(frames)] : []),
    ];
  }
  const installed = await installedExecutables();
  const { emulators } = await loadSystems();
  if (kind === "bin") {
    const emulator = emulators[id] ?? { args: ["{file}"], probe: ["--help"] };
    return [installed.get(id)!, ...substitute(check ? emulator.probe : emulator.args, values)];
  }
  const retroarch = emulators.retroarch!;
  const core = coreFile(id)!;
  const template = check ? (retroarch.check ?? retroarch.args) : retroarch.args;
  return [
    installed.get("retroarch")!,
    `--appendconfig=${await retroarchConfig(id)}`,
    ...substitute(template, { ...values, core }),
  ];
}

export interface RunningGame {
  pid: number;
  game: number;
  route: string;
  startedAt: string;
}

const running = new Map<number, RunningGame & { process: Bun.Subprocess }>();

export function runningGames(): RunningGame[] {
  return [...running.values()].map(({ process: _process, ...rest }) => rest);
}

export function stopGame(pid: number): boolean {
  const entry = running.get(pid);
  if (!entry) return false;
  entry.process.kill();
  return true;
}

function tail(text: string, lines = 12): string {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
}

/**
 * Starts a game. `check` runs the route bounded instead: native machines headless for `frames`
 * frames, release emulators with their probe arguments (help/version), RetroArch for a fixed
 * frame count; a GUI that is still alive at the deadline is stopped and counts as started.
 */
export async function launchGame(
  game: Game,
  options: {
    route?: string;
    check?: boolean;
    frames?: number;
    timeoutMs?: number;
  } = {},
): Promise<LaunchResult> {
  const started = performance.now();
  const mode = options.check ? "check" : "launch";
  let route: Route;
  try {
    route = await chooseRoute(game, options.route);
  } catch (error) {
    return {
      ok: false,
      game: game.id,
      route: options.route ?? "",
      command: [],
      mode,
      ms: 0,
      error: String((error as Error).message),
    };
  }
  const command = await commandFor(route, game, Boolean(options.check), options.frames ?? 120);
  const cwd = dirname(command[0]!);
  if (!options.check) {
    const child = Bun.spawn(command, {
      cwd,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    const entry = {
      pid: child.pid,
      game: game.id,
      route: route.id,
      startedAt: new Date().toISOString(),
      process: child,
    };
    running.set(child.pid, entry);
    void child.exited.then(() => running.delete(child.pid));
    recordPlay(game.id);
    return {
      ok: true,
      game: game.id,
      route: route.id,
      command,
      mode,
      pid: child.pid,
      ms: Math.round(performance.now() - started),
    };
  }
  const timeoutMs = options.timeoutMs ?? (route.kind === "bin" ? 30_000 : 120_000);
  const probeExit = route.kind === "bin" ? ((await loadSystems()).emulators[route.id.slice(4)]?.probeExit ?? [0]) : [0];
  const child = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let alive = false;
  const timer = setTimeout(() => {
    alive = true;
    child.kill();
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  const ok = route.kind === "bin" ? probeExit.includes(exitCode) || alive : exitCode === 0 && !alive;
  return {
    ok,
    game: game.id,
    route: route.id,
    command,
    mode,
    pid: child.pid,
    exitCode: alive ? null : exitCode,
    alive,
    ms: Math.round(performance.now() - started),
    output: tail(`${stdout}\n${stderr}`),
  };
}
