// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable eslint/no-await-in-loop -- sampling is serial on purpose */
// Shared helpers of the m3 + yolo benchmark harness (see run.ts): sampling, statistics, the budget comparison.
import { cpus, loadavg, release, totalmem } from "node:os";

export type Unit = "ms" | "B" | "count";

/** One measured quantity. `value` is the headline: the p50 of the samples for timings, the exact figure otherwise. */
export interface Metric {
  value: number;
  unit: Unit;
  n?: number;
  min?: number;
  p95?: number;
  max?: number;
}

export interface Env {
  date: string;
  bun: string;
  kernel: string;
  wsl: boolean;
  cpu: string;
  cores: number;
  memMiB: number;
  loadStart: number[];
  loadEnd: number[];
  repos: Record<string, string>;
}

export interface Snapshot {
  schema: "m3-bench/1";
  /** Timings are the best p50 of this many complete runs (1 = a single run). */
  repeat: number;
  env: Env;
  metrics: Record<string, Metric>;
  /** Equivalence gates: strings that must be identical before and after a change. */
  gates: Record<string, string>;
  /** Measurements that could not be taken, with the reason. */
  errors: Record<string, string>;
}

export interface BudgetEntry {
  value: number;
  unit: Unit;
  /** The figure measured before the fixes (informational). */
  baseline?: number;
}

export interface Budget {
  schema: "m3-bench-budget/1";
  /** Allowed relative regression (0.1 = 10%). */
  tolerance: number;
  note?: string;
  env?: Partial<Env>;
  metrics: Record<string, BudgetEntry>;
}

export interface BudgetRow {
  key: string;
  unit: Unit;
  budget: number;
  actual: number | undefined;
  /** actual / budget. */
  ratio: number | undefined;
  ok: boolean;
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

const round = (n: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Distribution of samples; the headline `value` is the p50. */
export function summarize(samples: readonly number[], unit: Unit = "ms"): Metric {
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    value: round(percentile(sorted, 50)),
    unit,
    n: sorted.length,
    min: round(sorted[0]!),
    p95: round(percentile(sorted, 95)),
    max: round(sorted[sorted.length - 1]!),
  };
}

export const exact = (value: number, unit: Unit): Metric => ({ value, unit });

/** Run `fn` `warmup` times unrecorded, then `runs` times; the samples are what `fn` returns (ms). */
export async function sample(fn: () => Promise<number> | number, runs: number, warmup = 0): Promise<number[]> {
  for (let i = 0; i < warmup; i++) await fn();
  const out: number[] = [];
  for (let i = 0; i < runs; i++) out.push(await fn());
  return out;
}

export interface Spawned {
  ms: number;
  code: number;
  out: string;
}

/** Spawn synchronously and time it; stdout and stderr are captured (not timed separately). */
export function spawnTimed(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Spawned {
  const started = performance.now();
  const proc = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const ms = performance.now() - started;
  return { ms, code: proc.exitCode ?? 1, out: `${proc.stdout}${proc.stderr}` };
}

/** Time the first line printed on stdout by a long-running process, then stop it. */
export async function timeToFirstLine(
  cmd: string[],
  opts: { cwd?: string; stdin?: string; env?: Record<string, string> } = {},
): Promise<{ ms: number; line: string }> {
  const started = performance.now();
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdin: opts.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  if (opts.stdin !== undefined) {
    proc.stdin!.write(opts.stdin);
    proc.stdin!.flush();
  }
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  const ms = performance.now() - started;
  proc.kill();
  await proc.exited;
  return { ms, line: buf.split("\n")[0] ?? "" };
}

/** Bytes of a directory tree (apparent size, hard links counted once per `du` run). */
export function dirBytes(dir: string): number {
  const proc = Bun.spawnSync(["du", "-sb", dir], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return Number(proc.stdout.toString().split(/\s/)[0]) || 0;
}

export function gitHead(dir: string): string {
  const proc = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--short", "HEAD"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : "unknown";
}

export async function readEnv(repos: Record<string, string>): Promise<Env> {
  const info = await Bun.file("/proc/cpuinfo")
    .text()
    .catch(() => "");
  const model = /model name\s*:\s*(.+)/.exec(info)?.[1] ?? cpus()[0]?.model ?? "unknown";
  const version = await Bun.file("/proc/version")
    .text()
    .catch(() => "");
  return {
    date: new Date().toISOString(),
    bun: Bun.version,
    kernel: release(),
    wsl: /microsoft/i.test(version),
    cpu: model,
    cores: cpus().length,
    memMiB: Math.round(totalmem() / 1048576),
    loadStart: loadavg().map(n => round(n, 2)),
    loadEnd: [],
    repos: Object.fromEntries(Object.entries(repos).map(([name, dir]) => [name, gitHead(dir)])),
  };
}

/** Compare measured metrics with a budget: lower is better, a metric fails when it exceeds `budget * (1 + tolerance)`. */
export function compareBudget(
  budget: Budget,
  metrics: Record<string, Metric>,
  tolerance: number = budget.tolerance,
): BudgetRow[] {
  return Object.entries(budget.metrics).map(([key, entry]) => {
    const actual = metrics[key]?.value;
    const ratio =
      actual === undefined
        ? undefined
        : entry.value === 0
          ? actual === 0
            ? 1
            : Number.POSITIVE_INFINITY
          : actual / entry.value;
    return {
      key,
      unit: entry.unit,
      budget: entry.value,
      actual,
      ratio,
      ok: actual !== undefined && actual <= entry.value * (1 + tolerance),
    };
  });
}

/** The group (key prefix before the first dot) of a metric key. */
export const groupOf = (key: string): string => key.split(".")[0]!;

export function formatValue(value: number | undefined, unit: Unit): string {
  if (value === undefined || Number.isNaN(value)) return "n/a";
  if (unit === "B") {
    if (value >= 1048576) return `${(value / 1048576).toFixed(2)} MiB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${value} B`;
  }
  if (unit === "ms")
    return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(value < 10 ? 2 : 1)} ms`;
  return String(value);
}

export const pct = (before: number | undefined, after: number | undefined): string => {
  if (before === undefined || after === undefined) return "n/a";
  if (before === 0) return after === 0 ? "0%" : "new";
  const d = ((after - before) / before) * 100;
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
};
