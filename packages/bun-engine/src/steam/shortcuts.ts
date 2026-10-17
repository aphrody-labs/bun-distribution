#!/usr/bin/env bun
// Bun Engine as non-Steam shortcuts: one "Bun Engine" entry (the frontend) and per-game entries
// from the bep library that boot the native machine with `--steam` (overlay, Rich Presence,
// Steam Input, Steam Cloud saves). `shortcuts.vdf` is binary KeyValues written through
// @aphrody/bun-steam. Artwork is real only (libretro-thumbnails matched through the
// libretro-database title, Bun's logo for the Bun Engine entry) and goes to
// `userdata/<account>/config/grid/`; slots without real art keep Steam's default.
//
// Safety: the file is only written while the Steam client is closed (`--close-steam` asks it to
// exit with `steam -shutdown` and `--restart-steam` starts it again). The original is verified to
// round-trip byte for byte, backed up, replaced atomically, re-parsed and compared, and the backup
// is deleted once the new file is verified.
//
//   bun shortcuts.ts install|uninstall|list --engine <bun-engine.exe> [--user <accountid>]
//        [--game <id> ...] [--system <id> [--limit N]] [--favorites] [--no-hub]
//        [--thumbnails <libretro-thumbnails dir>] [--steam-root DIR] [--close-steam]
//        [--restart-steam] [--dry-run]
import {
  type BinKvObject,
  isSteamRunning,
  loginUsers,
  parseShortcuts,
  resolveSteamRoot,
  userDataDirs,
  writeShortcuts,
} from "@aphrody/bun-steam";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type Route, commandFor } from "../frontend/launch";
import { type Game, gameById, gamesFor } from "../frontend/library";
import { systemById } from "../frontend/systems";
import { repoRoot } from "../usr";
import { type Artwork, bunEngineArt, libretroArt } from "./thumbnails";

const TAG = "Bun Engine";
const STEAMID64_BASE = 76561197960265728n;

interface Options {
  command: string;
  engine: string;
  user?: string;
  games: number[];
  system?: string;
  limit: number;
  favorites: boolean;
  hub: boolean;
  thumbnails?: string;
  steamRoot?: string;
  closeSteam: boolean;
  restartSteam: boolean;
  dryRun: boolean;
}

function parse(argv: string[]): Options {
  const options: Options = {
    command: argv[0] ?? "list",
    engine: "",
    games: [],
    limit: 25,
    favorites: false,
    hub: true,
    closeSteam: false,
    restartSteam: false,
    dryRun: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--engine":
        options.engine = resolve(value());
        break;
      case "--user":
        options.user = value();
        break;
      case "--game":
        options.games.push(Number(value()));
        break;
      case "--system":
        options.system = value();
        break;
      case "--limit":
        options.limit = Number(value());
        break;
      case "--favorites":
        options.favorites = true;
        break;
      case "--no-hub":
        options.hub = false;
        break;
      case "--thumbnails":
        options.thumbnails = resolve(value());
        break;
      case "--steam-root":
        options.steamRoot = value();
        break;
      case "--close-steam":
        options.closeSteam = true;
        break;
      case "--restart-steam":
        options.restartSteam = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }
  return options;
}

/** Steam's shortcut id: CRC32 of the quoted exe and the name, with the top bit set. */
export function shortcutAppId(exe: string, name: string): number {
  return (Bun.hash.crc32(`${exe}${name}`) | 0x80000000) >>> 0;
}

/** `steam://rungameid/<id>` of a shortcut. */
export const shortcutGameId = (appId: number): bigint =>
  (BigInt(appId) << 32n) | 0x02000000n;

const quote = (path: string) => `"${path}"`;
const str = (value: string) => ({ type: "string" as const, value });
const int = (value: number) => ({ type: "int32" as const, value: value | 0 });

interface Planned {
  name: string;
  exe: string;
  startDir: string;
  launch: string;
  appId: number;
  art: Artwork;
}

function entry(p: Planned, icon: string): BinKvObject {
  return {
    appid: int(p.appId),
    AppName: str(p.name),
    Exe: str(p.exe),
    StartDir: str(p.startDir),
    icon: str(icon),
    ShortcutPath: str(""),
    LaunchOptions: str(p.launch),
    IsHidden: int(0),
    AllowDesktopConfig: int(1),
    AllowOverlay: int(1),
    OpenVR: int(0),
    Devkit: int(0),
    DevkitGameID: str(""),
    DevkitOverrideAppID: int(0),
    LastPlayTime: int(0),
    FlatpakAppID: str(""),
    sortas: str(""),
    tags: { "0": str(TAG) },
  };
}

const leaf = (o: BinKvObject, key: string) => {
  const v = o[key] as { value?: unknown } | undefined;
  return v && "value" in v ? v.value : undefined;
};

const ours = (o: BinKvObject) => {
  const tags = o.tags as BinKvObject | undefined;
  return (
    !!tags &&
    Object.values(tags).some((t) => (t as { value?: unknown }).value === TAG)
  );
};

function accountDir(steamRoot: string, user?: string): string {
  const dirs = userDataDirs(steamRoot);
  if (user) {
    const dir = dirs.find((d) => basename(d) === user);
    if (!dir) throw new Error(`no userdata/${user}`);
    return dir;
  }
  const recent = loginUsers(steamRoot).find((u) => u.mostRecent);
  const account = recent
    ? String(BigInt(recent.steamId) - STEAMID64_BASE)
    : undefined;
  const dir = dirs.find((d) => basename(d) === account) ?? dirs[0];
  if (!dir) throw new Error("no Steam userdata account directory");
  return dir;
}

async function plan(options: Options): Promise<Planned[]> {
  if (!options.engine || !existsSync(options.engine))
    throw new Error(
      "--engine must name the bun-engine binary (built with --features steam)",
    );
  const planned: Planned[] = [];
  if (options.hub) {
    const bun = process.execPath;
    const exe = quote(bun);
    const cli = join(repoRoot, "packages", "bun-engine", "src", "cli.ts");
    planned.push({
      name: "Bun Engine",
      exe,
      startDir: quote(repoRoot),
      launch: `${quote(cli)} frontend`,
      appId: shortcutAppId(exe, "Bun Engine"),
      art: bunEngineArt(),
    });
  }
  let games: Game[] = options.games.map(gameById);
  if (options.system || options.favorites) {
    games.push(
      ...gamesFor(options.system)
        .filter((g) => !options.favorites || g.favorite)
        .slice(0, options.limit),
    );
  }
  games = games.filter((g, i) => games.findIndex((o) => o.id === g.id) === i);
  for (const game of games) {
    const system = await systemById(game.system);
    if (!system.native) {
      console.error(
        `skip ${game.name}: ${system.name} has no native Bun Engine machine`,
      );
      continue;
    }
    const route = {
      id: `native:${system.native.machine}`,
      kind: "native",
    } as Route;
    const command = await commandFor(route, game, false, 0);
    const exe = quote(options.engine);
    const title = game.title ?? game.name;
    const name = `${title} (${system.name})`;
    const args = [...command.slice(1), "--steam", "--steam-title", title];
    planned.push({
      name,
      exe,
      startDir: quote(dirname(options.engine)),
      launch: args.map((a) => (/[\s"]/.test(a) ? quote(a) : a)).join(" "),
      appId: shortcutAppId(exe, name),
      art: await libretroArt(game, options.thumbnails),
    });
  }
  return planned;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );

/** The AppID Steam reports as running (Windows registry), 0 when idle. */
function runningAppId(): number {
  if (process.platform !== "win32") return 0;
  const out = Bun.spawnSync([
    "reg",
    "query",
    String.raw`HKCU\Software\Valve\Steam`,
    "/v",
    "RunningAppID",
  ]);
  const hex = /RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(
    out.stdout.toString(),
  )?.[1];
  return hex ? Number.parseInt(hex, 16) : 0;
}

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (condition()) return true;
    await Bun.sleep(500);
  }
  return condition();
}

/** Copies the real artwork that exists; Steam keeps its default for the rest. */
async function writeArt(gridDir: string, p: Planned): Promise<string> {
  mkdirSync(gridDir, { recursive: true });
  const slots: [keyof Artwork, string][] = [
    ["portrait", `${p.appId}p.png`],
    ["wide", `${p.appId}.png`],
    ["hero", `${p.appId}_hero.png`],
    ["logo", `${p.appId}_logo.png`],
    ["icon", `${p.appId}_icon.png`],
  ];
  for (const [slot, name] of slots) {
    const target = join(gridDir, name);
    const source = p.art[slot];
    if (source) await Bun.write(target, Bun.file(source));
    else rmSync(target, { force: true });
  }
  return p.art.icon ? join(gridDir, `${p.appId}_icon.png`) : "";
}

function removeArt(gridDir: string, appId: number): void {
  for (const suffix of ["p.png", ".png", "_hero.png", "_logo.png", "_icon.png"])
    rmSync(join(gridDir, `${appId}${suffix}`), { force: true });
}

async function main(argv: string[]): Promise<number> {
  const options = parse(argv);
  const steamRoot = resolveSteamRoot(options.steamRoot);
  const account = accountDir(steamRoot, options.user);
  const config = join(account, "config");
  const file = join(config, "shortcuts.vdf");
  const gridDir = join(config, "grid");
  const original = existsSync(file)
    ? new Uint8Array(await Bun.file(file).arrayBuffer())
    : null;
  const current = original ? parseShortcuts(original) : {};
  if (original && !sameBytes(writeShortcuts(current), original))
    throw new Error(
      `${file} does not round-trip through the binary KeyValues writer; refusing to modify it`,
    );
  const existing = Object.values(current) as BinKvObject[];

  if (options.command === "list") {
    console.log(
      JSON.stringify(
        existing.map((e) => ({
          appId: Number(leaf(e, "appid") ?? 0) >>> 0,
          name: leaf(e, "AppName") ?? leaf(e, "appname"),
          exe: leaf(e, "Exe") ?? leaf(e, "exe"),
          launch: leaf(e, "LaunchOptions"),
          bunEngine: ours(e),
        })),
        null,
        2,
      ),
    );
    return 0;
  }
  if (options.command !== "install" && options.command !== "uninstall")
    throw new Error(`unknown command ${options.command}`);

  const planned = options.command === "install" ? await plan(options) : [];
  const kept = existing.filter((e) => !ours(e));
  const removed = existing.filter(ours);
  const report = {
    file,
    account: basename(account),
    keep: kept.length,
    replace: removed.map((e) => leaf(e, "AppName")),
    add: planned.map((p) => ({
      name: p.name,
      appId: p.appId,
      gameId: shortcutGameId(p.appId).toString(),
      launch: p.launch,
      art: p.art,
    })),
  };
  if (options.dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...report }, null, 2));
    return 0;
  }

  const steamExe = join(
    steamRoot,
    process.platform === "win32" ? "steam.exe" : "steam.sh",
  );
  let closed = false;
  if (isSteamRunning()) {
    if (!options.closeSteam)
      throw new Error(
        "Steam is running; it rewrites shortcuts.vdf on exit. Close it or pass --close-steam",
      );
    const running = runningAppId();
    if (running)
      throw new Error(
        `Steam is running AppID ${running}; not closing it during a game`,
      );
    Bun.spawnSync([steamExe, "-shutdown"]);
    if (!(await waitFor(() => !isSteamRunning(), 90_000)))
      throw new Error("Steam did not exit within 90 s; nothing was written");
    closed = true;
    await Bun.sleep(2000);
  }

  const next: BinKvObject = {};
  let index = 0;
  for (const e of kept) next[String(index++)] = e;
  for (const p of planned) {
    const icon = await writeArt(gridDir, p);
    next[String(index++)] = entry(p, icon);
  }
  const plannedIds = new Set(planned.map((p) => p.appId));
  for (const e of removed) {
    const id = Number(leaf(e, "appid") ?? 0) >>> 0;
    if (id && !plannedIds.has(id)) removeArt(gridDir, id);
  }
  const bytes = writeShortcuts(next);

  mkdirSync(config, { recursive: true });
  const backup = `${file}.bun-engine-backup`;
  if (original) await Bun.write(backup, original);
  const tmp = `${file}.bun-engine-${process.pid}`;
  await Bun.write(tmp, bytes);
  renameSync(tmp, file);
  const reread = new Uint8Array(await Bun.file(file).arrayBuffer());
  const verified =
    sameBytes(reread, bytes) &&
    Object.keys(parseShortcuts(reread)).length === index &&
    kept.every((e, i) => Bun.deepEquals(parseShortcuts(reread)[String(i)], e));
  if (!verified) {
    if (original) renameSync(backup, file);
    throw new Error(`${file} failed verification; the original was restored`);
  }
  if (original) rmSync(backup, { force: true });
  console.log(
    JSON.stringify(
      {
        ...report,
        written: bytes.length,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        verified,
        backupRemoved: !!original,
      },
      null,
      2,
    ),
  );

  if (closed && options.restartSteam) {
    // `start` / `setsid` detach Steam from this process tree.
    const argv =
      process.platform === "win32"
        ? ["cmd", "/d", "/c", "start", '""', steamExe, "-silent"]
        : ["setsid", steamExe, "-silent"];
    Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"] }).unref();
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(Bun.argv.slice(2));
  } catch (error) {
    console.error(`bun-engine shortcuts: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
