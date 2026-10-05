#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Run Next.js 16 on Bun with no Node on the machine:
//
//   m3-next dev | build | start [next arguments]
//
// `bun --bun next ...` makes Next itself run on Bun, but Turbopack spawns `node` for the PostCSS and loader workers and
// finds the system one (or none). This runner puts a `node` that is Bun first on PATH, so the whole build, Turbopack
// workers included, runs on one runtime: no `--webpack` fallback needed.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/** Directory holding a `node` that is this Bun, created on first use (and repaired when it points elsewhere). */
export function bunNodeShim(
  dir: string = join(tmpdir(), `m3-next-bun-node-${process.getuid?.() ?? 0}`),
): string {
  const bun = process.execPath;
  const link = join(dir, process.platform === "win32" ? "node.exe" : "node");
  mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    if (!existsSync(link)) copyFileSync(bun, link);
    return dir;
  }
  try {
    if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === bun) return dir;
    unlinkSync(link);
  } catch {
    // Absent: create it below.
  }
  symlinkSync(bun, link);
  return dir;
}

/** The `next` CLI of the app in `cwd` (resolved from the app, so the version the app installed runs). */
export function nextBin(cwd: string = process.cwd()): string {
  const manifest = createRequire(join(cwd, "package.json")).resolve("next/package.json");
  return join(dirname(manifest), "dist", "bin", "next");
}

export interface NextCommand {
  cmd: string[];
  env: Record<string, string | undefined>;
}

/** The process to spawn for `m3-next <args>`: this Bun running the app's `next`, with the Bun `node` first on PATH. */
export function nextCommand(
  args: string[],
  cwd: string = process.cwd(),
  shim: string = bunNodeShim(),
): NextCommand {
  return {
    cmd: [process.execPath, "--bun", nextBin(cwd), ...args],
    env: {
      ...process.env,
      PATH: `${shim}${delimiter}${process.env["PATH"] ?? ""}`,
      NEXT_TELEMETRY_DISABLED: process.env["NEXT_TELEMETRY_DISABLED"] ?? "1",
    },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    console.log(
      "usage: m3-next <dev|build|start|...> [next arguments]\nRuns the app's Next.js on Bun, Turbopack workers included.",
    );
    process.exit(args.length === 0 ? 2 : 0);
  }
  const { cmd, env } = nextCommand(args);
  const child = Bun.spawn(cmd, { env, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await child.exited);
}
