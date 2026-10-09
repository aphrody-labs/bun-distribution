#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Checkout launcher for `aphrody`: it finds the native Rust binary and runs it. The binary owns every command,
// including the Bun-owned ones (crates/infra/aphrody-command/src/multicall/bun_bridge.rs runs them through
// packages/engine/yolo/src/index.ts). apps/web is `aphrody desktop dev|build`.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const yoloEntry = join(rootDir, "packages/engine/yolo/src/index.ts");

// Generic Bun capabilities moving to the Bun fork (chantier Z1). Until Z1 lands they stay in the yolo dispatcher
// and the native binary does not serve them; this set is the only routing left in the launcher.
export const Z1_PENDING_COMMANDS: ReadonlySet<string> = new Set(["parse", "bench", "create", "rename", "verify"]);

const norm = (path: string) => resolve(path).replaceAll("\\", "/").toLowerCase();

/** True for this script, its bin/ wrappers and any TypeScript entry: running one of them would recurse. */
export function isLauncher(candidate: string, root = rootDir): boolean {
  const path = norm(candidate);
  return path.startsWith(`${norm(join(root, "bin"))}/`) || path.endsWith(".ts");
}

/** APHRODY_BIN, then target/release, then PATH without the launchers, then the user install, then target/debug. */
export function resolveRustAphrody(root = rootDir, env = process.env): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  const usable = (path: string | null | undefined): path is string =>
    !!path && !isLauncher(path, root) && existsSync(path);

  if (usable(env.APHRODY_BIN)) return env.APHRODY_BIN;
  const release = join(root, "target", "release", `aphrody${exe}`);
  if (usable(release)) return release;

  const pathDirs = (env.PATH ?? env.Path ?? "").split(process.platform === "win32" ? ";" : ":");
  for (const dir of pathDirs) {
    if (!dir) continue;
    const found = Bun.which("aphrody", { PATH: dir });
    if (usable(found)) return found;
  }

  const home =
    process.platform === "win32"
      ? join(env.LOCALAPPDATA ?? "", "Aphrody", "bin", "aphrody.exe")
      : join(env.HOME ?? "", ".aphrody", "bin", "aphrody");
  if (usable(home)) return home;
  const debug = join(root, "target", "debug", `aphrody${exe}`);
  return usable(debug) ? debug : null;
}

async function run(cmd: string[]): Promise<number> {
  const env = { ...process.env, APHRODY_ROOT: process.env.APHRODY_ROOT ?? rootDir };
  const proc = Bun.spawn(cmd, { cwd: process.cwd(), env, stdio: ["inherit", "inherit", "inherit"] });
  return proc.exited;
}

async function main(args: string[]): Promise<number> {
  if (Z1_PENDING_COMMANDS.has(args[0]?.toLowerCase() ?? "")) {
    return run([process.execPath, yoloEntry, ...args]);
  }
  const rust = resolveRustAphrody();
  if (rust === null) {
    console.error("aphrody: native binary not found (set APHRODY_BIN or run `cargo build --release -p aphrody`).");
    return 1;
  }
  return run([rust, ...args]);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
