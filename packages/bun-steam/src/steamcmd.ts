// SPDX-License-Identifier: Apache-2.0
/**
 * steamcmd driver that reuses a session the owner already authenticated interactively.
 *
 * steamcmd keeps that session in `<home>/config/config.vdf` under `ConnectCache`, keyed by
 * `crc32(lowercase account name)` in hex followed by `1`. This module checks only that the key
 * exists; it never reads, prints or logs its value, never passes a password, and runs steamcmd with
 * `@NoPromptForPassword 1` and a closed stdin so a missing session fails instead of prompting.
 */
import { join } from "node:path";
import { readVdf } from "./config.js";
import { findSteamcmd } from "./paths.js";
import { kvObj } from "./vdf.js";

const STORE = ["InstallConfigStore", "Software", "Valve", "Steam"];

/** `ConnectCache` key of an account: lowercase hex CRC-32 of the lowercase name, then `1`. */
export function connectCacheKey(account: string): string {
  return `${(Bun.hash.crc32(account.toLowerCase()) >>> 0).toString(16)}1`;
}

export interface SteamcmdAccount {
  account: string;
  /** A cached session exists for this account (value never read). */
  cachedSession: boolean;
}

export interface SteamcmdStatus {
  found: boolean;
  exe: string | null;
  home: string | null;
  accounts: SteamcmdAccount[];
}

/** Accounts known to steamcmd and whether each has a reusable cached session. */
export function steamcmdStatus(explicit?: string): SteamcmdStatus {
  const loc = findSteamcmd(explicit);
  if (!loc) return { found: false, exe: null, home: null, accounts: [] };
  const store = kvObj(
    readVdf(join(loc.home, "config", "config.vdf")),
    ...STORE,
  );
  const cache = new Set(
    Object.keys(kvObj(store, "ConnectCache") ?? {}).map((k) => k.toLowerCase()),
  );
  const accounts = Object.keys(kvObj(store, "Accounts") ?? {}).map(
    (account) => ({
      account,
      cachedSession: cache.has(connectCacheKey(account)),
    }),
  );
  return { found: true, exe: loc.exe, home: loc.home, accounts };
}

/**
 * Account to log in with: `explicit`, then `STEAM_ACCOUNT`, then the only account with a cached
 * session. `anonymous` is accepted for anonymous-dispensable apps (dedicated servers, SDKs).
 */
export function pickAccount(status: SteamcmdStatus, explicit?: string): string {
  const wanted = explicit ?? process.env.STEAM_ACCOUNT;
  if (wanted === "anonymous") return wanted;
  if (wanted) {
    const hit = status.accounts.find(
      (a) => a.account.toLowerCase() === wanted.toLowerCase(),
    );
    if (!hit?.cachedSession)
      throw new Error(
        `steamcmd has no cached session for ${wanted}; sign in once interactively with steamcmd (the owner types the login)`,
      );
    return hit.account;
  }
  const cached = status.accounts.filter((a) => a.cachedSession);
  if (cached.length === 1) return cached[0]!.account;
  throw new Error(
    cached.length === 0
      ? "steamcmd has no cached session; sign in once interactively with steamcmd (the owner types the login)"
      : `several cached steamcmd sessions (${cached.map((a) => a.account).join(", ")}); pass --account`,
  );
}

/** Output lines that could carry authentication material are replaced before anyone sees them. */
const SENSITIVE =
  /password|token|auth ?code|guard|secret|two-factor|2fa|credential/i;
export const redactLine = (line: string): string =>
  SENSITIVE.test(line) ? "[bun-steam: line redacted]" : line;

export interface SteamcmdRun {
  exitCode: number;
  account: string;
  args: string[];
  lines: string[];
  /** steamcmd asked for credentials it does not have (the run was stopped, nothing prompted). */
  needsLogin: boolean;
}

export interface SteamcmdOptions {
  steamcmd?: string | undefined;
  account?: string | undefined;
  /** `+force_install_dir`, set before login as steamcmd requires. */
  installDir?: string | undefined;
  /** `+@sSteamCmdForcePlatformType` (`windows`, `linux`, `macos`). */
  platform?: string | undefined;
  timeoutMs?: number | undefined;
  onLine?: ((line: string) => void) | undefined;
}

/**
 * Runs steamcmd with the cached session and the given `+command arg...` groups, then `+quit`.
 * Example: `runSteamcmd([["app_update", "1493710", "validate"]])`.
 */
export async function runSteamcmd(
  commands: string[][],
  opts: SteamcmdOptions = {},
): Promise<SteamcmdRun> {
  const status = steamcmdStatus(opts.steamcmd);
  if (!status.found || !status.exe)
    throw new Error(
      "steamcmd not found (C:\\steamcmd\\steamcmd.exe, /usr/games/steamcmd, STEAMCMD or PATH)",
    );
  const account = pickAccount(status, opts.account);
  const args = [
    "+@ShutdownOnFailedCommand",
    "1",
    "+@NoPromptForPassword",
    "1",
    ...(opts.platform ? ["+@sSteamCmdForcePlatformType", opts.platform] : []),
    ...(opts.installDir ? ["+force_install_dir", opts.installDir] : []),
    "+login",
    account,
    ...commands.flatMap(([cmd, ...rest]) => [`+${cmd}`, ...rest]),
    "+quit",
  ];
  const proc = Bun.spawn([status.exe, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 3_600_000);
  const lines: string[] = [];
  let needsLogin = false;
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    let buf = "";
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.search(/\r?\n|\r/)) >= 0) {
        const raw = buf.slice(0, nl).trimEnd();
        buf = buf.slice(
          nl + (buf[nl] === "\r" && buf[nl + 1] === "\n" ? 2 : 1),
        );
        if (!raw) continue;
        if (
          /cached credentials not found|password:|Steam Guard code|Invalid Password/i.test(
            raw,
          )
        ) {
          needsLogin = true;
          proc.kill();
        }
        const line = redactLine(raw);
        lines.push(line);
        opts.onLine?.(line);
      }
    }
  };
  try {
    await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
    const exitCode = await proc.exited;
    return {
      exitCode: needsLogin ? 5 : exitCode,
      account,
      args: args.map((a) => (a === account ? "<account>" : a)),
      lines: lines.slice(-200),
      needsLogin,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** `app_update <appId> [-beta <branch>] [validate]` into `installDir` (or the default library). */
export function appUpdate(
  appId: number,
  opts: SteamcmdOptions & {
    validate?: boolean | undefined;
    beta?: string | undefined;
  } = {},
): Promise<SteamcmdRun> {
  const cmd = ["app_update", String(appId)];
  if (opts.beta) cmd.push("-beta", opts.beta);
  if (opts.validate) cmd.push("validate");
  return runSteamcmd([cmd], opts);
}
