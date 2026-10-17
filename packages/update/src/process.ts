// SPDX-License-Identifier: Apache-2.0
// Bun.spawnSync adapters that keep the node:child_process spawnSync/execFileSync result shape.

type Stdio = "pipe" | "inherit" | "ignore";
export interface SpawnSyncOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  encoding?: "utf8" | "utf-8";
  timeout?: number;
  maxBuffer?: number;
  stdio?: Stdio | readonly [Stdio, Stdio, Stdio];
  shell?: false;
  windowsHide?: boolean;
}
export interface SpawnSyncResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function run(cmd: string, args: readonly string[], o: SpawnSyncOptions) {
  const [i, so, se] = typeof o.stdio === "string" ? [o.stdio, o.stdio, o.stdio] : (o.stdio ?? ["pipe", "pipe", "pipe"]);
  return Bun.spawnSync([cmd, ...args], {
    cwd: o.cwd,
    env: o.env as Record<string, string> | undefined,
    timeout: o.timeout,
    maxBuffer: o.maxBuffer,
    stdin: i === "pipe" ? "ignore" : i,
    stdout: so,
    stderr: se,
    windowsHide: o.windowsHide ?? true,
  });
}

export function spawnSync(cmd: string, args: readonly string[] = [], o: SpawnSyncOptions = {}): SpawnSyncResult {
  try {
    const r = run(cmd, args, o);
    return {
      status: r.exitCode ?? null,
      signal: r.signalCode == null ? null : String(r.signalCode),
      stdout: r.stdout?.toString() ?? "",
      stderr: r.stderr?.toString() ?? "",
    };
  } catch (error) {
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: error as Error,
    };
  }
}

/** Throws on spawn failure or non-zero exit like node's execFileSync; returns a Buffer unless encoding is set. */
export function execFileSync(
  cmd: string,
  args: readonly string[],
  o: SpawnSyncOptions & { encoding: "utf8" | "utf-8" },
): string;
export function execFileSync(cmd: string, args: readonly string[], o?: SpawnSyncOptions): Buffer;
export function execFileSync(cmd: string, args: readonly string[], o: SpawnSyncOptions = {}): string | Buffer {
  const r = run(cmd, args, o);
  if (r.exitCode !== 0) {
    const err = new Error(`Command failed: ${cmd} ${args.join(" ")}\n${r.stderr?.toString() ?? ""}`) as Error & {
      status: number | null;
    };
    err.status = r.exitCode ?? null;
    throw err;
  }
  const out = r.stdout ?? Buffer.alloc(0);
  return o.encoding ? out.toString() : out;
}

/** Spawn options with `windowsHide: true` unless the caller overrides it (no console window on Windows). */
export function hidden<T extends { windowsHide?: boolean }>(options?: T): T & { windowsHide: boolean } {
  return { windowsHide: true, ...options } as T & { windowsHide: boolean };
}
