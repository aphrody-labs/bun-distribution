#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Locate Ghidra's headless launcher (`support/analyzeHeadless.bat` on Windows,
 * `support/analyzeHeadless` elsewhere) and print its absolute path.
 *
 * Order: `GHIDRA_INSTALL_DIR`, `GHIDRA_HOME`, the usual install roots of the platform, versioned
 * `ghidra*` directories inside them (newest name first), then `PATH`.
 *
 * Usage: bun find-ghidra.ts
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const WINDOWS = process.platform === "win32";
export const LAUNCHER = WINDOWS ? "analyzeHeadless.bat" : "analyzeHeadless";

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `<root>/support/<launcher>` when it exists. */
export function launcherIn(root: string | undefined): string | undefined {
  if (!root) return undefined;
  const launcher = join(root, "support", LAUNCHER);
  return existsSync(launcher) ? resolve(launcher) : undefined;
}

/** Install roots searched after the environment, per platform. */
export function searchRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.USERPROFILE ?? env.HOME ?? homedir();
  if (WINDOWS) {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      join(home, "ghidra"),
      join(local, "Programs", "ghidra"),
      "C:\\ghidra",
      "C:\\Tools\\ghidra",
      join(env.ProgramFiles ?? "C:\\Program Files", "ghidra"),
      join(home, "Tools", "ghidra"),
      home,
      join(home, "Tools"),
      join(local, "Programs"),
      "C:\\",
      "C:\\Tools",
      env.ProgramFiles ?? "C:\\Program Files",
    ];
  }
  return [
    "/opt/homebrew/Caskroom/ghidra",
    "/usr/local/Caskroom/ghidra",
    "/opt/ghidra",
    "/usr/local/ghidra",
    join(home, "ghidra"),
    join(home, "Applications", "ghidra"),
    "/Applications/ghidra",
    "/usr/share/ghidra",
    "/usr/local/share/ghidra",
    "/opt",
    "/usr/local",
    home,
    join(home, "Applications"),
    "/Applications",
  ];
}

function children(dir: string, pattern?: RegExp): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => !pattern || pattern.test(name))
      .toSorted()
      .toReversed()
      .map((name) => join(dir, name))
      .filter(isDir);
  } catch {
    return [];
  }
}

/** The root itself, then `ghidra*` children, then Homebrew-style `<version>/ghidra*` grandchildren. */
function launcherUnder(root: string): string | undefined {
  if (!isDir(root)) return undefined;
  const direct = launcherIn(root);
  if (direct) return direct;
  for (const child of children(root, /^ghidra/i)) {
    const hit = launcherIn(child);
    if (hit) return hit;
  }
  if (/caskroom[\\/]ghidra$/i.test(root)) {
    for (const version of children(root))
      for (const install of children(version, /^ghidra/i)) {
        const hit = launcherIn(install);
        if (hit) return hit;
      }
  }
  return undefined;
}

/** The headless launcher path, or `undefined` when Ghidra is not installed. */
export function findAnalyzeHeadless(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const variable of ["GHIDRA_INSTALL_DIR", "GHIDRA_HOME"]) {
    const hit = launcherIn(env[variable]);
    if (hit) return hit;
  }
  for (const root of searchRoots(env)) {
    const hit = launcherUnder(root);
    if (hit) return hit;
  }
  return Bun.which(LAUNCHER, { PATH: env.PATH ?? "" }) ?? undefined;
}

if (import.meta.main) {
  const found = findAnalyzeHeadless();
  if (found) {
    console.log(found);
  } else {
    console.error(
      `Could not find Ghidra's ${LAUNCHER}. Set GHIDRA_INSTALL_DIR (or GHIDRA_HOME) to the Ghidra install root, or install Ghidra to one of: ${searchRoots().join("; ")}.`,
    );
    process.exitCode = 1;
  }
}
