// SPDX-License-Identifier: Apache-2.0
/**
 * Thin launcher: a kit exe started by a double click opens its route in the Aphrody desktop app when that app is
 * installed (`aphrody-app aphrody://<route>`; a running instance receives the link through single-instance) and
 * otherwise keeps its console menu. `--console` or `APHRODY_KIT_CONSOLE=1` forces the menu.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Env = Record<string, string | undefined>;

const BINARY = "aphrody-app";

/** Install locations of the desktop app, most specific first (NSIS per-user, MSI per-machine, Linux and macOS). */
export function desktopCandidates(
  env: Env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const out: string[] = [];
  if (env.APHRODY_DESKTOP_BIN) out.push(env.APHRODY_DESKTOP_BIN);
  if (platform === "win32") {
    if (env.LOCALAPPDATA) out.push(join(env.LOCALAPPDATA, "aphrody", `${BINARY}.exe`));
    if (env.ProgramFiles) out.push(join(env.ProgramFiles, "aphrody", `${BINARY}.exe`));
  } else if (platform === "darwin") {
    out.push("/Applications/aphrody.app/Contents/MacOS/aphrody-app");
  } else {
    out.push("/usr/bin/aphrody-app");
    if (env.HOME) out.push(join(env.HOME, ".local", "bin", BINARY));
  }
  return out;
}

export function findDesktop(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
  which: (name: string) => string | null = Bun.which,
): string | undefined {
  return (
    desktopCandidates(env, platform).find((path) => exists(path)) ?? which(BINARY) ?? undefined
  );
}

export function consoleForced(argv: string[], env: Env): boolean {
  return argv.includes("--console") || env.APHRODY_KIT_CONSOLE === "1";
}

/**
 * Open `aphrody://<route>` in the desktop app. Returns false (the caller shows its menu) when the app is not
 * installed or does not start.
 */
export function openInDesktop(
  route: string,
  env: Env = process.env,
  spawn: (argv: string[]) => boolean = detachedSpawn,
): boolean {
  const app = findDesktop(env);
  if (!app) return false;
  return spawn([app, `aphrody://${route}`]);
}

function detachedSpawn(argv: string[]): boolean {
  try {
    const child = Bun.spawn(argv, {
      windowsHide: true,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
