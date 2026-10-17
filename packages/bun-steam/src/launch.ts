// SPDX-License-Identifier: Apache-2.0
/**
 * Game launch and Proton launch tuning: `steam://rungameid/<id>`, the environment a gaming
 * session should export (ntsync, DXVK/vkd3d-proton/Mesa caches, llvmpipe threads, official
 * anti-cheat runtimes) and per-game Steam launch options in `localconfig.vdf`.
 */
import { existsSync, readdirSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import {
  isSteamRunning,
  readVdf,
  type ChangePlan,
  writeVdf,
} from "./config.js";
import { ANTI_CHEAT_RUNTIMES } from "./proton.js";
import {
  compatToolDirs,
  IS_WINDOWS,
  norm,
  resolveSteamRoot,
  userDataDirs,
} from "./paths.js";
import { kvEnsure, kvKey, kvObj, kvStr } from "./vdf.js";

/** `steam://rungameid/<appId>`; `appId` must be a decimal Steam app or shortcut game id. */
export function rungameidUri(appId: number | string): string {
  if (!/^\d+$/.test(String(appId)))
    throw new Error(`invalid Steam app id: ${appId}`);
  return `steam://rungameid/${appId}`;
}

/** Only `steam://` URIs without quotes or control characters reach the shell. */
export const isSafeSteamUri = (uri: string): boolean =>
  uri.startsWith("steam://") && !/["\p{Cc}]/u.test(uri);

/** Opens a `steam://` URI through the running client (`start` on Windows, `steam`/`xdg-open` on Linux). */
export async function openSteamUri(
  uri: string,
): Promise<{ uri: string; exitCode: number }> {
  if (!isSafeSteamUri(uri))
    throw new Error(`refusing unsafe Steam URI: ${uri}`);
  const cmd = IS_WINDOWS
    ? ["cmd.exe", "/d", "/c", "start", "", uri]
    : Bun.which("steam")
      ? ["steam", uri]
      : ["xdg-open", uri];
  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  // `steam <uri>` hands the URI to the running client and returns; do not wait on a cold start.
  const exitCode = await Promise.race([
    proc.exited,
    Bun.sleep(10_000).then(() => 0),
  ]);
  return { uri, exitCode };
}

export interface TuningOptions {
  steamRoot?: string | undefined;
  /** Shader/pipeline cache root (`BUN_STEAM_CACHE`, default `$XDG_CACHE_HOME/bun-steam`). */
  cacheDir?: string | undefined;
  /** Software rendering host (llvmpipe/lavapipe): `auto` = no `/dev/dri/renderD*`. */
  llvmpipe?: boolean | "auto" | undefined;
  /** llvmpipe/lavapipe worker threads (default: every logical core). */
  threads?: number | undefined;
  /** Directory holding `eac/` and `battleye/` runtimes (`installAntiCheatRuntimes`). */
  runtimesDir?: string | undefined;
}

export interface Tuning {
  env: Record<string, string>;
  /** Command wrapper placed before `%command%` (`gamemoderun` when installed). */
  wrapper: string[];
  notes: string[];
}

const hasRenderNode = (): boolean => {
  try {
    return readdirSync("/dev/dri").some((d) => d.startsWith("renderD"));
  } catch {
    return false;
  }
};

/** Launch environment for Proton games on this host. Windows hosts get an empty tuning. */
export function launchTuning(opts: TuningOptions = {}): Tuning {
  const notes: string[] = [];
  if (IS_WINDOWS)
    return {
      env: {},
      wrapper: [],
      notes: ["Proton tuning applies to Linux hosts"],
    };
  const env: Record<string, string> = {};
  if (existsSync("/dev/ntsync")) env.PROTON_USE_NTSYNC = "1";
  else
    notes.push(
      "no /dev/ntsync: load the ntsync module (Proton 11 falls back to fsync)",
    );
  const cache = norm(
    opts.cacheDir ??
      process.env.BUN_STEAM_CACHE ??
      join(
        process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
        "bun-steam",
      ),
  );
  env.DXVK_STATE_CACHE_PATH = `${cache}/dxvk`;
  env.VKD3D_SHADER_CACHE_PATH = `${cache}/vkd3d`;
  env.MESA_SHADER_CACHE_DIR = `${cache}/mesa`;
  env.MESA_SHADER_CACHE_MAX_SIZE = "16G";
  const llvmpipe =
    opts.llvmpipe === undefined || opts.llvmpipe === "auto"
      ? !hasRenderNode()
      : opts.llvmpipe;
  if (llvmpipe) {
    env.LP_NUM_THREADS = String(opts.threads ?? availableParallelism());
    notes.push("no GPU render node: llvmpipe/lavapipe on every core");
  }
  const extra = compatToolDirs(opts.steamRoot ?? resolveSteamRoot()).filter(
    (d) => existsSync(d),
  );
  if (extra.length) env.STEAM_EXTRA_COMPAT_TOOLS_PATHS = extra.join(":");
  if (opts.runtimesDir)
    for (const [key, rt] of Object.entries(ANTI_CHEAT_RUNTIMES))
      if (existsSync(join(opts.runtimesDir, key, ".complete")))
        env[rt.env] = norm(join(opts.runtimesDir, key));
  const wrapper = Bun.which("gamemoderun") ? ["gamemoderun"] : [];
  if (!wrapper.length) notes.push("gamemode not installed");
  return { env, wrapper, notes };
}

/** Steam launch options string: `KEY=value ... gamemoderun %command%`. */
export function launchOptionsString(t: Tuning): string {
  const env = Object.entries(t.env)
    .filter(([k]) => k !== "STEAM_EXTRA_COMPAT_TOOLS_PATHS")
    .map(([k, v]) => `${k}=${/\s/.test(v) ? JSON.stringify(v) : v}`);
  return [...env, ...t.wrapper, "%command%"].join(" ");
}

const APPS = ["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"];

/** Current `LaunchOptions` of a game for every local Steam user. */
export function readLaunchOptions(
  appId: string,
  steamRoot = resolveSteamRoot(),
) {
  return userDataDirs(steamRoot).map((dir) => {
    const file = join(dir, "config", "localconfig.vdf");
    const value = kvStr(kvObj(readVdf(file), ...APPS, appId), "LaunchOptions");
    return { file: norm(file), launchOptions: value };
  });
}

/** Sets a game's `LaunchOptions` for every local Steam user (Steam must be closed). */
export function setLaunchOptions(
  appId: string,
  options: string,
  opts: { steamRoot?: string; dryRun?: boolean; force?: boolean } = {},
): ChangePlan[] {
  const steamRoot = opts.steamRoot ?? resolveSteamRoot();
  if (!opts.dryRun && !opts.force && isSteamRunning())
    throw new Error(
      "Steam is running and rewrites localconfig.vdf on exit; close it first (or pass --force)",
    );
  return userDataDirs(steamRoot).flatMap((dir) => {
    const file = join(dir, "config", "localconfig.vdf");
    const doc = readVdf(file);
    if (!doc) return [];
    const app = kvEnsure(doc, ...APPS, appId);
    const key = kvKey(app, "LaunchOptions") ?? "LaunchOptions";
    const from = typeof app[key] === "string" ? (app[key] as string) : null;
    const plan: ChangePlan = {
      file: norm(file),
      changes: [{ key: `apps/${appId}/LaunchOptions`, from, to: options }],
      applied: false,
    };
    if (from === options || opts.dryRun) return [plan];
    app[key] = options;
    writeVdf(file, doc);
    plan.applied = true;
    return [plan];
  });
}
