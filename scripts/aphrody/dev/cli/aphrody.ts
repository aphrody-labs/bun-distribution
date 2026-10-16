#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Checkout launcher for `aphrody`: resolve the native binary or the package-owned Bun dispatcher.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "../../../../docs/aphrody");
const yoloEntry = Bun.resolveSync("@aphrody/yolo-cli/cli", import.meta.dir);

// Dispatcher commands the Bun fork does not serve: `rename` adds the Aphrody preset to `bun rename`,
// `bench --supervisor` measures the yolo-runtime supervisor, `verify` runs the repository gate graph. Relayed here
// because native binaries built before multicall/bun_bridge.rs ROUTES listed them reject them.
// `parse`, `docs`, `create` are `bun parse|docs|create aphrody/<t>`.
export const RELAY_COMMANDS: ReadonlySet<string> = new Set([
  "bench",
  "rename",
  "verify",
]);

const norm = (path: string) =>
  resolve(path).replaceAll("\\", "/").toLowerCase();

/** True for this script, its wrappers and any TypeScript entry: running one of them would recurse. */
export function isLauncher(candidate: string, root = rootDir): boolean {
  const path = norm(candidate);
  return (
    path.startsWith(`${norm(join(root, "scripts/dev/cli"))}/`) ||
    path.endsWith(".ts")
  );
}

/** APHRODY_BIN, then target/release, then PATH without the launchers, then the user install, then target/debug. */
export function resolveRustAphrody(
  root = rootDir,
  env = process.env,
): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  const usable = (path: string | null | undefined): path is string =>
    !!path && !isLauncher(path, root) && existsSync(path);

  if (usable(env.APHRODY_BIN)) return env.APHRODY_BIN;
  const release = join(root, "target", "release", `aphrody${exe}`);
  if (usable(release)) return release;

  const pathDirs = (env.PATH ?? env.Path ?? "").split(
    process.platform === "win32" ? ";" : ":",
  );
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
  const env = {
    ...process.env,
    APHRODY_ROOT: process.env.APHRODY_ROOT ?? rootDir,
  };
  const proc = Bun.spawn(cmd, {
    windowsHide: true,
    cwd: process.cwd(),
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
}

async function main(args: string[]): Promise<number> {
  if (RELAY_COMMANDS.has(args[0]?.toLowerCase() ?? "")) {
    return run([process.execPath, yoloEntry, ...args]);
  }
  const rust = resolveRustAphrody();
  if (rust === null) {
    // A checkout without the native build (factory, cloud session) keeps the Bun-owned dispatcher commands.
    console.error(
      "aphrody: native binary not found (set APHRODY_BIN or run `cargo build --release -p aphrody`); using the Bun dispatcher.",
    );
    return run([process.execPath, yoloEntry, ...args]);
  }
  return run([rust, ...args]);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
