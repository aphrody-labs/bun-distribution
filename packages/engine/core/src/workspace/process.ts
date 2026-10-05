// SPDX-License-Identifier: Apache-2.0
// Pure Bun.spawnSync adapters keeping standard spawnSync/execFileSync shape.

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
export interface SpawnSyncResult<T extends string | Buffer = string> {
  status: number | null;
  signal: string | null;
  stdout: T;
  stderr: T;
  error?: Error;
}

function run(cmd: string, args: readonly string[], o: SpawnSyncOptions) {
  const [i, so, se] =
    typeof o.stdio === "string"
      ? [o.stdio, o.stdio, o.stdio]
      : (o.stdio ?? ["pipe", "pipe", "pipe"]);
  const spawnOpts: Record<string, unknown> = {
    stdin: i === "pipe" ? "ignore" : i,
    stdout: so,
    stderr: se,
  };
  if (o.cwd !== undefined) spawnOpts.cwd = o.cwd;
  if (o.env !== undefined) spawnOpts.env = o.env;
  if (o.timeout !== undefined) spawnOpts.timeout = o.timeout;
  if (o.maxBuffer !== undefined) spawnOpts.maxBuffer = o.maxBuffer;
  if (o.windowsHide !== undefined) spawnOpts.windowsHide = o.windowsHide;
  return Bun.spawnSync([cmd, ...args], spawnOpts as any);
}

export function spawnSync(
  cmd: string,
  args: readonly string[] = [],
  o: SpawnSyncOptions = {},
): SpawnSyncResult {
  const text = (b: Uint8Array | undefined | null) => (b ? Buffer.from(b).toString("utf8") : "");
  try {
    const r = run(cmd, args, o);
    return {
      status: r.exitCode ?? null,
      signal: r.signalCode ?? null,
      stdout: text(r.stdout),
      stderr: text(r.stderr),
    };
  } catch (error) {
    return { status: null, signal: null, stdout: "", stderr: "", error: error as Error };
  }
}

export function execFileSync(
  cmd: string,
  args: readonly string[],
  o: SpawnSyncOptions & { encoding: "utf8" | "utf-8" },
): string;
export function execFileSync(cmd: string, args: readonly string[], o?: SpawnSyncOptions): Buffer;
export function execFileSync(
  cmd: string,
  args: readonly string[],
  o: SpawnSyncOptions = {},
): string | Buffer {
  const r = run(cmd, args, o);
  if (r.exitCode !== 0) {
    const err = new Error(
      `Command failed: ${cmd} ${args.join(" ")}\n${r.stderr ? Buffer.from(r.stderr).toString("utf8") : ""}`,
    ) as Error & { status: number | null };
    err.status = r.exitCode ?? null;
    throw err;
  }
  const out = Buffer.from(r.stdout ?? new Uint8Array());
  return o.encoding ? out.toString("utf8") : out;
}
