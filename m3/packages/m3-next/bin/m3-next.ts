#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Run Next.js 16 on Bun with no Node on the machine:
//
//   m3-next dev | build | start [next arguments]        (in the Aphrody checkout: yolo m3 next ...)
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

/**
 * This Bun. A compiled program hosting the runner (`yolo m3 next` from a compiled yolo) is not `bun` itself, so the `bun`
 * on PATH stands in for it.
 */
export function bunExecutable(): string {
  const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/");
  return compiled ? (Bun.which("bun") ?? process.execPath) : process.execPath;
}

/** Directory holding a `node` that is this Bun, created on first use (and repaired when it points elsewhere). */
export function bunNodeShim(
  dir: string = join(tmpdir(), `m3-next-bun-node-${process.getuid?.() ?? 0}`),
): string {
  const bun = bunExecutable();
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
    cmd: [bunExecutable(), "--bun", nextBin(cwd), ...args],
    env: {
      ...process.env,
      PATH: `${shim}${delimiter}${process.env["PATH"] ?? ""}`,
      NEXT_TELEMETRY_DISABLED: process.env["NEXT_TELEMETRY_DISABLED"] ?? "1",
    },
  };
}

/** `m3-next <argv>` (`yolo m3 next <argv>`): runs the app's Next and resolves to its exit status. */
export async function runM3Next(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(
      "usage: m3-next <dev|build|start|...> [next arguments]\nRuns the app's Next.js on Bun, Turbopack workers included.",
    );
    return argv.length === 0 ? 2 : 0;
  }
  const { cmd, env } = nextCommand(argv);
  const child = Bun.spawn(cmd, { env, stdio: ["inherit", "inherit", "inherit"] });
  return await child.exited;
}

if (import.meta.main) process.exit(await runM3Next(process.argv.slice(2)));
