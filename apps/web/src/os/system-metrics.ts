// SPDX-License-Identifier: Apache-2.0
/**
 * Measured host and process state for the WebOS (`GET /api/webos/system`): `node:os`, `process`, and on Linux
 * `/proc` and `/sys`. Every field is read at request time; what the host cannot provide is listed in
 * `unavailable` with the reason instead of being filled in.
 */
import os from "node:os";

export interface CpuSnapshot {
  model: string | null;
  count: number;
  /** Busy share of all cores between this request and the previous sample, 0-100. */
  usagePercent: number | null;
  /** 1, 5 and 15 minute load averages; null on Windows, where the kernel has none. */
  loadAverage: [number, number, number] | null;
}

export interface MemorySnapshot {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  process: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
}

export interface SwapDevice {
  name: string;
  type: string;
  sizeKb: number;
  usedKb: number;
  priority: number;
}

export interface LinuxSnapshot {
  /** PRETTY_NAME of /etc/os-release. */
  distribution: string | null;
  swaps: SwapDevice[];
  /** /sys/module/zswap/parameters, null when the module is absent. */
  zswap: { enabled: string; compressor: string; zpool: string } | null;
  /** Values read from /proc/sys for SYSCTL_KEYS; a key the kernel lacks is null. */
  sysctl: Record<string, string | null>;
}

export interface NetworkInterfaceSnapshot {
  name: string;
  addresses: { family: string; address: string; cidr: string | null }[];
  internal: boolean;
}

export interface SystemSnapshot {
  measuredAt: string;
  host: {
    platform: NodeJS.Platform;
    type: string;
    release: string;
    version: string;
    arch: string;
    machine: string;
    hostname: string;
    uptimeSeconds: number;
  };
  runtime: { bun: string; revision: string; pid: number; uptimeSeconds: number };
  cpu: CpuSnapshot;
  memory: MemorySnapshot;
  network: NetworkInterfaceSnapshot[];
  linux: LinuxSnapshot | null;
  unavailable: string[];
}

/** Kernel tunables shown by the kernel monitor, read-only. */
export const SYSCTL_KEYS = [
  "vm.max_map_count",
  "vm.overcommit_memory",
  "vm.swappiness",
  "fs.inotify.max_user_watches",
  "fs.inotify.max_user_instances",
  "net.core.somaxconn",
  "net.ipv4.tcp_fastopen",
  "net.core.default_qdisc",
  "net.ipv4.tcp_congestion_control",
  "kernel.perf_event_paranoid",
  "kernel.io_uring_disabled",
] as const;

type CpuTimes = { idle: number; total: number };

function cpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

let previous: CpuTimes | null = null;

/** Busy share since the previous call; the first call samples over `firstWindowMs`. */
async function cpuUsage(firstWindowMs: number): Promise<number | null> {
  if (!previous) {
    previous = cpuTimes();
    await Bun.sleep(firstWindowMs);
  }
  const now = cpuTimes();
  const total = now.total - previous.total;
  const idle = now.idle - previous.idle;
  previous = now;
  if (total <= 0) return null;
  return Math.round(((total - idle) / total) * 1000) / 10;
}

async function readText(path: string): Promise<string | null> {
  try {
    return (await Bun.file(path).text()).trim();
  } catch {
    return null;
  }
}

/** Parses /proc/swaps (header line, then `Filename Type Size Used Priority`). */
export function parseSwaps(text: string): SwapDevice[] {
  return text
    .split("\n")
    .slice(1)
    .map(line => line.trim().split(/\s+/))
    .filter(cols => cols.length >= 5)
    .map(([name, type, size, used, priority]) => ({
      name: name!,
      type: type!,
      sizeKb: Number(size),
      usedKb: Number(used),
      priority: Number(priority),
    }));
}

export function parseOsRelease(text: string): string | null {
  const line = text.split("\n").find(l => l.startsWith("PRETTY_NAME="));
  return line ? line.slice("PRETTY_NAME=".length).replace(/^"|"$/g, "") : null;
}

async function linuxSnapshot(unavailable: string[]): Promise<LinuxSnapshot> {
  const [osRelease, swaps, zEnabled, zCompressor, zPool] = await Promise.all([
    readText("/etc/os-release"),
    readText("/proc/swaps"),
    readText("/sys/module/zswap/parameters/enabled"),
    readText("/sys/module/zswap/parameters/compressor"),
    readText("/sys/module/zswap/parameters/zpool"),
  ]);
  if (swaps === null) unavailable.push("swap: /proc/swaps is not readable");
  if (zEnabled === null) unavailable.push("zswap: /sys/module/zswap is absent (module not loaded)");
  const values = await Promise.all(SYSCTL_KEYS.map(key => readText(`/proc/sys/${key.replaceAll(".", "/")}`)));
  return {
    distribution: osRelease === null ? null : parseOsRelease(osRelease),
    swaps: swaps === null ? [] : parseSwaps(swaps),
    zswap: zEnabled === null ? null : { enabled: zEnabled, compressor: zCompressor ?? "?", zpool: zPool ?? "?" },
    sysctl: Object.fromEntries(SYSCTL_KEYS.map((key, i) => [key, values[i] ?? null])),
  };
}

function network(): NetworkInterfaceSnapshot[] {
  return Object.entries(os.networkInterfaces()).map(([name, list]) => ({
    name,
    internal: (list ?? []).every(a => a.internal),
    addresses: (list ?? []).map(a => ({ family: String(a.family), address: a.address, cidr: a.cidr ?? null })),
  }));
}

export async function systemSnapshot(options: { firstCpuWindowMs?: number } = {}): Promise<SystemSnapshot> {
  const unavailable: string[] = [];
  const platform = process.platform;
  const cpus = os.cpus();
  const memory = process.memoryUsage();
  const usagePercent = await cpuUsage(options.firstCpuWindowMs ?? 200);
  if (usagePercent === null) unavailable.push("cpu usage: os.cpus() reported no time between two samples");
  if (platform === "win32") unavailable.push("load average: Windows has no load average");
  if (platform !== "linux")
    unavailable.push(`sysctl, swap, zswap, distribution: /proc and /sys exist on Linux only (host: ${platform})`);
  const total = os.totalmem();
  const free = os.freemem();
  return {
    measuredAt: new Date().toISOString(),
    host: {
      platform,
      type: os.type(),
      release: os.release(),
      version: os.version(),
      arch: os.arch(),
      machine: os.machine(),
      hostname: os.hostname(),
      uptimeSeconds: Math.floor(os.uptime()),
    },
    runtime: {
      bun: Bun.version,
      revision: Bun.revision,
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    cpu: {
      model: cpus[0]?.model?.trim() || null,
      count: cpus.length,
      usagePercent,
      loadAverage: platform === "win32" ? null : (os.loadavg() as [number, number, number]),
    },
    memory: {
      totalBytes: total,
      freeBytes: free,
      usedBytes: total - free,
      process: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
    },
    network: network(),
    linux: platform === "linux" ? await linuxSnapshot(unavailable) : null,
    unavailable,
  };
}
