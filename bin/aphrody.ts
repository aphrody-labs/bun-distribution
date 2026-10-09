#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Checkout launcher for `aphrody`: the native Rust binary owns every command it implements; this script only adds
// `webos` (apps/web) and forwards the commands that exist solely in the yolo Bun CLI (packages/engine/yolo).

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const yoloEntry = join(rootDir, "packages/engine/yolo/src/index.ts");

// Commands of packages/engine/yolo/src/index.ts that the Rust binary does not implement. Commands both know
// (n2b, web, docs, version, doctor, scan, mcp, runtime, awesome, google, git, ssh, infra, train) stay with Rust;
// packages/engine/yolo/test/aphrody-launcher.test.ts keeps this list in step with the yolo dispatcher.
export const YOLO_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "status",
  "generate",
  "parse",
  "bench",
  "desktop",
  "tauri",
  "ai",
  "tool",
  "api",
  "serve",
  "desktop-runtime",
  "upgrade",
  "uninstall",
  "create",
  "import",
  "rename",
  "plugin",
  "vu",
  "py",
  "python",
  "uv",
  "workflow",
  "ship",
  "hooks",
  "ops",
  "workspace",
  "optimize",
  "update",
  "doc-ai",
  "browser",
  "forge",
  "m3",
  "host",
  "verify",
]);

export const RUST_OWNED_SHARED_COMMANDS: ReadonlySet<string> = new Set([
  "n2b",
  "web",
  "docs",
  "version",
  "--version",
  "-v",
  "doctor",
  "scan",
  "mcp",
  "runtime",
  "awesome",
  "google",
  "git",
  "ssh",
  "infra",
  "train",
  "help",
  "--help",
  "-h",
]);

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

async function run(cmd: string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  const proc = Bun.spawn(cmd, { cwd: process.cwd(), env, stdio: ["inherit", "inherit", "inherit"] });
  return proc.exited;
}

async function main(args: string[]): Promise<number> {
  const command = args[0]?.toLowerCase() ?? "";

  if (command === "webos") {
    const build = args[1]?.toLowerCase() === "build";
    const script = join(rootDir, "apps/web", build ? "build.ts" : "server.ts");
    return run([process.execPath, script, ...args.slice(build ? 2 : 1)], {
      ...process.env,
      PORT: process.env.PORT ?? "3000",
    });
  }

  if (YOLO_ONLY_COMMANDS.has(command)) {
    return run([process.execPath, yoloEntry, ...args]);
  }

  const rust = resolveRustAphrody();
  if (rust === null) {
    console.error("aphrody: native binary not found (set APHRODY_BIN or run `cargo build --release -p aphrody`).");
    return 1;
  }
  const status = await run([rust, ...args]);
  if (command === "" || command === "help" || command === "--help" || command === "-h") {
    console.log(
      "\nCheckout launcher additions:\n  webos [build]   Serve apps/web (PORT, default 3000) or build it\n" +
        `  ${[...YOLO_ONLY_COMMANDS].join(", ")}\n                  Forwarded to the yolo Bun CLI (packages/engine/yolo)`,
    );
  }
  return status;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
