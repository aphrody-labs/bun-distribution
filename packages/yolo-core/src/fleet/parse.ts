/**
 * Pure parsers and analysis for `yolo host`: no I/O, every function takes the text a Linux tool printed
 * and returns typed data, so they are unit-tested against captured outputs (test/host.test.ts).
 *
 * The collector (host.ts) runs one read-only script that prints `@@@ <section>` headers; each section
 * is the plain output of one standard tool (lsblk, df, swapon, systemctl, ps, ss, ...).
 */

import { DEFAULT_MIN_FREE, spaceGate } from "./space";

export type HostName = "vps" | "dbfr" | "local" | (string & {});

// ---------------------------------------------------------------------------------------- formatting

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const text = i === 0 ? String(Math.round(v)) : v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${n < 0 ? "-" : ""}${text} ${UNITS[i]}`;
}

/**
 * "1.5G" / "512M" (journald, binary) and "1.2GB" / "340kB" (docker, decimal) to bytes.
 * Returns 0 for unparseable text so a missing tool never turns into a bogus finding.
 */
export function parseSize(text: string): number {
  const m = /^\s*([\d.]+)\s*([a-zA-Z]*)/.exec(text);
  if (m === null) return 0;
  const value = Number.parseFloat(m[1] as string);
  const unit = (m[2] as string).toLowerCase();
  if (Number.isNaN(value)) return 0;
  const exp = "kmgtp".indexOf(unit[0] ?? "") + 1;
  const decimal = unit.endsWith("b") && unit.length === 2;
  if (unit === "" || unit === "b") return Math.round(value);
  return Math.round(value * (decimal ? 1000 : 1024) ** exp);
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

// ----------------------------------------------------------------------------------------- sections

/** Split `@@@ name` delimited collector output into a name -> text map. */
export function parseSections(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name: string | null = null;
  let lines: string[] = [];
  const flush = (): void => {
    if (name !== null) out[name] = lines.join("\n");
  };
  for (const line of output.split("\n")) {
    const m = /^@@@ (\S+)\s*$/.exec(line);
    if (m !== null) {
      flush();
      name = m[1] as string;
      lines = [];
    } else lines.push(line);
  }
  flush();
  return out;
}

export function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// ------------------------------------------------------------------------------------------- lsblk

export interface BlockDevice {
  readonly name: string;
  readonly path: string;
  readonly type: string;
  readonly size: number;
  readonly fstype: string | null;
  readonly fsused: number | null;
  readonly fsavail: number | null;
  readonly mountpoints: readonly string[];
  readonly label: string | null;
  readonly uuid: string | null;
  readonly ro: boolean;
  readonly rm: boolean;
  readonly rota: boolean;
  readonly pkname: string | null;
  readonly model: string | null;
}

export const LSBLK_COLUMNS =
  "NAME,KNAME,PATH,TYPE,SIZE,FSTYPE,FSUSED,FSAVAIL,MOUNTPOINTS,LABEL,UUID,RO,RM,ROTA,PKNAME,MODEL";

const bool = (v: unknown): boolean => v === true || v === "1" || v === 1 || v === "true";
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** `lsblk -J -b -o LSBLK_COLUMNS`: the device tree flattened (children follow their parent). */
export function parseLsblk(json: string): BlockDevice[] {
  if (json.trim() === "") return [];
  const root = JSON.parse(json) as { blockdevices?: unknown[] };
  const out: BlockDevice[] = [];
  const walk = (nodes: unknown[]): void => {
    for (const raw of nodes) {
      const n = raw as Record<string, unknown>;
      const mp = Array.isArray(n["mountpoints"]) ? (n["mountpoints"] as unknown[]) : [];
      const name = String(n["name"] ?? "");
      out.push({
        name,
        path: str(n["path"]) ?? `/dev/${name}`,
        type: String(n["type"] ?? ""),
        size: num(n["size"]),
        fstype: str(n["fstype"]),
        fsused: n["fsused"] === null || n["fsused"] === undefined ? null : num(n["fsused"]),
        fsavail: n["fsavail"] === null || n["fsavail"] === undefined ? null : num(n["fsavail"]),
        mountpoints: mp.filter((x): x is string => typeof x === "string" && x !== ""),
        label: str(n["label"]),
        uuid: str(n["uuid"]),
        ro: bool(n["ro"]),
        rm: bool(n["rm"]),
        rota: bool(n["rota"]),
        pkname: str(n["pkname"]),
        model: str(n["model"]),
      });
      if (Array.isArray(n["children"])) walk(n["children"] as unknown[]);
    }
  };
  walk(root.blockdevices ?? []);
  return out;
}

export type DiskState = "system" | "mounted" | "unmounted-data" | "unmounted-raw" | "swap";

export interface DiskReport {
  readonly name: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly model: string | null;
  readonly rotational: boolean;
  readonly removable: boolean;
  readonly state: DiskState;
  readonly mountedAt: readonly string[];
  readonly filesystems: readonly {
    readonly path: string;
    readonly fstype: string;
    readonly label: string | null;
    readonly uuid: string | null;
    readonly sizeBytes: number;
    readonly usedBytes: number | null;
    readonly mounted: boolean;
  }[];
  /** True when the disk holds a filesystem or a volume layer that may contain data: never format it. */
  readonly holdsData: boolean;
  /** the disk and every partition or volume on it */
  readonly devicePaths: readonly string[];
  /** disk size not covered by any partition (never formatted or allocated by yolo) */
  readonly unallocatedBytes: number;
  readonly note: string;
}

const NOT_DISKS = new Set(["loop", "rom", "ram"]);
const isZram = (d: BlockDevice): boolean => d.name.startsWith("zram");

/** Disks with their descendants, and whether an UNMOUNTED disk already carries a filesystem. */
export function classifyDisks(devs: readonly BlockDevice[]): DiskReport[] {
  const out: DiskReport[] = [];
  for (const [i, disk] of devs.entries()) {
    if (disk.type !== "disk" || NOT_DISKS.has(disk.type) || isZram(disk)) continue;
    // descendants follow the parent in the flattened tree; stop at the next top-level device (pkname null)
    const family: BlockDevice[] = [disk];
    const names = new Set([disk.name]);
    for (const d of devs.slice(i + 1)) {
      if (d.pkname === null || !names.has(d.pkname)) {
        if (d.pkname === null) break;
        continue;
      }
      names.add(d.name);
      family.push(d);
    }
    const mounts = family.flatMap(d => d.mountpoints);
    const real = mounts.filter(m => m !== "[SWAP]");
    const fsList = family
      .filter(d => d.fstype !== null && d.fstype !== "swap")
      .map(d => ({
        path: d.path,
        fstype: d.fstype as string,
        label: d.label,
        uuid: d.uuid,
        sizeBytes: d.size,
        usedBytes: d.fsused,
        mounted: d.mountpoints.some(m => m !== "[SWAP]"),
      }));
    const hasSwap = family.some(d => d.fstype === "swap" || d.mountpoints.includes("[SWAP]"));
    const isSystem = real.some(m => m === "/" || m === "/boot" || m.startsWith("/boot/"));
    let state: DiskState;
    let note: string;
    if (isSystem) {
      state = "system";
      note = "carries the running system";
    } else if (real.length > 0) {
      state = "mounted";
      const idle = fsList.filter(f => !f.mounted);
      note = `mounted at ${real.join(", ")}${idle.length > 0 ? `; UNMOUNTED but holding data: ${idle.map(f => `${f.path} (${f.fstype})`).join(", ")}` : ""}`;
    } else if (fsList.length > 0) {
      state = "unmounted-data";
      note = `UNMOUNTED but already holds ${fsList.map(f => f.fstype).join(", ")}: contains data, never format; inspect read-only with \`yolo host mount\``;
    } else if (hasSwap) {
      state = "swap";
      note = "used as swap";
    } else {
      state = "unmounted-raw";
      note = "no filesystem detected (may still hold raw data or a partition table): never wiped by yolo";
    }
    const parts = family.filter(d => d !== disk && d.type === "part");
    const allocated = parts.reduce((n, d) => n + d.size, 0);
    out.push({
      name: disk.name,
      path: disk.path,
      unallocatedBytes: parts.length > 0 ? Math.max(0, disk.size - allocated) : 0,
      sizeBytes: disk.size,
      model: disk.model,
      rotational: disk.rota,
      removable: disk.rm,
      state,
      mountedAt: real,
      filesystems: fsList,
      holdsData: state === "unmounted-data" || fsList.length > 0,
      devicePaths: family.map(d => d.path),
      note,
    });
  }
  return out;
}

// ------------------------------------------------------------------------------- df / swap / memory

export interface FsUsage {
  readonly filesystem: string;
  readonly type: string;
  readonly sizeBytes: number;
  readonly usedBytes: number;
  readonly availBytes: number;
  readonly usePercent: number;
  readonly mount: string;
  /** false for tmpfs, squashfs, overlay and other pseudo or read-only image filesystems */
  readonly real: boolean;
  readonly inodes?: {
    readonly total: number;
    readonly used: number;
    readonly usePercent: number;
  };
}

const PSEUDO_FS = new Set([
  "tmpfs",
  "devtmpfs",
  "squashfs",
  "overlay",
  "efivarfs",
  "ramfs",
  "proc",
  "sysfs",
  "cgroup2",
  "fuse.lxcfs",
]);

/** `df -PT -B1` */
export function parseDf(text: string): FsUsage[] {
  const out: FsUsage[] = [];
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 7) continue;
    const type = f[1] as string;
    out.push({
      filesystem: f[0] as string,
      type,
      sizeBytes: num(f[2]),
      usedBytes: num(f[3]),
      availBytes: num(f[4]),
      usePercent: num((f[5] as string).replace("%", "")),
      mount: f.slice(6).join(" "),
      real: !PSEUDO_FS.has(type),
    });
  }
  return out;
}

/** `df -Pi`: merged into the byte usage by mount point. */
export function mergeInodes(fs: readonly FsUsage[], text: string): FsUsage[] {
  const byMount = new Map<string, { total: number; used: number; usePercent: number }>();
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6) continue;
    byMount.set(f.slice(5).join(" "), {
      total: num(f[1]),
      used: num(f[2]),
      usePercent: num((f[4] as string).replace("%", "")),
    });
  }
  return fs.map(x => {
    const inodes = byMount.get(x.mount);
    return inodes === undefined ? x : { ...x, inodes };
  });
}

export interface SwapDevice {
  readonly name: string;
  readonly type: string;
  readonly sizeBytes: number;
  readonly usedBytes: number;
  readonly priority: number;
}

/** `swapon --noheadings --raw --bytes --show=NAME,TYPE,SIZE,USED,PRIO` (a header line is tolerated) */
export function parseSwapon(text: string): SwapDevice[] {
  const out: SwapDevice[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[0] === "NAME") continue;
    out.push({
      name: f[0] as string,
      type: f[1] as string,
      sizeBytes: num(f[2]),
      usedBytes: num(f[3]),
      priority: num(f[4]),
    });
  }
  return out;
}

export interface ZramDevice {
  readonly name: string;
  readonly diskSizeBytes: number;
  readonly dataBytes: number;
  readonly compressedBytes: number;
  readonly algorithm: string;
}

/** `zramctl --noheadings --raw --bytes -o NAME,DISKSIZE,DATA,COMPR,ALGORITHM` */
export function parseZramctl(text: string): ZramDevice[] {
  const out: ZramDevice[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[0] === "NAME") continue;
    out.push({
      name: f[0] as string,
      diskSizeBytes: num(f[1]),
      dataBytes: num(f[2]),
      compressedBytes: num(f[3]),
      algorithm: f[4] as string,
    });
  }
  return out;
}

export interface Memory {
  readonly totalBytes: number;
  readonly availableBytes: number;
  readonly cachedBytes: number;
  readonly swapTotalBytes: number;
  readonly swapFreeBytes: number;
}

export function parseMeminfo(text: string): Memory {
  const kb: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m !== null) kb[m[1] as string] = Number.parseInt(m[2] as string, 10) * 1024;
  }
  return {
    totalBytes: kb["MemTotal"] ?? 0,
    availableBytes: kb["MemAvailable"] ?? kb["MemFree"] ?? 0,
    cachedBytes: kb["Cached"] ?? 0,
    swapTotalBytes: kb["SwapTotal"] ?? 0,
    swapFreeBytes: kb["SwapFree"] ?? 0,
  };
}

// ------------------------------------------------------------------------------------------ systemd

export interface Unit {
  readonly name: string;
  readonly load: string;
  readonly active: string;
  readonly sub: string;
  readonly description: string;
}

/** `systemctl list-units --no-legend --plain --no-pager` */
export function parseUnits(text: string): Unit[] {
  const out: Unit[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[\s●*×]+/u, "");
    const f = line.split(/\s+/);
    if (f.length < 4 || !/\.[a-z]+$/.test(f[0] as string)) continue;
    out.push({
      name: f[0] as string,
      load: f[1] as string,
      active: f[2] as string,
      sub: f[3] as string,
      description: f.slice(4).join(" "),
    });
  }
  return out;
}

export interface Timer {
  readonly unit: string;
  readonly activates: string;
}

/** `systemctl list-timers --all --no-legend --no-pager`: the last two columns are UNIT and ACTIVATES. */
export function parseTimers(text: string): Timer[] {
  const out: Timer[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 2) continue;
    const unit = f[f.length - 2] as string;
    if (unit.endsWith(".timer")) out.push({ unit, activates: f[f.length - 1] as string });
  }
  return out;
}

// -------------------------------------------------------------------------------------- processes

export interface Proc {
  readonly pid: number;
  readonly ppid: number;
  readonly rssBytes: number;
  readonly cpuPercent: number;
  readonly elapsedSecs: number;
  readonly stat: string;
  readonly user: string;
  readonly args: string;
  readonly kernel: boolean;
}

/** `ps -eo pid=,ppid=,rss=,pcpu=,etimes=,stat=,user:32=,args=` */
export function parsePs(text: string): Proc[] {
  const out: Proc[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (m === null) continue;
    const pid = Number.parseInt(m[1] as string, 10);
    const ppid = Number.parseInt(m[2] as string, 10);
    const rss = Number.parseInt(m[3] as string, 10) * 1024;
    const args = (m[8] as string).trim();
    out.push({
      pid,
      ppid,
      rssBytes: rss,
      cpuPercent: Number.parseFloat(m[4] as string),
      elapsedSecs: Number.parseInt(m[5] as string, 10),
      stat: m[6] as string,
      user: m[7] as string,
      args,
      kernel: pid === 2 || ppid === 2 || (rss === 0 && args.startsWith("[") && args.endsWith("]")),
    });
  }
  return out;
}

export interface ProcSummary {
  readonly total: number;
  readonly kernel: number;
  readonly userland: number;
  readonly zombies: number;
  readonly byUser: Readonly<Record<string, number>>;
  readonly topRss: readonly {
    pid: number;
    user: string;
    rssBytes: number;
    command: string;
  }[];
}

export function summarizeProcs(procs: readonly Proc[], top = 8): ProcSummary {
  const userland = procs.filter(p => !p.kernel);
  const byUser: Record<string, number> = {};
  for (const p of userland) byUser[p.user] = (byUser[p.user] ?? 0) + 1;
  return {
    total: procs.length,
    kernel: procs.length - userland.length,
    userland: userland.length,
    zombies: procs.filter(p => p.stat.startsWith("Z")).length,
    byUser,
    topRss: [...userland]
      .toSorted((a, b) => b.rssBytes - a.rssBytes)
      .slice(0, top)
      .map(p => ({
        pid: p.pid,
        user: p.user,
        rssBytes: p.rssBytes,
        command: p.args.length > 100 ? `${p.args.slice(0, 97)}...` : p.args,
      })),
  };
}

const BUILD_COMMS = new Set([
  "cargo",
  "rustc",
  "cc1",
  "cc1plus",
  "ninja",
  "make",
  "cmake",
  "clang",
  "clang++",
  "gcc",
  "g++",
  "ld",
  "ld.lld",
  "lld",
  "mold",
  "zig",
  "tsc",
  "tsgo",
]);

/** A process that is compiling or installing, so the paths it works in must not be touched. */
export function isBuildProcess(p: Proc): boolean {
  if (p.kernel) return false;
  const first = p.args.split(/\s+/)[0] ?? "";
  const comm = first.slice(first.lastIndexOf("/") + 1);
  if (BUILD_COMMS.has(comm)) return true;
  if (comm === "bun" || comm === "bunx" || comm === "npm" || comm === "pnpm" || comm === "yarn") {
    return /\s(build|install|add|i|ci)(\s|$)/.test(p.args) || /\srun\s+build/.test(p.args);
  }
  return false;
}

export interface BuildProc {
  readonly pid: number;
  readonly user: string;
  readonly command: string;
  readonly cwd: string | null;
}

/** `<pid> <cwd>` lines (the collector's `cwds` section). */
export function parseCwds(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf(" ");
    if (i > 0) out.set(Number.parseInt(line.slice(0, i), 10), line.slice(i + 1));
  }
  return out;
}

export function findBuildProcs(
  procs: readonly Proc[],
  cwds: ReadonlyMap<number, string>,
  selfPid?: number,
): BuildProc[] {
  return procs
    .filter(p => p.pid !== selfPid && isBuildProcess(p))
    .map(p => ({
      pid: p.pid,
      user: p.user,
      command: p.args.slice(0, 120),
      cwd: cwds.get(p.pid) ?? null,
    }));
}

// ------------------------------------------------------------------------------------------- ports

export interface Listener {
  readonly proto: string;
  readonly address: string;
  readonly port: number;
  readonly process: string | null;
  readonly pid: number | null;
  /** reachable from outside the host (wildcard bind) */
  readonly exposed: boolean;
}

/** `ss -H -tulnp` */
export function parseSs(text: string): Listener[] {
  const out: Listener[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5) continue;
    const local = f[4] as string;
    const i = local.lastIndexOf(":");
    if (i < 0) continue;
    const port = Number.parseInt(local.slice(i + 1), 10);
    if (Number.isNaN(port)) continue;
    const address = local.slice(0, i).replace(/%.*$/, "");
    const proc = /\(\("([^"]+)",pid=(\d+)/.exec(line);
    out.push({
      proto: f[0] as string,
      address,
      port,
      process: proc?.[1] ?? null,
      pid: proc === null ? null : Number.parseInt(proc[2] as string, 10),
      exposed: address === "*" || address === "0.0.0.0" || address === "[::]",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------- du / docker / io

export function parseDu(text: string): { path: string; bytes: number }[] {
  const out: { path: string; bytes: number }[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\d+)\s+(\/.*)$/.exec(line);
    if (m !== null)
      out.push({
        bytes: Number.parseInt(m[1] as string, 10),
        path: m[2] as string,
      });
  }
  return out;
}

export interface DockerUsage {
  readonly type: string;
  readonly total: number;
  readonly active: number;
  readonly sizeBytes: number;
  readonly reclaimableBytes: number;
}

/** `docker system df --format '{{json .}}'` */
export function parseDockerDf(text: string): DockerUsage[] {
  const out: DockerUsage[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const j = JSON.parse(line) as Record<string, string>;
      out.push({
        type: String(j["Type"] ?? ""),
        total: num(j["TotalCount"]),
        active: num(j["Active"]),
        sizeBytes: parseSize(String(j["Size"] ?? "")),
        reclaimableBytes: parseSize(String(j["Reclaimable"] ?? "")),
      });
    } catch {
      // not JSON: ignore the line
    }
  }
  return out;
}

/** "Archived and active journals take up 1.2G in the file system." */
export function parseJournalUsage(text: string): number {
  const m = /take up ([\d.]+\s*[KMGTP]?)(?:B)?\b/i.exec(text);
  return m === null ? 0 : parseSize(m[1] as string);
}

// ------------------------------------------------------------------------------------ locks / probes

export interface LockState {
  readonly path: string;
  readonly state: "held" | "free" | "absent";
  readonly pids: readonly number[];
}

/** `<path>|held|pid,pid,` lines from the collector (inode matched against /proc/locks on the host). */
export function parseLocks(text: string): LockState[] {
  const out: LockState[] = [];
  for (const line of text.split("\n")) {
    const f = line.split("|");
    if (f.length < 2 || !(f[1] === "held" || f[1] === "free" || f[1] === "absent")) continue;
    out.push({
      path: f[0] as string,
      state: f[1],
      pids: (f[2] ?? "")
        .split(",")
        .filter(x => x !== "")
        .map(x => Number.parseInt(x, 10)),
    });
  }
  return out;
}

export interface Artifact {
  readonly path: string;
  readonly bytes: number;
  readonly marker: string;
  readonly recent: boolean;
}

/** `<bytes>|<marker>|recent|old|<path>` lines from the artifact probe. */
export function parseArtifacts(text: string): Artifact[] {
  const out: Artifact[] = [];
  for (const line of text.split("\n")) {
    const f = line.split("|");
    if (f.length < 4 || !/^\d*$/.test(f[0] as string) || !(f[2] === "recent" || f[2] === "old")) continue;
    out.push({
      bytes: Number.parseInt((f[0] as string) || "0", 10),
      marker: f[1] as string,
      recent: f[2] === "recent",
      path: f.slice(3).join("|"),
    });
  }
  return out;
}

export interface SwapFile {
  readonly path: string;
  readonly bytes: number;
  readonly swapSignature: boolean;
  readonly inFstab: boolean;
}

/** `<bytes>|<SWAPSPACE2 or ->|<fstab or ->|<path>` */
export function parseSwapFiles(text: string): SwapFile[] {
  const out: SwapFile[] = [];
  for (const line of text.split("\n")) {
    const f = line.split("|");
    if (f.length < 4 || !/^\d+$/.test(f[0] as string)) continue;
    out.push({
      bytes: Number.parseInt(f[0] as string, 10),
      swapSignature: f[1] === "SWAPSPACE2",
      inFstab: f[2] === "fstab",
      path: f.slice(3).join("|"),
    });
  }
  return out;
}

/** `<bytes>|<path>` */
export function parseCacheDirs(text: string): { path: string; bytes: number }[] {
  const out: { path: string; bytes: number }[] = [];
  for (const line of text.split("\n")) {
    const i = line.indexOf("|");
    if (i > 0 && /^\d+$/.test(line.slice(0, i)))
      out.push({
        bytes: Number.parseInt(line.slice(0, i), 10),
        path: line.slice(i + 1),
      });
  }
  return out;
}

export interface Metrics {
  readonly at: string;
  readonly freeBytes: Readonly<Record<string, number>>;
  readonly memAvailableBytes: number;
  readonly swapTotalBytes: number;
  readonly swapFreeBytes: number;
  readonly load1: number;
}

/** `key=value` lines: mem_available, swap_total, swap_free, load1, free:<path> */
export function parseMetrics(text: string, at = new Date().toISOString()): Metrics {
  const kv = parseKeyValues(text);
  const free: Record<string, number> = {};
  for (const [k, v] of Object.entries(kv)) if (k.startsWith("free:")) free[k.slice(5)] = num(v);
  return {
    at,
    freeBytes: free,
    memAvailableBytes: num(kv["mem_available"]),
    swapTotalBytes: num(kv["swap_total"]),
    swapFreeBytes: num(kv["swap_free"]),
    load1: num(kv["load1"]),
  };
}

// ------------------------------------------------------------------------------------------ audit

export interface Identity {
  readonly user: string;
  readonly uid: number;
  readonly home: string;
  readonly hostname: string;
  readonly kernel: string;
  readonly os: string;
  readonly uptimeSecs: number;
  readonly cpus: number;
  readonly load: readonly [number, number, number];
  /** can run privileged commands (root, or passwordless sudo) */
  readonly privileged: boolean;
  readonly tools: Readonly<Record<string, boolean>>;
}

export function parseIdentity(text: string): Identity {
  const kv = parseKeyValues(text);
  const load = (kv["loadavg"] ?? "").split(/\s+/).map(Number);
  const tools: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(kv)) if (k.startsWith("tool.")) tools[k.slice(5)] = v === "yes";
  return {
    user: kv["user"] ?? "",
    uid: num(kv["uid"]),
    home: kv["home"] ?? "",
    hostname: kv["hostname"] ?? "",
    kernel: kv["kernel"] ?? "",
    os: kv["os"] ?? "",
    uptimeSecs: num(kv["uptime"]),
    cpus: num(kv["cpus"]) || 1,
    load: [num(load[0]), num(load[1]), num(load[2])],
    privileged: kv["uid"] === "0" || kv["sudo"] === "yes",
    tools,
  };
}

export interface Audit {
  readonly host: HostName;
  readonly collectedAt: string;
  readonly identity: Identity;
  readonly memory: Memory;
  readonly disks: readonly DiskReport[];
  readonly filesystems: readonly FsUsage[];
  readonly mounts: readonly {
    target: string;
    source: string;
    fstype: string;
    options: string;
  }[];
  readonly swap: {
    readonly devices: readonly SwapDevice[];
    readonly zram: readonly ZramDevice[];
  };
  readonly services: {
    readonly running: readonly Unit[];
    readonly failed: readonly Unit[];
  };
  readonly timers: readonly Timer[];
  readonly cron: {
    readonly files: readonly string[];
    readonly userEntries: number;
  };
  readonly ports: readonly Listener[];
  readonly processes: ProcSummary;
  readonly docker: {
    readonly available: boolean;
    readonly usage: readonly DockerUsage[];
  };
  readonly biggest: readonly { path: string; bytes: number }[];
  readonly locks: readonly LockState[];
  readonly buildProcs: readonly BuildProc[];
  readonly reclaim: {
    readonly aptCacheBytes: number;
    readonly journalBytes: number;
    readonly rotatedLogs: { readonly count: number; readonly bytes: number };
    readonly artifacts: readonly Artifact[];
    readonly swapFiles: readonly SwapFile[];
    readonly cacheDirs: readonly { path: string; bytes: number }[];
  };
}

export function parseMounts(text: string): Audit["mounts"] {
  const out: {
    target: string;
    source: string;
    fstype: string;
    options: string;
  }[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(" ");
    if (f.length >= 4)
      out.push({
        target: f[0] as string,
        source: f[1] as string,
        fstype: f[2] as string,
        options: f[3] as string,
      });
  }
  return out;
}

export function parseCron(text: string): Audit["cron"] {
  const files: string[] = [];
  let userEntries = 0;
  let inUser = false;
  for (const line of text.split("\n")) {
    if (line === "## user") {
      inUser = true;
      continue;
    }
    if (line.trim() === "") continue;
    if (inUser) {
      if (!line.trim().startsWith("#")) userEntries++;
    } else files.push(line.trim());
  }
  return { files, userEntries };
}

/** Everything the collector printed, as typed data. */
export function buildAudit(host: HostName, output: string, collectedAt = new Date().toISOString()): Audit {
  const s = parseSections(output);
  const get = (k: string): string => s[k] ?? "";
  const identity = parseIdentity(get("identity"));
  const procs = parsePs(get("ps"));
  const dockerText = get("docker");
  return {
    host,
    collectedAt,
    identity,
    memory: parseMeminfo(get("meminfo")),
    disks: classifyDisks(parseLsblk(get("lsblk"))),
    filesystems: mergeInodes(parseDf(get("df")), get("dfi")),
    mounts: parseMounts(get("mounts")),
    swap: {
      devices: parseSwapon(get("swapon")),
      zram: parseZramctl(get("zram")),
    },
    services: {
      running: parseUnits(get("services")),
      failed: parseUnits(get("failed")),
    },
    timers: parseTimers(get("timers")),
    cron: parseCron(get("cron")),
    ports: parseSs(get("ports")),
    processes: summarizeProcs(procs),
    docker: {
      available: dockerText.includes("{"),
      usage: parseDockerDf(dockerText),
    },
    biggest: parseDu(get("du")).slice(0, 25),
    locks: parseLocks(get("locks")),
    buildProcs: findBuildProcs(procs, parseCwds(get("cwds"))),
    reclaim: {
      aptCacheBytes: parseDu(get("apt"))[0]?.bytes ?? 0,
      journalBytes: parseJournalUsage(get("journal")),
      rotatedLogs: (() => {
        const [count, bytes] = get("rotlogs").trim().split(/\s+/).map(Number);
        return { count: num(count), bytes: num(bytes) };
      })(),
      artifacts: parseArtifacts(get("artifacts")),
      swapFiles: parseSwapFiles(get("swapfiles")),
      cacheDirs: parseCacheDirs(get("caches")),
    },
  };
}

// ---------------------------------------------------------------------------------------- findings

export type Severity = "critical" | "warn" | "info";

export interface Finding {
  readonly id: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  readonly action?: string;
}

/** Readable findings derived from an audit, most severe first. */
export function analyze(a: Audit, minFree: number = DEFAULT_MIN_FREE): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding): number => out.push(f);

  const seen = new Set<string>();
  for (const fs of a.filesystems) {
    if (!fs.real || fs.sizeBytes === 0) continue;
    // the same device mounted twice (WSL 9p drives) is one finding
    const key = `${fs.filesystem}:${fs.sizeBytes}:${fs.usedBytes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const floor = spaceGate(fs.sizeBytes, fs.availBytes, minFree);
    if (!floor.ok) {
      const base = fs.mount === "/" ? "/" : `${fs.mount}/`;
      const picked: string[] = [];
      for (const b of [...a.biggest].toSorted((x, y) => y.bytes - x.bytes)) {
        if (!b.path.startsWith(base) && b.path !== fs.mount) continue;
        if (picked.some(q => q === b.path || b.path.startsWith(`${q}/`) || q.startsWith(`${b.path}/`))) continue;
        picked.push(b.path);
        if (picked.length === 3) break;
      }
      add({
        id: `free-floor:${fs.mount}`,
        severity: "critical",
        title: `${fs.mount} keeps ${(floor.freeRatio * 100).toFixed(0)}% free, below the ${(minFree * 100).toFixed(0)}% floor`,
        detail: `${fmtBytes(floor.shortfallBytes)} must still be freed; yolo ship refuses to build below the floor (--min-free, YOLO_MIN_FREE or [space] min_free change it)`,
        action:
          picked.length > 0
            ? `yolo host space ${picked.join(" ")} --host ${a.host} --fs ${fs.mount}  (what deleting them really frees, hard links included)`
            : `yolo host space <paths> --host ${a.host} --fs ${fs.mount}`,
      });
    }
    if (fs.usePercent >= 90)
      add({
        id: `disk-full:${fs.mount}`,
        severity: "critical",
        title: `${fs.mount} is ${fs.usePercent}% full`,
        detail: `${fmtBytes(fs.availBytes)} free of ${fmtBytes(fs.sizeBytes)}`,
        action: "yolo host reclaim, then archive the largest directories off this disk",
      });
    else if (fs.usePercent >= 80)
      add({
        id: `disk-high:${fs.mount}`,
        severity: "warn",
        title: `${fs.mount} is ${fs.usePercent}% full`,
        detail: `${fmtBytes(fs.availBytes)} free of ${fmtBytes(fs.sizeBytes)}`,
        action: "yolo host reclaim",
      });
    if ((fs.inodes?.usePercent ?? 0) >= 85)
      add({
        id: `inodes:${fs.mount}`,
        severity: "warn",
        title: `${fs.mount} uses ${fs.inodes?.usePercent}% of its inodes`,
        detail: "many small files (caches, node_modules, build trees)",
        action: "reclaim old build artifacts",
      });
  }

  for (const d of a.disks) {
    for (const f of d.filesystems.filter(x => !x.mounted)) {
      add({
        id: `fs-unmounted:${f.path}`,
        severity: "warn",
        title: `${f.path} (${fmtBytes(f.sizeBytes)}) is unmounted and already holds a ${f.fstype} filesystem${f.label ? ` labelled "${f.label}"` : ""}`,
        detail: "contains data or a backup: never formatted by yolo, nothing was mounted or written",
        action: `yolo host mount ${f.path} (read-only by default)`,
      });
    }
    if (d.state === "unmounted-raw")
      add({
        id: `disk-raw:${d.name}`,
        severity: "info",
        title: `${d.path} (${fmtBytes(d.sizeBytes)}) is unmounted with no filesystem detected`,
        detail: "yolo never formats or wipes; partition and format it yourself if it is really empty",
      });
    if (d.unallocatedBytes >= 1024 ** 3)
      add({
        id: `unallocated:${d.name}`,
        severity: "info",
        title: `${d.path} has ${fmtBytes(d.unallocatedBytes)} outside any partition`,
        detail: "free for growing a partition or adding one; yolo does not repartition",
      });
  }

  const m = a.memory;
  const swapTotal = a.swap.devices.reduce((n, s) => n + s.sizeBytes, 0);
  const swapUsed = a.swap.devices.reduce((n, s) => n + s.usedBytes, 0);
  if (m.totalBytes > 0) {
    const availPct = (m.availableBytes / m.totalBytes) * 100;
    if (availPct < 10)
      add({
        id: "mem-low",
        severity: "critical",
        title: `only ${availPct.toFixed(0)}% of RAM is available`,
        detail: `${fmtBytes(m.availableBytes)} of ${fmtBytes(m.totalBytes)}`,
        action: "yolo host services (stop candidates)",
      });
    if (swapTotal === 0)
      add({
        id: "no-swap",
        severity: m.totalBytes < 8 * 1024 ** 3 ? "warn" : "info",
        title: "no swap configured",
        detail: `${fmtBytes(m.totalBytes)} RAM without swap or zram`,
        action: "yolo host tune (swap sizing)",
      });
    else if (swapUsed / swapTotal > 0.5)
      add({
        id: "swap-pressure",
        severity: "warn",
        title: `swap ${Math.round((swapUsed / swapTotal) * 100)}% used`,
        detail: `${fmtBytes(swapUsed)} of ${fmtBytes(swapTotal)}`,
      });
  }

  if (a.identity.load[0] > a.identity.cpus * 1.5)
    add({
      id: "load-high",
      severity: "warn",
      title: `load ${a.identity.load[0]} on ${a.identity.cpus} CPUs`,
      detail: `1/5/15 min: ${a.identity.load.join(" / ")}`,
    });

  if (a.services.failed.length > 0)
    add({
      id: "failed-units",
      severity: "warn",
      title: `${a.services.failed.length} failed systemd unit(s)`,
      detail: a.services.failed.map(u => u.name).join(", "),
      action: "systemctl reset-failed after fixing, or disable the unit",
    });
  if (a.processes.zombies > 0)
    add({
      id: "zombies",
      severity: "info",
      title: `${a.processes.zombies} zombie process(es)`,
      detail: "their parents are not reaping them",
    });

  const exposed = a.ports.filter(p => p.exposed && p.proto.startsWith("tcp"));
  if (exposed.length > 0)
    add({
      id: "exposed-ports",
      severity: "info",
      title: `${exposed.length} TCP port(s) listen on all interfaces`,
      detail: exposed.map(p => `${p.port}${p.process ? `/${p.process}` : ""}`).join(", "),
    });

  for (const l of a.locks)
    if (l.state === "held")
      add({
        id: `lock-held:${l.path}`,
        severity: "info",
        title: `build lock held: ${l.path}`,
        detail: `pid ${l.pids.join(", ") || "?"}; yolo host will not mutate this host until it is released`,
      });

  const order: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return out.toSorted((x, y) => order[x.severity] - order[y.severity]);
}
