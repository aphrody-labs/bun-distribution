// SPDX-License-Identifier: Apache-2.0
//! Idle footprint of a Linux desktop executable: CPU of the whole process tree and of its main thread,
//! proportional set size (PSS) of the tree, time to the first mapped window and, for the CEF runtime, time
//! to the first contentful paint. The method of the research note of 2026-10-05
//! (docs/research/web/tauri-cef-native-performance-2026-10-05.md, section 6): the numbers it produces are
//! recorded in MEMORY.md, not in the note.
//!
//!   bun scripts/audit/desktop-footprint.ts --exe <path> [--label <name>] [--runs 5] [--settle 8] [--idle 60]
//!                                          [--cdp-port 9333] [--strace-secs 10] [--json <file>]
//!
//! A display is required (`DISPLAY`); without one an Xvfb server is started and stopped by the run. Under
//! Xvfb the GPU path is software: CPU and PSS are meaningful for the event loop and process model, the
//! rendering figures are not GPU figures. `--cdp-port` sets `APHRODY_CEF_REMOTE_DEBUGGING_PORT` (a CEF
//! `aphrody-app`) so the first contentful paint can be read; a runtime without DevTools reports `null`.
//! `APHRODY_CEF_UNSAFE_NO_SANDBOX=1` is set for containers and servers that offer no Chromium sandbox.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const TICKS =
  Number(spawnSync("getconf", ["CLK_TCK"], { windowsHide: true }).stdout.toString().trim()) || 100;

export interface Run {
  /** ms from spawn to the first window mapped for the process tree (xdotool), `null` when none appeared. */
  windowMapMs: number | null;
  /** ms from spawn to the first contentful paint of the first page target (CEF only). */
  firstContentfulPaintMs: number | null;
  processes: number;
  /** CPU of the whole process tree over the idle window, percent of one core. */
  treeCpuPercent: number;
  /** CPU of the main thread of the root process over the idle window, percent of one core. */
  mainThreadCpuPercent: number;
  pssStartMiB: number;
  pssEndMiB: number;
  /** `ppoll` calls of the root process over `--strace-secs`, `null` when strace cannot attach. */
  ppollCalls: number | null;
}

export interface Summary {
  median: number | null;
  min: number | null;
  max: number | null;
}

const num = (value: string | undefined): number => Number(value ?? 0) || 0;

/** `pid` and every descendant, from /proc (a child of a killed parent is reparented, so walk by ppid). */
export function processTree(root: number): number[] {
  const parents = new Map<number, number>();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      // The command name may contain spaces and parentheses: split after the last ")".
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      parents.set(Number(name), Number(rest[1]));
    } catch {
      /* the process exited */
    }
  }
  const tree = [root];
  for (let i = 0; i < tree.length; i++) {
    for (const [pid, parent] of parents)
      if (parent === tree[i] && !tree.includes(pid)) tree.push(pid);
  }
  return tree.filter((pid) => parents.has(pid));
}

/** utime + stime in clock ticks of one `/proc/<pid>/stat` or `/proc/<pid>/task/<tid>/stat`. */
export function cpuTicks(path: string): number {
  try {
    const stat = readFileSync(path, "utf8");
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return num(rest[11]) + num(rest[12]);
  } catch {
    return 0;
  }
}

export function treeTicks(pids: number[]): number {
  return pids.reduce((sum, pid) => sum + cpuTicks(`/proc/${pid}/stat`), 0);
}

/** Sum of `Pss:` over the tree, in MiB. `smaps_rollup` needs the same user, which a child always is. */
export function treePssMiB(pids: number[]): number {
  let kib = 0;
  for (const pid of pids) {
    try {
      const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
      kib += num(/^Pss:\s+(\d+) kB/m.exec(rollup)?.[1]);
    } catch {
      /* exited or not readable */
    }
  }
  return Math.round((kib / 1024) * 10) / 10;
}

export function summarize(values: readonly (number | null)[]): Summary {
  const sorted = values
    .filter((value): value is number => value !== null)
    .toSorted((a, b) => a - b);
  if (sorted.length === 0) return { median: null, min: null, max: null };
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return { median, min: sorted[0]!, max: sorted.at(-1)! };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** First contentful paint as ms after `startedAt` (epoch ms), read over the DevTools protocol. */
async function firstContentfulPaint(port: number, startedAt: number): Promise<number | null> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
        type: string;
        url: string;
        webSocketDebuggerUrl?: string;
      }[];
      const page = targets.find(
        (target) =>
          target.type === "page" && target.webSocketDebuggerUrl && !target.url.includes("view="),
      );
      if (page?.webSocketDebuggerUrl) {
        const value = await evaluate(
          page.webSocketDebuggerUrl,
          "(() => { const p = performance.getEntriesByName('first-contentful-paint')[0]; return p ? performance.timeOrigin + p.startTime : null })()",
        );
        if (typeof value === "number") return Math.round(value - startedAt);
      }
    } catch {
      /* the DevTools server is not up yet */
    }
    await sleep(250);
  }
  return null;
}

function evaluate(url: string, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("devtools timeout"));
    }, 5000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: { result?: { value?: unknown } };
      };
      if (message.id === 1) {
        clearTimeout(timer);
        socket.close();
        resolve(message.result?.result?.value);
      }
    };
    socket.onerror = () => reject(new Error("devtools socket error"));
  });
}

function windowMapped(pids: number[]): boolean {
  for (const pid of pids) {
    const found = spawnSync("xdotool", ["search", "--onlyvisible", "--pid", String(pid)], {
      windowsHide: true,
    });
    if (found.status === 0 && found.stdout.toString().trim() !== "") return true;
  }
  return false;
}

function ppollCalls(pid: number, seconds: number): number | null {
  const run = spawnSync("strace", ["-c", "-p", String(pid), "-e", "trace=ppoll"], {
    windowsHide: true,
    timeout: (seconds + 5) * 1000,
    killSignal: "SIGINT",
    env: process.env,
  });
  // `-c` prints its table on stderr after the SIGINT that ends the attachment.
  const text = run.stderr.toString();
  if (/Operation not permitted|ptrace/i.test(text) && !/calls/.test(text)) return null;
  const row = /^\s*[\d.]+\s+[\d.]+\s+\d+\s+(\d+)\s+(?:\d+\s+)?ppoll/m.exec(text);
  return row ? Number(row[1]) : 0;
}

async function measureOnce(options: Options): Promise<Run> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    APHRODY_CEF_UNSAFE_NO_SANDBOX: process.env["APHRODY_CEF_UNSAFE_NO_SANDBOX"] ?? "1",
  };
  if (options.cdpPort !== undefined)
    env["APHRODY_CEF_REMOTE_DEBUGGING_PORT"] = String(options.cdpPort);
  const startedAt = Date.now();
  const child = spawn(options.exe, [], {
    windowsHide: true,
    env,
    stdio: "ignore",
    detached: false,
  });
  const pid = child.pid!;
  let windowMapMs: number | null = null;
  const paint =
    options.cdpPort === undefined
      ? Promise.resolve(null)
      : firstContentfulPaint(options.cdpPort, startedAt);
  const deadline = startedAt + 60_000;
  while (Date.now() < deadline && windowMapMs === null) {
    if (windowMapped(processTree(pid))) windowMapMs = Date.now() - startedAt;
    else await sleep(50);
  }
  const firstContentfulPaintMs = await paint;
  await sleep(options.settleSeconds * 1000);
  const before = processTree(pid);
  const ticksStart = treeTicks(before);
  const mainStart = cpuTicks(`/proc/${pid}/task/${pid}/stat`);
  const pssStartMiB = treePssMiB(before);
  const t0 = performance.now();
  await sleep(options.idleSeconds * 1000);
  const seconds = (performance.now() - t0) / 1000;
  const after = processTree(pid);
  const treeCpuPercent = ((treeTicks(after) - ticksStart) / TICKS / seconds) * 100;
  const mainThreadCpuPercent =
    ((cpuTicks(`/proc/${pid}/task/${pid}/stat`) - mainStart) / TICKS / seconds) * 100;
  const pssEndMiB = treePssMiB(after);
  const polls = options.straceSeconds > 0 ? ppollCalls(pid, options.straceSeconds) : null;
  const processes = processTree(pid).length;
  child.kill("SIGTERM");
  await sleep(1500);
  for (const stray of processTree(pid)) {
    try {
      process.kill(stray, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  return {
    windowMapMs,
    firstContentfulPaintMs,
    processes,
    treeCpuPercent: Math.round(treeCpuPercent * 10) / 10,
    mainThreadCpuPercent: Math.round(mainThreadCpuPercent * 10) / 10,
    pssStartMiB,
    pssEndMiB,
    ppollCalls: polls,
  };
}

interface Options {
  exe: string;
  label: string;
  runs: number;
  settleSeconds: number;
  idleSeconds: number;
  straceSeconds: number;
  cdpPort?: number;
  json?: string;
}

function parseArgs(argv: readonly string[]): Options {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const exe = value("exe");
  if (!exe)
    throw new Error(
      "usage: desktop-footprint.ts --exe <path> [--label n] [--runs 5] [--settle 8] [--idle 60] [--cdp-port p] [--strace-secs 10] [--json file]",
    );
  const cdp = value("cdp-port");
  return {
    exe,
    label: value("label") ?? exe,
    runs: Number(value("runs") ?? 5),
    settleSeconds: Number(value("settle") ?? 8),
    idleSeconds: Number(value("idle") ?? 60),
    straceSeconds: Number(value("strace-secs") ?? 10),
    ...(cdp === undefined ? {} : { cdpPort: Number(cdp) }),
    ...(value("json") === undefined ? {} : { json: value("json")! }),
  };
}

if (import.meta.main) {
  const options = parseArgs(Bun.argv.slice(2));
  let xvfb: ReturnType<typeof spawn> | undefined;
  if (!process.env["DISPLAY"]) {
    const display = ":93";
    xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x800x24"], {
      windowsHide: true,
      stdio: "ignore",
    });
    process.env["DISPLAY"] = display;
    await sleep(1500);
  }
  const runs: Run[] = [];
  try {
    for (let i = 0; i < options.runs; i++) {
      const run = await measureOnce(options);
      runs.push(run);
      console.error(`run ${i + 1}/${options.runs}: ${JSON.stringify(run)}`);
    }
  } finally {
    xvfb?.kill("SIGTERM");
  }
  const field = (pick: (run: Run) => number | null) => summarize(runs.map(pick));
  const report = {
    schema: "aphrody.desktop-footprint/1",
    label: options.label,
    exe: options.exe,
    display: process.env["DISPLAY"],
    runs: options.runs,
    idleSeconds: options.idleSeconds,
    windowMapMs: field((run) => run.windowMapMs),
    firstContentfulPaintMs: field((run) => run.firstContentfulPaintMs),
    processes: field((run) => run.processes),
    treeCpuPercent: field((run) => run.treeCpuPercent),
    mainThreadCpuPercent: field((run) => run.mainThreadCpuPercent),
    pssStartMiB: field((run) => run.pssStartMiB),
    pssEndMiB: field((run) => run.pssEndMiB),
    ppollCalls: field((run) => run.ppollCalls),
    samples: runs,
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.json) writeFileSync(options.json, text);
  console.log(text);
}
