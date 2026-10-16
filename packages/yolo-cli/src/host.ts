/**
 * `yolo host`: manage a Linux server end to end from the yolo CLI, through the Aphrody SSH transport.
 *
 *   yolo host audit    --host vps|dbfr|local [--json]           typed inventory, findings, prioritized reclaim plan
 *   yolo host reclaim  --host H [--apply]                       cleanup of regenerable data only
 *   yolo host archive  --host H <path..> --to DIR [--pull DIR] [--remove-source] [--pg-dump DB] [--apply]
 *   yolo host services --host H [--stop UNIT] [--disable] [--apply]
 *   yolo host tune     --host H [--apply]                       sysctl (BBR/fq/buffers), THP, nginx, swap sizing
 *   yolo host net      --host H [--size BYTES] [--apply]        latency and bandwidth with units
 *   yolo host mount    --host H <device> [--rw --i-know-this-is-a-backup] [--fstab] [--apply]
 *   yolo host journal  --host H [--tail N]                      what `--apply` did, with undo hints
 *
 * Every subcommand is a PLAN unless `--apply` is given, and a plan lists exactly the commands that would
 * run. Applied steps are appended to var/host/<host>/journal.jsonl with before/after metrics and an undo
 * hint. The safety rules live in host-safety.ts (hard-coded, not configurable); the parsers in
 * host-parse.ts. Remote hosts go through `aphrody-infra ssh exec`; `local` runs commands directly.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { aphrodyRoot, buildFactoryInfo, onPath, sshCapture, sshService, sshServiceArgs, sshTune } from "./aphrody";
import {
  type Audit,
  type Finding,
  type HostName,
  type Identity,
  type LockState,
  type Metrics,
  analyze,
  buildAudit,
  fmtBytes,
  parseKeyValues,
  parseMetrics,
  parseSize,
} from "./host-parse";
import {
  type PathContext,
  type Policy,
  type Verdict,
  type Verification,
  assertSafeCommand,
  canDeleteBuildArtifact,
  canDeleteCacheDir,
  canRemoveSource,
  canStopUnit,
  classifyService,
  keptCacheReason,
  normalizePath,
  parsePolicy,
  pathInUse,
  protectedReason,
  removalRefusals,
  isDatabasePath,
} from "./host-safety";
import { estimateReclaim, parseDfSizeAvail, resolveMinFree, scanLinks, spaceGate } from "./host-space";

export const HOSTS: readonly HostName[] = ["vps", "dbfr", "local"];
export const HOST_COMMANDS = [
  "audit",
  "reclaim",
  "archive",
  "services",
  "tune",
  "net",
  "mount",
  "journal",
  "space",
] as const;

// -------------------------------------------------------------------------------------------- shell

/** POSIX single-quote a value for any shell. */
export function sq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const isTTY = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;
const paint = (code: string, s: string): string => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string): string => paint("1", s);
const red = (s: string): string => paint("31", s);
const yellow = (s: string): string => paint("33", s);
const green = (s: string): string => paint("32", s);
const dim = (s: string): string => paint("2", s);

function pad(s: string, width: number, right = false): string {
  const gap = Math.max(0, width - Bun.stringWidth(s));
  return right ? " ".repeat(gap) + s : s + " ".repeat(gap);
}

function table(rows: readonly (readonly string[])[], right: readonly number[] = []): string {
  if (rows.length === 0) return "";
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map(r => Bun.stringWidth(r[i] ?? ""))));
  return rows
    .map(
      r =>
        "  " +
        r
          .map((c, i) => pad(c, widths[i] ?? 0, right.includes(i)))
          .join("  ")
          .trimEnd(),
    )
    .join("\n");
}

// ------------------------------------------------------------------------------------------ transport

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Transport {
  readonly host: HostName;
  readonly remote: boolean;
  exec(cmd: string, timeoutSecs?: number): Promise<ExecResult>;
  /** systemd unit action through the owner (remote) or systemctl (local) */
  service(unit: string, action: string): Promise<ExecResult>;
  /** the owner's tuning report/application; unavailable on local */
  tune(apply: boolean): Promise<ExecResult>;
}

export class LocalTransport implements Transport {
  readonly host: HostName = "local";
  readonly remote = false;

  async exec(cmd: string, timeoutSecs = 120): Promise<ExecResult> {
    const shellCmd =
      process.platform === "win32"
        ? Bun.which("sh")
          ? ["sh", "-c", cmd]
          : [process.env["COMSPEC"] || "cmd.exe", "/c", cmd]
        : ["sh", "-c", cmd];
    const proc = Bun.spawn(shellCmd, {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutSecs * 1000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  service(unit: string, action: string): Promise<ExecResult> {
    return this.exec(`sudo -n systemctl ${action} ${sq(unit)}`);
  }

  async tune(): Promise<ExecResult> {
    return {
      code: 127,
      stdout: "",
      stderr: "aphrody-infra ssh tune is for remote hosts",
    };
  }
}

export class RemoteTransport implements Transport {
  readonly remote = true;
  constructor(readonly host: HostName) {}

  exec(cmd: string, timeoutSecs = 120): Promise<ExecResult> {
    return sshCapture(this.host, cmd, timeoutSecs);
  }

  service(unit: string, action: string): Promise<ExecResult> {
    return sshService(this.host, unit, action);
  }

  tune(apply: boolean): Promise<ExecResult> {
    return sshTune(this.host, apply);
  }
}

export function makeTransport(host: HostName): Transport {
  if (host === "local") return new LocalTransport();
  if (!onPath("aphrody-infra")) {
    throw new Error(`\`aphrody-infra\` is not on PATH (Aphrody install: ${aphrodyRoot()})`);
  }
  return new RemoteTransport(host);
}

// ---------------------------------------------------------------------------------------------- policy

export function policyFile(yoloRoot: string, explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env["YOLO_HOST_POLICY"],
    join(process.cwd(), "host-policy.toml"),
    join(yoloRoot, "infra/config/host/host-policy.toml"),
  ];
  for (const c of candidates) if (c !== undefined && c !== "" && existsSync(c)) return c;
  return null;
}

export function loadPolicy(
  yoloRoot: string,
  host: HostName,
  explicit?: string,
): { policy: Policy; file: string | null } {
  const file = policyFile(yoloRoot, explicit);
  return {
    policy: parsePolicy(file === null ? null : readFileSync(file, "utf8"), host),
    file,
  };
}

export function expandHome(p: string, home: string): string {
  return p === "~" ? home : p.startsWith("~/") ? posix.join(home, p.slice(2)) : p;
}

/** Quote a policy path for a shell script, keeping `~` as "$HOME". Throws on anything unusual. */
function shellPath(p: string): string {
  if (!/^[~/][\w./@+-]*$/.test(p)) throw new Error(`unsupported path in policy: ${p}`);
  if (p === "~") return '"$HOME"';
  if (p.startsWith("~/")) return `"$HOME"/${sq(p.slice(2))}`;
  return sq(p);
}

function shellGlob(p: string): string {
  if (!/^\/[\w./@+*?-]*$/.test(p)) throw new Error(`unsupported glob in policy: ${p}`);
  return p;
}

/** Lock files to honor on a host: the policy's plus the Aphrody build factory's own heavy lock. */
export function effectiveLocks(host: HostName, policy: Policy): string[] {
  const out = [...policy.locks];
  const factory = buildFactoryInfo();
  if (factory !== null && factory.target === host && !out.includes(factory.lockPath)) out.push(factory.lockPath);
  return out;
}

function preservePaths(host: HostName, policy: Policy): string[] {
  const out = [...policy.protect];
  const factory = buildFactoryInfo();
  if (factory !== null && factory.target === host) {
    out.push(factory.artifactRoot);
    if (factory.cacheRoot !== undefined) out.push(factory.cacheRoot);
  }
  return out;
}

// -------------------------------------------------------------------------------------------- collector

export const SECTIONS = [
  "identity",
  "meminfo",
  "lsblk",
  "df",
  "dfi",
  "mounts",
  "swapon",
  "zram",
  "services",
  "failed",
  "timers",
  "ports",
  "ps",
  "cwds",
  "docker",
  "du",
  "cron",
  "locks",
  "journal",
  "apt",
  "rotlogs",
  "artifacts",
  "swapfiles",
  "caches",
] as const;
export type Section = (typeof SECTIONS)[number];

/** What mutating subcommands need before they act: identity, build processes, locks, swap and disk usage. */
export const FACT_SECTIONS: readonly Section[] = ["identity", "df", "swapon", "ps", "cwds", "locks"];

export const ROTATED_LOG_PATTERNS = ["*.gz", "*.xz", "*.zst", "*.[0-9]", "*.old"] as const;

export function rotatedLogsFind(days: number, tail: string): string {
  const names = ROTATED_LOG_PATTERNS.map(n => `-name '${n}'`).join(" -o ");
  return `find /var/log -xdev -type f \\( ${names} \\) -mtime +${Math.floor(days)} ${tail}`;
}

/** The read-only collector. Its text is what `yolo host audit --print-script` shows. */
export function collectorScript(sections: readonly Section[], policy: Policy, locks: readonly string[]): string {
  const roots = policy.reclaim.scanRoots.map(shellPath).join(" ");
  const caches = policy.reclaim.cacheDirs.map(shellPath).join(" ");
  const exclude = policy.reclaim.excludeNames
    .map(n => {
      if (!/^[\w.@+-]+$/.test(n)) throw new Error(`unsupported exclude name in policy: ${n}`);
      return `-name ${sq(n)}`;
    })
    .join(" -o ");
  const duExclude = policy.reclaim.excludeNames
    .filter(n => !n.startsWith("."))
    .map(n => `--exclude=${sq(n)}`)
    .join(" ");
  const swapGlobs = policy.reclaim.swapFileGlobs.map(shellGlob).join(" ");
  const age = Math.floor(policy.reclaim.buildArtifactMinAgeDays);
  const lockList = locks.map(l => sq(normalizePath(l))).join(" ");
  const body: Record<Section, string> = {
    identity: String.raw`echo "user=$ME"; echo "uid=$(id -u)"; echo "home=$HOME"; echo "hostname=$(hostname)"
echo "kernel=$(uname -r)"; echo "os=$(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
echo "uptime=$(cut -d' ' -f1 /proc/uptime)"; echo "cpus=$(nproc)"; echo "loadavg=$(cat /proc/loadavg)"
if [ "$(id -u)" = 0 ] || [ -n "$S" ]; then echo "sudo=yes"; else echo "sudo=no"; fi
for t in zstd tar sha256sum rsync rclone pg_dump pg_restore docker ionice nice flock pigz fuser mountpoint findmnt; do
  if command -v $t >/dev/null 2>&1; then echo "tool.$t=yes"; else echo "tool.$t=no"; fi
done`,
    meminfo: "cat /proc/meminfo",
    lsblk: `lsblk -J -b -o NAME,KNAME,PATH,TYPE,SIZE,FSTYPE,FSUSED,FSAVAIL,MOUNTPOINTS,LABEL,UUID,RO,RM,ROTA,PKNAME,MODEL 2>/dev/null`,
    df: "df -PT -B1 2>/dev/null",
    dfi: "df -Pi 2>/dev/null",
    mounts: "findmnt -rn -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null",
    swapon: "swapon --noheadings --raw --bytes --show=NAME,TYPE,SIZE,USED,PRIO 2>/dev/null",
    zram: "zramctl --noheadings --raw --bytes -o NAME,DISKSIZE,DATA,COMPR,ALGORITHM 2>/dev/null",
    services: "systemctl list-units --type=service --state=running --no-legend --plain --no-pager 2>/dev/null",
    failed: "systemctl list-units --state=failed --no-legend --plain --no-pager 2>/dev/null",
    timers: "systemctl list-timers --all --no-legend --no-pager 2>/dev/null",
    ports: "$S ss -H -tulnp 2>/dev/null",
    ps: "ps -eo pid=,ppid=,rss=,pcpu=,etimes=,stat=,user:32=,args= 2>/dev/null",
    cwds: String.raw`$S sh -c 'ls -l /proc/[0-9]*/cwd 2>/dev/null' | sed 's#.* /proc/\([0-9]*\)/cwd -> #\1 #'`,
    docker: String.raw`if command -v docker >/dev/null 2>&1; then docker system df --format '{{json .}}' 2>/dev/null; fi`,
    du: `$S timeout 60 nice -n 19 ionice -c3 du -x -B1 -d1 ${duExclude} /var/lib /var/cache /var/log /var/tmp /home /opt /tmp /usr/local /root /snap 2>/dev/null | sort -rn | head -40`,
    cron: String.raw`ls -1 /etc/cron.d 2>/dev/null
echo "## user"; crontab -l 2>/dev/null`,
    locks:
      lockList === ""
        ? ":"
        : String.raw`for L in ${lockList}; do
  if [ -e "$L" ]; then
    i=$(stat -c %i "$L" 2>/dev/null)
    pids=$(awk -v i="$i" '$6 ~ (":" i "$") {print $5}' /proc/locks 2>/dev/null | sort -u | tr '\n' ',')
    if [ -n "$pids" ]; then echo "$L|held|$pids"; else echo "$L|free|"; fi
  else echo "$L|absent|"; fi
done`,
    journal: "journalctl --disk-usage 2>/dev/null",
    apt: "du -sxB1 /var/cache/apt/archives 2>/dev/null",
    rotlogs: `$S ${rotatedLogsFind(policy.reclaim.rotatedLogAgeDays, "-printf '%s\\n'")} 2>/dev/null | awk '{n++; s+=$1} END{print n+0, s+0}'`,
    artifacts:
      roots === ""
        ? ":"
        : String.raw`for r in ${roots}; do
  [ -d "$r" ] && timeout 60 nice -n 19 ionice -c3 find "$r" -xdev -maxdepth 7 \( ${exclude} \) -prune -o \( -name node_modules -o -name target -o -name .next \) -type d -user "$ME" -prune -print 2>/dev/null
done | head -80 | while IFS= read -r d; do
  base=$(basename "$d"); par=$(dirname "$d"); marker=""
  case "$base" in
    target) [ -f "$par/Cargo.toml" ] && marker=cargo ;;
    node_modules) [ -f "$par/package.json" ] && marker=npm ;;
    .next) [ -f "$par/package.json" ] && marker=next ;;
  esac
  [ -z "$marker" ] && continue
  recent=$(find "$d" -maxdepth 2 -mtime -${age} -print -quit 2>/dev/null)
  size=$(timeout 20 du -sxB1 "$d" 2>/dev/null | cut -f1)
  if [ -n "$recent" ]; then st=recent; else st=old; fi
  echo "$size|$marker|$st|$d"
done`,
    swapfiles:
      swapGlobs === ""
        ? ":"
        : String.raw`for f in ${swapGlobs}; do
  [ -f "$f" ] || continue
  sig=$($S dd if="$f" bs=1 skip=4086 count=10 2>/dev/null | tr -d '\0')
  [ "$sig" = SWAPSPACE2 ] || sig=-
  if grep -qs "^[^#]*[[:space:]]$f[[:space:]]" /etc/fstab; then ft=fstab; else ft=-; fi
  echo "$(stat -c %s "$f")|$sig|$ft|$f"
done`,
    caches:
      caches === ""
        ? ":"
        : String.raw`for c in ${caches}; do
  [ -d "$c" ] && echo "$(timeout 20 du -sxB1 "$c" 2>/dev/null | cut -f1)|$c"
done`,
  };
  const prelude = String.raw`S=""
if [ "$(id -u)" != 0 ] && sudo -n true 2>/dev/null; then S="sudo -n"; fi
ME=$(id -un)
sec() { printf '@@@ %s\n' "$1"; }`;
  const parts = sections.map(s => `sec ${s}\n${body[s]}`);
  return `${prelude}\n${parts.join("\n")}\n`;
}

/** Wrap a script so it travels as one opaque argument (no quoting or length surprises through ssh). */
export function wrapScript(script: string): string {
  return `printf %s ${sq(Buffer.from(script).toString("base64"))} | base64 -d | sh`;
}

export async function collect(t: Transport, policy: Policy, sections: readonly Section[] = SECTIONS): Promise<Audit> {
  const script = collectorScript(sections, policy, effectiveLocks(t.host, policy));
  const r = await t.exec(wrapScript(script), 300);
  if (r.code !== 0 && r.stdout.trim() === "")
    throw new Error(`collector failed on ${t.host} (exit ${r.code}): ${r.stderr.trim().slice(0, 300)}`);
  return buildAudit(t.host, r.stdout);
}

export function pathContext(a: Audit, host: HostName, policy: Policy): PathContext {
  return {
    user: a.identity.user,
    home: a.identity.home,
    preserve: preservePaths(host, policy),
  };
}

export function heldLocks(a: Audit): LockState[] {
  return a.locks.filter(l => l.state === "held");
}

/** Run a command as root: itself when root, `sudo -n sh -c` when sudo is passwordless, null otherwise. */
export function asRoot(id: Identity, cmd: string): string | null {
  if (id.uid === 0) return cmd;
  return id.privileged ? `sudo -n sh -c ${sq(cmd)}` : null;
}

export function metricsCommand(paths: readonly string[]): string {
  const frees = [...new Set(paths)].map(
    p =>
      `d=${sq(p)}; while [ ! -e "$d" ] && [ "$d" != / ]; do d=$(dirname "$d"); done; printf 'free:%s=%s\\n' ${sq(p)} "$(df -PB1 -- "$d" 2>/dev/null | awk 'NR==2{print $4}')"`,
  );
  return [
    `echo "mem_available=$(awk '/MemAvailable/{print $2*1024}' /proc/meminfo)"`,
    `echo "swap_total=$(awk '/SwapTotal/{print $2*1024}' /proc/meminfo)"`,
    `echo "swap_free=$(awk '/SwapFree/{print $2*1024}' /proc/meminfo)"`,
    `echo "load1=$(cut -d' ' -f1 /proc/loadavg)"`,
    ...frees,
  ].join("; ");
}

// ------------------------------------------------------------------------------------------------ plan

export interface StepResult {
  readonly ok: boolean;
  readonly code: number;
  readonly output: string;
  readonly note?: string | undefined;
}

export interface RunState {
  readonly verification: Map<string, Partial<Verification>>;
  readonly values: Map<string, string>;
}

export interface Step {
  readonly id: string;
  readonly title: string;
  /** exec: on the target host; local-exec: on this machine; service/tune: the owner CLI; inproc: TypeScript */
  readonly kind: "exec" | "local-exec" | "service" | "tune" | "inproc";
  /** exactly what runs (or, for inproc, what is done) */
  readonly cmd: string;
  readonly mutates: boolean;
  readonly undo: string | null;
  readonly metricPaths?: readonly string[] | undefined;
  readonly estimateBytes?: number | undefined;
  readonly blocked?: string | undefined;
  readonly timeoutSecs?: number | undefined;
  readonly group?: string | undefined;
  readonly unit?: string | undefined;
  readonly action?: string | undefined;
  /** extra exit codes that count as success */
  readonly okCodes?: readonly number[] | undefined;
  /** re-checked at run time; a string refuses the step */
  readonly gate?: ((ctx: RunContext, state: RunState) => Promise<string | null>) | undefined;
  readonly record?: ((r: StepResult, state: RunState) => void) | undefined;
  readonly run?: ((ctx: RunContext, state: RunState) => Promise<StepResult>) | undefined;
}

export interface Plan {
  readonly host: HostName;
  readonly command: string;
  readonly steps: readonly Step[];
  readonly notes: readonly string[];
  /** things the plan deliberately left alone, with the reason */
  readonly skipped: readonly { what: string; why: string }[];
}

export interface RunContext {
  readonly host: HostName;
  readonly command: string;
  readonly transport: Transport;
  readonly local: Transport;
  readonly policy: Policy;
  readonly yoloRoot: string;
  readonly out: (line: string) => void;
}

export interface JournalEntry {
  readonly ts: string;
  readonly run: string;
  readonly host: HostName;
  readonly command: string;
  readonly step: string;
  readonly title: string;
  readonly cmd: string;
  readonly status: "ok" | "failed" | "skipped" | "refused";
  readonly exit: number | null;
  readonly ms: number;
  readonly before: Metrics | null;
  readonly after: Metrics | null;
  readonly undo: string | null;
  readonly note: string | null;
}

export function journalPath(yoloRoot: string, host: HostName): string {
  return join(yoloRoot, "var/host", host, "journal.jsonl");
}

export async function appendJournal(yoloRoot: string, entry: JournalEntry): Promise<void> {
  const file = journalPath(yoloRoot, entry.host);
  await mkdir(dirname(file), { recursive: true });
  // a torn last line (crash, full disk) must not swallow the next record
  const f = Bun.file(file);
  const torn = (await f.exists()) && f.size > 0 && (await f.slice(f.size - 1).text()) !== "\n";
  await appendFile(file, `${torn ? "\n" : ""}${JSON.stringify(entry)}\n`);
}

export async function readJournal(yoloRoot: string, host: HostName): Promise<JournalEntry[]> {
  const file = journalPath(yoloRoot, host);
  if (!existsSync(file)) return [];
  const out: JournalEntry[] = [];
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line) as JournalEntry);
    } catch {
      // a torn last line must not hide the rest of the journal
    }
  }
  return out;
}

export function renderPlan(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`${bold(`yolo host ${plan.command}`)} on ${bold(plan.host)}: ${plan.steps.length} step(s)`);
  for (const n of plan.notes) lines.push(`  note: ${n}`);
  plan.steps.forEach((s, i) => {
    const tags = [
      s.mutates ? "" : "read-only",
      s.estimateBytes !== undefined && s.estimateBytes > 0 ? `~${fmtBytes(s.estimateBytes)}` : "",
      s.blocked !== undefined ? red(`BLOCKED: ${s.blocked}`) : "",
    ]
      .filter(x => x !== "")
      .join(", ");
    lines.push(`${String(i + 1).padStart(3)}. ${s.title}${tags === "" ? "" : ` ${dim(`[${tags}]`)}`}`);
    const where = s.kind === "local-exec" ? "local$" : s.kind === "inproc" ? "in-process:" : "$";
    lines.push(`       ${where} ${s.cmd}`);
    if (s.undo !== null) lines.push(`       undo: ${s.undo}`);
  });
  const SHOWN = 8;
  for (const k of plan.skipped.slice(0, SHOWN)) lines.push(`  left alone: ${k.what} (${k.why})`);
  if (plan.skipped.length > SHOWN)
    lines.push(`  left alone: ... and ${plan.skipped.length - SHOWN} more (--json lists them all)`);
  return lines.join("\n");
}

const nowId = (): string => Bun.randomUUIDv7().slice(0, 18);

/**
 * Execute a plan. Refuses when a build lock is held; stops a group at its first failure; journals every
 * step. Returns 0 when all steps succeeded, 1 on failure, 3 on a refusal.
 */
export async function executePlan(plan: Plan, ctx: RunContext): Promise<number> {
  const run = nowId();
  const state: RunState = { verification: new Map(), values: new Map() };
  const policyLocks = effectiveLocks(ctx.host, ctx.policy);
  const journal = (
    step: Step,
    status: JournalEntry["status"],
    exit: number | null,
    ms: number,
    before: Metrics | null,
    after: Metrics | null,
    note: string | null,
  ): Promise<void> =>
    appendJournal(ctx.yoloRoot, {
      ts: new Date().toISOString(),
      run,
      host: ctx.host,
      command: plan.command,
      step: step.id,
      title: step.title,
      cmd: step.cmd,
      status,
      exit,
      ms,
      before,
      after,
      undo: step.undo,
      note,
    });

  const lockHeld = async (): Promise<string | null> => {
    if (policyLocks.length === 0) return null;
    const script = collectorScript(["locks"], ctx.policy, policyLocks);
    const r = await ctx.transport.exec(wrapScript(script), 60);
    if (r.code !== 0) return `cannot read the build lock state (exit ${r.code}): refusing to mutate`;
    const held = heldLocks(buildAudit(ctx.host, r.stdout));
    return held.length === 0
      ? null
      : `build lock held: ${held.map(l => `${l.path} (pid ${l.pids.join(",")})`).join(", ")}`;
  };

  if (plan.steps.some(s => s.mutates)) {
    const held = await lockHeld();
    if (held !== null) {
      ctx.out(red(`refused: ${held}. Nothing was changed.`));
      const first = plan.steps.find(s => s.mutates) as Step;
      await journal(first, "refused", null, 0, null, null, held);
      return 3;
    }
  }

  const aborted = new Set<string>();
  let failed = false;
  let refused = false;
  for (const step of plan.steps) {
    const started = Bun.nanoseconds();
    const elapsed = (): number => Math.round((Bun.nanoseconds() - started) / 1e6);
    if (step.group !== undefined && aborted.has(step.group)) {
      ctx.out(`  skip  ${step.title} (an earlier step of this group failed)`);
      // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
      await journal(step, "skipped", null, 0, null, null, "an earlier step of the group failed");
      continue;
    }
    if (step.blocked !== undefined) {
      ctx.out(`  skip  ${step.title}: ${step.blocked}`);
      // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
      await journal(step, "skipped", null, 0, null, null, step.blocked);
      continue;
    }
    try {
      if (step.kind === "exec" || step.kind === "local-exec") assertSafeCommand(step.cmd);
      if (step.gate !== undefined) {
        // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
        const why = await step.gate(ctx, state);
        if (why !== null) {
          ctx.out(red(`  refuse ${step.title}: ${why}`));
          // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
          await journal(step, "refused", null, elapsed(), null, null, why);
          if (step.group !== undefined) aborted.add(step.group);
          refused = true;
          continue;
        }
      }
    } catch (e) {
      const why = (e as Error).message;
      ctx.out(red(`  refuse ${step.title}: ${why}`));
      // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
      await journal(step, "refused", null, elapsed(), null, null, why);
      if (step.group !== undefined) aborted.add(step.group);
      refused = true;
      continue;
    }

    let before: Metrics | null = null;
    if (step.mutates && step.metricPaths !== undefined)
      before = parseMetrics(
        // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
        (await ctx.transport.exec(metricsCommand(step.metricPaths), 60)).stdout,
      );

    let result: StepResult;
    try {
      // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
      result = await runStep(step, ctx, state);
    } catch (e) {
      result = { ok: false, code: 1, output: "", note: (e as Error).message };
    }
    step.record?.(result, state);

    let after: Metrics | null = null;
    if (step.mutates && step.metricPaths !== undefined && result.ok)
      // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
      after = parseMetrics((await ctx.transport.exec(metricsCommand(step.metricPaths), 60)).stdout);

    const note = (result.note ?? result.output.trim().split("\n").slice(-3).join(" | ")).slice(0, 400) || null;
    // oxlint-disable-next-line no-await-in-loop -- plan steps run in order: each depends on the host and state left by the previous step, and a failure or refusal gates the rest
    await journal(step, result.ok ? "ok" : "failed", result.code, elapsed(), before, after, note);
    if (result.ok) {
      const freed =
        before !== null && after !== null
          ? Object.keys(after.freeBytes).reduce(
              (n, k) => n + ((after.freeBytes[k] ?? 0) - (before.freeBytes[k] ?? 0)),
              0,
            )
          : 0;
      ctx.out(`  ok    ${step.title}${freed > 0 ? green(` (+${fmtBytes(freed)} free)`) : ""}`);
    } else {
      failed = true;
      ctx.out(red(`  FAIL  ${step.title} (exit ${result.code}): ${(note ?? "").slice(0, 200)}`));
      if (step.group !== undefined) aborted.add(step.group);
      else break;
    }
  }
  ctx.out(`journal: ${journalPath(ctx.yoloRoot, ctx.host)}`);
  return refused ? 3 : failed ? 1 : 0;
}

async function runStep(step: Step, ctx: RunContext, state: RunState): Promise<StepResult> {
  if (step.run !== undefined) return step.run(ctx, state);
  let r: ExecResult;
  if (step.kind === "service") r = await ctx.transport.service(step.unit as string, step.action as string);
  else if (step.kind === "tune") r = await ctx.transport.tune(true);
  else if (step.kind === "local-exec") r = await ctx.local.exec(step.cmd, step.timeoutSecs ?? 21600);
  else r = await ctx.transport.exec(step.cmd, step.timeoutSecs ?? 120);
  return {
    ok: r.code === 0 || (step.okCodes ?? []).includes(r.code),
    code: r.code,
    output: `${r.stdout}${r.stderr === "" ? "" : `\n${r.stderr}`}`,
  };
}

/** Print or apply a plan: the single place where "plan by default, --apply to execute" is decided. */
export async function finish(plan: Plan, ctx: RunContext, apply: boolean, json: boolean): Promise<number> {
  if (!apply) {
    if (json) {
      ctx.out(JSON.stringify({ apply: false, ...plan, steps: plan.steps.map(stepJson) }, null, 2));
    } else {
      ctx.out(renderPlan(plan));
      const n = plan.steps.filter(s => s.mutates && s.blocked === undefined).length;
      ctx.out(
        n === 0 ? "\nNothing to apply." : `\nPlan only. Re-run with --apply to execute these ${n} mutating step(s).`,
      );
    }
    return 0;
  }
  if (!json) ctx.out(renderPlan(plan) + "\n");
  return executePlan(plan, ctx);
}

const stepJson = (s: Step): Record<string, unknown> => ({
  id: s.id,
  title: s.title,
  kind: s.kind,
  cmd: s.cmd,
  mutates: s.mutates,
  undo: s.undo,
  estimateBytes: s.estimateBytes ?? null,
  blocked: s.blocked ?? null,
});

// ----------------------------------------------------------------------------------------- reclaim

export interface Candidate {
  readonly id: string;
  readonly kind: "apt-cache" | "journal" | "rotated-logs" | "docker" | "build-artifact" | "cache-dir" | "swapfile";
  readonly title: string;
  readonly bytes: number;
  readonly risk: "low" | "medium";
  readonly path?: string | undefined;
  readonly cmd: string | null;
  readonly undo: string | null;
  readonly blocked?: string | undefined;
}

/** Smaller candidates are noise in a plan. */
const MIN_RECLAIM_BYTES = 1024 ** 2;

export function reclaimCandidates(
  a: Audit,
  policy: Policy,
  host: HostName,
): { candidates: Candidate[]; skipped: { what: string; why: string }[] } {
  const out: Candidate[] = [];
  const skipped: { what: string; why: string }[] = [];
  const id = a.identity;
  const ctx = pathContext(a, host, policy);
  const rootCmd = (cmd: string): { cmd: string | null; blocked?: string | undefined } => {
    const c = asRoot(id, cmd);
    return c === null ? { cmd, blocked: "needs root and passwordless sudo is not available" } : { cmd: c };
  };
  const r = a.reclaim;

  if (r.aptCacheBytes >= 20 * 1024 ** 2)
    out.push({
      id: "apt-cache",
      kind: "apt-cache",
      title: "apt package cache (apt-get clean)",
      bytes: r.aptCacheBytes,
      risk: "low",
      undo: "packages are downloaded again on demand",
      ...rootCmd("apt-get clean"),
    });

  const maxJournal = parseSize(policy.reclaim.journalMaxSize);
  if (r.journalBytes > maxJournal)
    out.push({
      id: "journal",
      kind: "journal",
      title: `systemd journal vacuum (keep <= ${policy.reclaim.journalMaxSize} and <= ${policy.reclaim.journalMaxAgeDays}d)`,
      bytes: r.journalBytes - maxJournal,
      risk: "low",
      undo: "vacuumed journal entries are gone; `yolo host archive /var/log/journal` first if they matter",
      ...rootCmd(
        `journalctl --vacuum-size=${policy.reclaim.journalMaxSize} --vacuum-time=${policy.reclaim.journalMaxAgeDays}d`,
      ),
    });

  if (r.rotatedLogs.bytes >= MIN_RECLAIM_BYTES)
    out.push({
      id: "rotated-logs",
      kind: "rotated-logs",
      title: `${r.rotatedLogs.count} rotated logs older than ${policy.reclaim.rotatedLogAgeDays}d under /var/log`,
      bytes: r.rotatedLogs.bytes,
      risk: "low",
      undo: "none (rotated log files); archive /var/log first if they matter",
      ...rootCmd(rotatedLogsFind(policy.reclaim.rotatedLogAgeDays, "-delete")),
    });

  if (a.docker.available) {
    const reclaimable = (t: string): number => a.docker.usage.find(u => u.type === t)?.reclaimableBytes ?? 0;
    const dk: [string, string, string, number, "low" | "medium"][] = [
      [
        "docker-containers",
        "stopped docker containers older than 24h",
        "docker container prune -f --filter until=24h",
        reclaimable("Containers"),
        "medium",
      ],
      ["docker-images", "dangling docker images", "docker image prune -f", reclaimable("Images"), "low"],
      [
        "docker-builder",
        "docker build cache older than 7d",
        "docker builder prune -f --filter until=168h",
        reclaimable("Build Cache"),
        "low",
      ],
    ];
    for (const [cid, title, cmd, bytes, risk] of dk)
      if (bytes > 0)
        out.push({
          id: cid,
          kind: "docker",
          title,
          bytes,
          risk,
          cmd,
          undo: "images are pulled or rebuilt on demand; volumes are never touched",
        });
  }

  const active = new Set(a.swap.devices.map(s => s.name));
  for (const sw of r.swapFiles) {
    if (active.has(sw.path)) continue;
    if (!sw.swapSignature) {
      skipped.push({
        what: sw.path,
        why: "no swap signature: not recognised as an unused swap file",
      });
      continue;
    }
    if (sw.inFstab) {
      skipped.push({
        what: sw.path,
        why: "inactive swap file listed in /etc/fstab: fix fstab first",
      });
      continue;
    }
    if (!policy.reclaim.swapFileGlobs.some(g => new Bun.Glob(g).match(sw.path)) || isDatabasePath(sw.path)) {
      skipped.push({
        what: sw.path,
        why: "not matching the swap file patterns",
      });
      continue;
    }
    out.push({
      id: `swapfile:${sw.path}`,
      kind: "swapfile",
      title: `unused swap file ${sw.path}`,
      bytes: sw.bytes,
      risk: "low",
      path: sw.path,
      undo: `fallocate -l ${sw.bytes} ${sw.path} && chmod 600 ${sw.path} && mkswap ${sw.path}`,
      // re-checked on the host at run time: a swap file that became active in the meantime is left alone
      ...rootCmd(
        `if swapon --noheadings --show=NAME | grep -qxF ${sq(sw.path)}; then echo "swap file is active, left alone" >&2; exit 3; fi; rm -f -- ${sq(sw.path)}`,
      ),
    });
  }

  const scanRoots = policy.reclaim.scanRoots.map(p => expandHome(p, id.home));
  const buildCwds = a.buildProcs.map(b => b.cwd);
  const unseen = a.buildProcs.find(b => b.cwd === null);
  for (const art of r.artifacts) {
    const v = canDeleteBuildArtifact(art.path, art.marker, scanRoots, ctx);
    if (!v.ok) {
      skipped.push({ what: art.path, why: v.reason });
      continue;
    }
    if (art.recent) {
      skipped.push({
        what: art.path,
        why: `modified within ${policy.reclaim.buildArtifactMinAgeDays}d`,
      });
      continue;
    }
    let blocked: string | undefined;
    if (pathInUse(art.path, buildCwds)) blocked = "a build process (cargo/bun/...) is working in or above it";
    else if (unseen !== undefined)
      blocked = `cannot see the working directory of build process ${unseen.pid}: not safe`;
    out.push({
      id: `artifact:${art.path}`,
      kind: "build-artifact",
      title: `old ${art.marker} build output ${art.path}`,
      bytes: art.bytes,
      risk: "medium",
      path: art.path,
      cmd: `rm -rf --one-file-system -- ${sq(art.path)}`,
      undo: "rebuild (cargo build / bun install / next build)",
      blocked,
    });
  }

  const caches = new Map(r.cacheDirs.map(c => [c.path, c.bytes]));
  for (const raw of policy.reclaim.cacheDirs) {
    const p = expandHome(raw, id.home);
    const bytes = caches.get(p);
    if (bytes === undefined || bytes < MIN_RECLAIM_BYTES) continue;
    const v: Verdict = canDeleteCacheDir(p, ctx);
    if (!v.ok) {
      skipped.push({ what: p, why: v.reason });
      continue;
    }
    out.push({
      id: `cache:${p}`,
      kind: "cache-dir",
      title: `cache ${p}`,
      bytes,
      risk: "low",
      path: p,
      cmd: `rm -rf --one-file-system -- ${sq(p)}`,
      undo: "the tool recreates its cache on demand",
    });
  }
  for (const k of [".cache/sccache", ".cargo/registry", ".bun/install/cache"]) {
    const p = posix.join(id.home, k);
    if (keptCacheReason(p, ctx) !== null) skipped.push({ what: `~/${k}`, why: "reusable cache kept on purpose" });
  }

  out.sort((x, y) => (x.risk === y.risk ? y.bytes - x.bytes : x.risk === "low" ? -1 : 1));
  return { candidates: out, skipped };
}

export function planReclaim(a: Audit, policy: Policy, host: HostName): Plan {
  const { candidates, skipped } = reclaimCandidates(a, policy, host);
  const steps: Step[] = candidates.map(c => ({
    id: c.id,
    title: c.title,
    kind: "exec",
    cmd: c.cmd ?? "",
    mutates: true,
    undo: c.undo,
    metricPaths: [c.path ?? "/"],
    estimateBytes: c.bytes,
    blocked: c.blocked,
    timeoutSecs: 900,
    group: c.id, // independent cleanups: one failure does not stop the others
  }));
  const notes = [`only regenerable data is removed; protected paths need \`yolo host archive\``];
  const held = heldLocks(a);
  if (held.length > 0) notes.push(`BUILD LOCK HELD (${held.map(l => l.path).join(", ")}): --apply will refuse`);
  return { host, command: "reclaim", steps, notes, skipped };
}

// ------------------------------------------------------------------------------------------ audit report

/** Large directories that only archive + verify may reduce, with the reason they are not touched directly. */
export function archiveSuggestions(
  a: Audit,
  policy: Policy,
  host: HostName,
): { path: string; bytes: number; why: string }[] {
  const ctx = pathContext(a, host, policy);
  const out: { path: string; bytes: number; why: string }[] = [];
  for (const d of a.biggest) {
    let p: string;
    try {
      p = normalizePath(d.path);
    } catch {
      continue;
    }
    if (removalRefusals(p, ctx).length > 0 && !isDatabasePath(p)) continue;
    if (keptCacheReason(p, ctx) !== null) continue;
    const why = protectedReason(p, ctx) ?? "not a regenerable cache";
    out.push({ path: p, bytes: d.bytes, why });
  }
  return out.toSorted((x, y) => y.bytes - x.bytes).slice(0, 6);
}

export function renderAudit(
  a: Audit,
  findings: readonly Finding[],
  plan: Plan,
  suggestions: readonly { path: string; bytes: number; why: string }[],
): string {
  const L: string[] = [];
  const id = a.identity;
  L.push(
    bold(`Host ${a.host}`) +
      ` ${id.hostname} (${id.os}, kernel ${id.kernel}) as ${id.user}${id.privileged ? " [privileged]" : " [no sudo]"}`,
  );
  L.push(
    `  ${id.cpus} CPUs, load ${id.load.join(" / ")}, up ${(id.uptimeSecs / 86400).toFixed(1)} d, RAM ${fmtBytes(a.memory.availableBytes)} available of ${fmtBytes(a.memory.totalBytes)}`,
  );
  const swapTotal = a.swap.devices.reduce((n, s) => n + s.sizeBytes, 0);
  const swapUsed = a.swap.devices.reduce((n, s) => n + s.usedBytes, 0);
  L.push(
    `  swap ${fmtBytes(swapUsed)} used of ${fmtBytes(swapTotal)}: ${a.swap.devices.map(s => `${s.name} ${fmtBytes(s.sizeBytes)} prio ${s.priority}`).join(", ") || "none"}`,
  );
  if (a.swap.zram.length > 0)
    L.push(
      `  zram: ${a.swap.zram.map(z => `${z.name} ${fmtBytes(z.diskSizeBytes)} ${z.algorithm}, data ${fmtBytes(z.dataBytes)} -> ${fmtBytes(z.compressedBytes)}`).join("; ")}`,
    );

  L.push("", bold("Findings"));
  if (findings.length === 0) L.push("  none");
  for (const f of findings) {
    const tag =
      f.severity === "critical" ? red("CRITICAL") : f.severity === "warn" ? yellow("WARN    ") : dim("info    ");
    L.push(`  ${tag} ${f.title}`);
    L.push(`           ${f.detail}${f.action === undefined ? "" : `  ->  ${f.action}`}`);
  }

  L.push("", bold("Disks (lsblk)"));
  L.push(
    table([
      ["DISK", "SIZE", "STATE", "FILESYSTEMS", "NOTE"],
      ...a.disks.map(d => [
        d.path,
        fmtBytes(d.sizeBytes),
        d.state,
        d.filesystems
          .map(f => `${f.path.replace("/dev/", "")}:${f.fstype}${f.mounted ? "" : " (unmounted)"}`)
          .join(", ") || "-",
        d.note,
      ]),
    ]),
  );
  L.push("", bold("Filesystems (df, inodes)"));
  L.push(
    table(
      [
        ["MOUNT", "TYPE", "SIZE", "USED", "AVAIL", "USE%", "INODE%"],
        ...a.filesystems
          .filter(f => f.real)
          .map(f => [
            f.mount,
            f.type,
            fmtBytes(f.sizeBytes),
            fmtBytes(f.usedBytes),
            fmtBytes(f.availBytes),
            `${f.usePercent}%`,
            f.inodes === undefined ? "-" : `${f.inodes.usePercent}%`,
          ]),
      ],
      [2, 3, 4, 5, 6],
    ),
  );

  const p = a.processes;
  L.push(
    "",
    bold("Processes"),
    `  ${p.total} total: ${p.userland} userland, ${p.kernel} kernel threads, ${p.zombies} zombies; by user ${Object.entries(
      p.byUser,
    )
      .map(([u, n]) => `${u}=${n}`)
      .join(" ")}`,
  );
  for (const t of p.topRss.slice(0, 5))
    L.push(`  ${pad(fmtBytes(t.rssBytes), 9, true)}  ${pad(t.user, 10)} ${t.command}`);

  L.push(
    "",
    bold(
      `Services: ${a.services.running.length} running, ${a.services.failed.length} failed, ${a.timers.length} timers, ${a.cron.files.length} cron.d files, ${a.cron.userEntries} user crontab entries`,
    ),
  );
  L.push(`  ${a.services.running.map(u => u.name.replace(/\.service$/, "")).join(", ")}`);
  if (a.services.failed.length > 0) L.push(`  failed: ${a.services.failed.map(u => u.name).join(", ")}`);

  L.push("", bold(`Listening ports (${a.ports.length})`));
  L.push(
    table(
      a.ports
        .filter(x => x.proto.startsWith("tcp") || x.exposed)
        .slice(0, 24)
        .map(x => [x.proto, `${x.address}:${x.port}`, x.exposed ? "all interfaces" : "local", x.process ?? "-"]),
    ),
  );

  if (a.docker.available) {
    L.push("", bold("Docker"));
    for (const u of a.docker.usage)
      L.push(
        `  ${pad(u.type, 14)} ${u.total} (${u.active} active)  ${fmtBytes(u.sizeBytes)}, reclaimable ${fmtBytes(u.reclaimableBytes)}`,
      );
  }
  L.push("", bold("Biggest directories"));
  L.push(
    table(
      a.biggest.slice(0, 10).map(d => [fmtBytes(d.bytes), d.path]),
      [0],
    ),
  );
  for (const lk of a.locks)
    L.push("", `Build lock ${lk.path}: ${lk.state}${lk.pids.length > 0 ? ` (pid ${lk.pids.join(",")})` : ""}`);
  if (a.buildProcs.length > 0)
    L.push(`Build processes: ${a.buildProcs.map(b => `${b.pid}:${b.command.split(" ")[0]}`).join(", ")}`);

  L.push("", bold("Prioritized reclaim plan (regenerable first; nothing runs without `yolo host reclaim --apply`)"));
  const total = plan.steps.reduce((n, s) => n + (s.blocked === undefined ? (s.estimateBytes ?? 0) : 0), 0);
  plan.steps.forEach((s, i) =>
    L.push(
      `  ${i + 1}. ${pad(fmtBytes(s.estimateBytes ?? 0), 9, true)}  ${s.title}${s.blocked === undefined ? "" : red(`  [blocked: ${s.blocked}]`)}`,
    ),
  );
  if (plan.steps.length === 0) L.push("  nothing regenerable to reclaim");
  else L.push(`     total about ${fmtBytes(total)}`);
  if (suggestions.length > 0) {
    L.push("", bold("Then, through archive + verify only"));
    for (const s of suggestions) L.push(`  ${pad(fmtBytes(s.bytes), 9, true)}  ${s.path}  (${s.why})`);
  }
  return L.join("\n");
}

// -------------------------------------------------------------------------------------------- services

export interface ServiceRow {
  readonly name: string;
  readonly cls: "keep" | "candidate" | "unknown";
  readonly why: string;
  readonly description: string;
}

export function planServices(
  a: Audit,
  policy: Policy,
  host: HostName,
  opts: { stop: readonly string[]; disable: boolean; candidates: boolean },
): { rows: ServiceRow[]; plan: Plan } {
  const rows: ServiceRow[] = a.services.running.map(u => {
    const c = classifyService(u.name, policy.services);
    return { name: u.name, cls: c.cls, why: c.why, description: u.description };
  });
  const running = new Set(a.services.running.map(u => u.name));
  const wanted = new Set<string>();
  if (opts.candidates) for (const r of rows) if (r.cls === "candidate") wanted.add(r.name);
  for (const s of opts.stop) wanted.add(s.endsWith(".service") ? s : `${s}.service`);

  const steps: Step[] = [];
  const skipped: { what: string; why: string }[] = [];
  const local = host === "local";
  const svcCmd = (unit: string, action: string): string =>
    local
      ? `sudo -n systemctl ${action} ${sq(unit)}`
      : sshServiceArgs(host, unit, action)
          .map(x => (/^[\w./@:+-]+$/.test(x) ? x : sq(x)))
          .join(" ");
  for (const unit of [...wanted].toSorted()) {
    const v = canStopUnit(unit, policy.services);
    if (!v.ok) {
      skipped.push({ what: unit, why: v.reason });
      continue;
    }
    if (!running.has(unit)) {
      skipped.push({ what: unit, why: "not running" });
      continue;
    }
    steps.push({
      id: `stop:${unit}`,
      title: `stop ${unit}`,
      kind: local ? "exec" : "service",
      cmd: svcCmd(unit, "stop"),
      mutates: true,
      metricPaths: ["/"],
      undo: svcCmd(unit, "start"),
      unit,
      action: "stop",
    });
    if (opts.disable)
      steps.push({
        id: `disable:${unit}`,
        title: `disable ${unit}`,
        kind: local ? "exec" : "service",
        cmd: svcCmd(unit, "disable"),
        mutates: true,
        undo: svcCmd(unit, "enable"),
        unit,
        action: "disable",
      });
  }
  const notes = ["ssh and the keep-list are never stopped; edit host-policy.toml to change the lists"];
  return { rows, plan: { host, command: "services", steps, notes, skipped } };
}

export function renderServices(rows: readonly ServiceRow[]): string {
  const order = { candidate: 0, unknown: 1, keep: 2 } as const;
  const sorted = [...rows].toSorted((x, y) => order[x.cls] - order[y.cls] || x.name.localeCompare(y.name));
  return table([["CLASS", "UNIT", "WHY"], ...sorted.map(r => [r.cls, r.name, r.why])]);
}

// ------------------------------------------------------------------------------------------------ tune

export interface TuneTarget {
  readonly key: string;
  readonly value: string;
  readonly why: string;
}

export const SYSCTL_TARGETS: readonly TuneTarget[] = [
  {
    key: "net.ipv4.tcp_congestion_control",
    value: "bbr",
    why: "BBR congestion control: better throughput on lossy or long links",
  },
  {
    key: "net.core.default_qdisc",
    value: "fq",
    why: "fq pacing, required for BBR to work well",
  },
  {
    key: "net.core.rmem_max",
    value: "16777216",
    why: "16 MiB receive buffer ceiling",
  },
  {
    key: "net.core.wmem_max",
    value: "16777216",
    why: "16 MiB send buffer ceiling",
  },
  {
    key: "net.ipv4.tcp_rmem",
    value: "4096 131072 16777216",
    why: "TCP receive buffer autotuning range",
  },
  {
    key: "net.ipv4.tcp_wmem",
    value: "4096 65536 16777216",
    why: "TCP send buffer autotuning range",
  },
  {
    key: "net.core.somaxconn",
    value: "65535",
    why: "listen backlog for busy web servers",
  },
  {
    key: "net.ipv4.tcp_max_syn_backlog",
    value: "65535",
    why: "SYN backlog under bursts",
  },
  {
    key: "net.core.netdev_max_backlog",
    value: "16384",
    why: "packet queue per CPU before drops",
  },
  {
    key: "net.ipv4.tcp_fin_timeout",
    value: "15",
    why: "recycle FIN-WAIT-2 sockets faster",
  },
  {
    key: "net.ipv4.tcp_tw_reuse",
    value: "1",
    why: "reuse TIME-WAIT sockets for outbound connections",
  },
  {
    key: "net.ipv4.tcp_slow_start_after_idle",
    value: "0",
    why: "keep the congestion window on idle keep-alive connections",
  },
  {
    key: "net.ipv4.ip_local_port_range",
    value: "10240 65535",
    why: "wider ephemeral port range for proxies",
  },
  { key: "fs.file-max", value: "2097152", why: "system-wide open file limit" },
  {
    key: "fs.inotify.max_user_watches",
    value: "524288",
    why: "file watchers for dev tools",
  },
  {
    key: "fs.inotify.max_user_instances",
    value: "1024",
    why: "inotify instances",
  },
  {
    key: "vm.vfs_cache_pressure",
    value: "50",
    why: "keep dentries/inodes cached longer",
  },
  {
    key: "vm.dirty_ratio",
    value: "15",
    why: "bound dirty page cache before writers block",
  },
  {
    key: "vm.dirty_background_ratio",
    value: "5",
    why: "start background writeback earlier",
  },
];

export const norm = (v: string): string => v.replace(/\s+/g, " ").trim();

/** Ceilings and buffer sizes: a higher value than the target already satisfies it and is never lowered. */
const CEILING_KEYS =
  /^(fs\.file-max|fs\.inotify\..*|net\.core\.(r|w)mem_max|net\.core\.somaxconn|net\.core\.netdev_max_backlog|net\.ipv4\.tcp_max_syn_backlog|net\.ipv4\.tcp_(r|w)mem)$/;

export function satisfies(key: string, current: string, target: string): boolean {
  if (norm(current) === norm(target)) return true;
  if (!CEILING_KEYS.test(key)) return false;
  const last = (v: string): number => Number(norm(v).split(" ").at(-1));
  const mid = (v: string): number => Number(norm(v).split(" ").at(-2) ?? norm(v));
  if (key.endsWith("tcp_rmem") || key.endsWith("tcp_wmem"))
    return last(current) >= last(target) && mid(current) >= mid(target);
  return Number(norm(current)) >= Number(norm(target));
}

/** Swap sizing rule: 2x RAM up to 2 GiB, 1x up to 8 GiB, then RAM/8 clamped to 4..16 GiB. */
export function suggestedSwapBytes(ramBytes: number): number {
  const GiB = 1024 ** 3;
  if (ramBytes <= 2 * GiB) return 2 * ramBytes;
  if (ramBytes <= 8 * GiB) return ramBytes;
  return Math.min(16 * GiB, Math.max(4 * GiB, Math.round(ramBytes / 8 / GiB) * GiB));
}

export function tuneProbeScript(keys: readonly string[]): string {
  return String.raw`for k in ${keys.join(" ")}; do echo "$k=$(sysctl -n $k 2>/dev/null | tr '\t' ' ')"; done
echo "avail_cc=$(cat /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null)"
echo "thp=$(sed -n 's/.*\[\(.*\)\].*/\1/p' /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null)"
echo "governor=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null)"
echo "nginx_workers=$(grep -hs '^worker_processes' /etc/nginx/nginx.conf | head -1 | tr -d ';' | awk '{print $2}')"
echo "nginx_present=$(command -v nginx >/dev/null 2>&1 && echo yes || echo no)"
echo "limits=$([ -f /etc/security/limits.d/99-yolo.conf ] && echo present || echo absent)"
echo "dropin=$([ -f /etc/sysctl.d/99-yolo-tune.conf ] && echo present || echo absent)"
echo "root_fstype=$(findmnt -no FSTYPE / 2>/dev/null)"
echo "swapfile_yolo=$([ -e /swapfile.yolo ] && echo present || echo absent)"`;
}

export interface TuneRow {
  readonly key: string;
  readonly current: string;
  readonly target: string;
  readonly status: "ok" | "change" | "unavailable";
  readonly source: "yolo" | "aphrody-infra";
  readonly why: string;
}

interface OwnerItem {
  readonly key: string;
  readonly current_value: string;
  readonly recommended_value: string;
  readonly status: string;
  readonly rationale?: string;
}

export function parseOwnerTune(json: string): OwnerItem[] {
  try {
    const j = JSON.parse(json) as { items?: OwnerItem[] };
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
}

export function planTune(
  a: Audit,
  probe: Record<string, string>,
  owner: readonly OwnerItem[],
  policy: Policy,
  host: HostName,
  now: Date,
): { rows: TuneRow[]; plan: Plan } {
  const rows: TuneRow[] = [];
  const steps: Step[] = [];
  const skipped: { what: string; why: string }[] = [];
  const notes: string[] = [];
  const id = a.identity;
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const root = (cmd: string): { cmd: string; blocked?: string | undefined } => {
    const c = asRoot(id, cmd);
    return c === null ? { cmd, blocked: "needs root and passwordless sudo is not available" } : { cmd: c };
  };

  const ownerKeys = new Set(owner.map(o => o.key));
  for (const o of owner)
    rows.push({
      key: o.key,
      current: norm(o.current_value),
      target: norm(o.recommended_value),
      status: norm(o.current_value) === norm(o.recommended_value) ? "ok" : "change",
      source: "aphrody-infra",
      why: o.rationale ?? "",
    });
  const ownerPending = owner.filter(o => norm(o.current_value) !== norm(o.recommended_value));
  for (const o of ownerPending)
    if (satisfies(o.key, o.current_value, o.recommended_value))
      notes.push(
        `aphrody-infra ssh tune would LOWER ${o.key} from ${norm(o.current_value)} to ${norm(o.recommended_value)}`,
      );
  if (ownerPending.length > 0)
    steps.push({
      id: "owner-tune",
      title: `aphrody-infra ssh tune --apply (${ownerPending.length} setting(s): ${ownerPending.map(o => o.key).join(", ")})`,
      kind: "tune",
      cmd: `aphrody-infra ssh tune --host ${host} --json --apply`,
      mutates: true,
      undo: `sysctl -w ${ownerPending.map(o => `${o.key}="${norm(o.current_value)}"`).join(" ")}`,
      metricPaths: ["/"],
    });

  const swappiness = String(policy.tune.swappiness);
  const targets: TuneTarget[] = [
    ...SYSCTL_TARGETS,
    {
      key: "vm.swappiness",
      value: swappiness,
      why: "prefer RAM and zram before disk swap",
    },
  ];
  const available = (probe["avail_cc"] ?? "").split(/\s+/);
  const ours: TuneTarget[] = [];
  // every key yolo manages that is set exactly or needs a change goes into the drop-in, so a later run
  // never drops a setting that was applied earlier (values satisfied by a higher setting are left alone)
  const managed: TuneTarget[] = [];
  for (const t of targets) {
    if (ownerKeys.has(t.key)) continue;
    const current = norm(probe[t.key] ?? "");
    if (current === "") {
      rows.push({
        key: t.key,
        current: "n/a",
        target: t.value,
        status: "unavailable",
        source: "yolo",
        why: t.why,
      });
      continue;
    }
    if (t.key === "net.ipv4.tcp_congestion_control" && !available.includes("bbr")) {
      rows.push({
        key: t.key,
        current,
        target: "bbr",
        status: "unavailable",
        source: "yolo",
        why: "tcp_bbr is not available in this kernel",
      });
      continue;
    }
    const status = satisfies(t.key, current, t.value) ? "ok" : "change";
    rows.push({
      key: t.key,
      current,
      target: t.value,
      status,
      source: "yolo",
      why: status === "ok" && current !== norm(t.value) ? `${t.why} (current is already higher: kept)` : t.why,
    });
    if (status === "change") ours.push(t);
    if (status === "change" || current === norm(t.value)) managed.push(t);
  }
  if (ours.length > 0) {
    const file = "/etc/sysctl.d/99-yolo-tune.conf";
    const content = managed.map(t => `${t.key} = ${t.value}`);
    const modprobe = managed.some(t => t.key === "net.ipv4.tcp_congestion_control")
      ? "modprobe tcp_bbr 2>/dev/null; "
      : "";
    const cmd = `${modprobe}printf '%s\\n' ${content.map(sq).join(" ")} > ${file}.tmp && if [ -f ${file} ] && cmp -s ${file}.tmp ${file}; then rm -f ${file}.tmp; else { [ -f ${file} ] && cp -a ${file} ${file}.bak-${stamp}; mv ${file}.tmp ${file}; }; fi && sysctl -p ${file}`;
    steps.push({
      id: "sysctl-dropin",
      title: `write ${file} (${ours.length} setting(s)) and load it`,
      kind: "exec",
      mutates: true,
      undo: `sysctl -w ${ours.map(t => `${t.key}="${norm(probe[t.key] ?? "")}"`).join(" ")}; rm ${file}`,
      metricPaths: ["/"],
      ...root(cmd),
    });
  }

  const thp = probe["thp"] ?? "";
  if (thp !== "") {
    const status = thp === policy.tune.thp ? "ok" : "change";
    rows.push({
      key: "transparent_hugepage",
      current: thp,
      target: policy.tune.thp,
      status,
      source: "yolo",
      why: "madvise avoids latency spikes from khugepaged",
    });
    if (status === "change")
      steps.push({
        id: "thp",
        title: `transparent hugepages -> ${policy.tune.thp} (runtime + tmpfiles.d)`,
        kind: "exec",
        mutates: true,
        undo: `echo ${thp} > /sys/kernel/mm/transparent_hugepage/enabled; rm /etc/tmpfiles.d/yolo-thp.conf`,
        ...root(
          `echo ${policy.tune.thp} > /sys/kernel/mm/transparent_hugepage/enabled && printf 'w /sys/kernel/mm/transparent_hugepage/enabled - - - - ${policy.tune.thp}\\n' > /etc/tmpfiles.d/yolo-thp.conf`,
        ),
      });
  }

  const gov = probe["governor"] ?? "";
  if (gov === "")
    rows.push({
      key: "cpu governor",
      current: "n/a (no cpufreq: virtualised host)",
      target: policy.tune.governor,
      status: "unavailable",
      source: "yolo",
      why: "",
    });
  else {
    const status = gov === policy.tune.governor ? "ok" : "change";
    rows.push({
      key: "cpu governor",
      current: gov,
      target: policy.tune.governor,
      status,
      source: "yolo",
      why: "constant frequency for builds",
    });
    if (status === "change")
      steps.push({
        id: "governor",
        title: `cpu governor -> ${policy.tune.governor}`,
        kind: "exec",
        mutates: true,
        undo: `for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo ${gov} > $f; done`,
        ...root(
          `for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo ${policy.tune.governor} > $f; done`,
        ),
      });
  }

  if (probe["nginx_present"] === "yes") {
    const cur = probe["nginx_workers"] ?? "";
    const target = policy.tune.nginxWorkers === "cpus" ? String(id.cpus) : policy.tune.nginxWorkers;
    const status = cur === target ? "ok" : "change";
    rows.push({
      key: "nginx worker_processes",
      current: cur || "unset",
      target,
      status,
      source: "yolo",
      why: `${id.cpus} CPUs`,
    });
    if (status === "change") {
      const conf = "/etc/nginx/nginx.conf";
      steps.push({
        id: "nginx-workers",
        title: `nginx worker_processes ${cur || "unset"} -> ${target} (backup, nginx -t, reload; restore on failure)`,
        kind: "exec",
        mutates: true,
        undo: `cp -a ${conf}.yolo-bak-${stamp} ${conf} && nginx -t && systemctl reload nginx`,
        ...root(
          `cp -a ${conf} ${conf}.yolo-bak-${stamp} && sed -i 's/^worker_processes .*/worker_processes ${target};/' ${conf} && if nginx -t; then systemctl reload nginx; else cp -a ${conf}.yolo-bak-${stamp} ${conf}; echo "nginx -t failed, restored" >&2; exit 1; fi`,
        ),
      });
    }
  }

  const limits = probe["limits"] ?? "absent";
  rows.push({
    key: "nofile limits (limits.d)",
    current: limits,
    target: "present",
    status: limits === "present" ? "ok" : "change",
    source: "yolo",
    why: "1048576 open files for login sessions",
  });
  if (limits !== "present")
    steps.push({
      id: "limits",
      title: "write /etc/security/limits.d/99-yolo.conf (nofile 1048576)",
      kind: "exec",
      mutates: true,
      undo: "rm /etc/security/limits.d/99-yolo.conf",
      ...root(
        `printf '%s\\n' '* soft nofile 1048576' '* hard nofile 1048576' 'root soft nofile 1048576' 'root hard nofile 1048576' > /etc/security/limits.d/99-yolo.conf`,
      ),
    });

  // swap sizing: only creates a swap file when there is no swap at all; never resizes or removes
  const swapTotal =
    a.swap.devices.reduce((n, s) => n + s.sizeBytes, 0) + a.swap.zram.reduce((n, z) => n + z.diskSizeBytes, 0);
  const wantSwap = suggestedSwapBytes(a.memory.totalBytes);
  const swapOk = swapTotal >= wantSwap;
  rows.push({
    key: "swap + zram",
    current: fmtBytes(swapTotal),
    target: `>= ${fmtBytes(wantSwap)}`,
    status: swapOk ? "ok" : "change",
    source: "yolo",
    why: `RAM ${fmtBytes(a.memory.totalBytes)}`,
  });
  if (swapTotal === 0 && a.memory.totalBytes > 0) {
    const fsOk = ["ext4", "xfs"].includes(probe["root_fstype"] ?? "");
    if (!fsOk)
      skipped.push({
        what: "swap file",
        why: `root filesystem is ${probe["root_fstype"] || "unknown"}: no swap file on it`,
      });
    else if (probe["swapfile_yolo"] === "present") skipped.push({ what: "/swapfile.yolo", why: "exists already" });
    else
      steps.push({
        id: "swapfile",
        title: `create /swapfile.yolo (${fmtBytes(wantSwap)}), swapon, fstab entry with nofail (fstab backed up)`,
        kind: "exec",
        mutates: true,
        undo: "swapoff /swapfile.yolo && rm /swapfile.yolo && restore /etc/fstab from /etc/fstab.yolo-bak-*",
        metricPaths: ["/"],
        timeoutSecs: 600,
        ...root(
          `fallocate -l ${wantSwap} /swapfile.yolo && chmod 600 /swapfile.yolo && mkswap /swapfile.yolo && swapon /swapfile.yolo && cp -a /etc/fstab /etc/fstab.yolo-bak-${stamp} && (grep -qs '^/swapfile.yolo ' /etc/fstab || echo '/swapfile.yolo none swap sw,nofail 0 0' >> /etc/fstab)`,
        ),
      });
  } else if (!swapOk)
    notes.push(
      "swap/zram below the suggested size; yolo does not resize an existing swap, change it with the owner of that setup",
    );

  if (host !== "local" && owner.length === 0)
    notes.push("aphrody-infra ssh tune returned no items; only yolo's own targets are shown");
  notes.push(
    "a sysctl value owned by aphrody-infra ssh tune is applied through it; yolo adds the settings it does not manage",
  );
  return { rows, plan: { host, command: "tune", steps, notes, skipped } };
}

export function renderTune(rows: readonly TuneRow[]): string {
  return table([
    ["SETTING", "CURRENT", "TARGET", "STATUS", "BY"],
    ...rows.map(r => [r.key, r.current, r.target, r.status, r.source]),
  ]);
}

// ------------------------------------------------------------------------------------------------- net

export interface CurlStats {
  readonly sizeBytes: number;
  readonly totalSecs: number;
  readonly connectSecs: number;
  readonly ttfbSecs: number;
  readonly bytesPerSec: number;
}

export const CURL_FORMAT =
  "size=%{size_download} total=%{time_total} connect=%{time_connect} ttfb=%{time_starttransfer} speed=%{speed_download}";

export function parseCurlStats(text: string): CurlStats | null {
  const kv = parseKeyValues(text.trim().split(/\s+/).join("\n"));
  const size = Number(kv["size"]);
  const total = Number(kv["total"]);
  if (!Number.isFinite(size) || !Number.isFinite(total) || total <= 0) return null;
  return {
    sizeBytes: size,
    totalSecs: total,
    connectSecs: Number(kv["connect"]) || 0,
    ttfbSecs: Number(kv["ttfb"]) || 0,
    bytesPerSec: Number(kv["speed"]) || size / total,
  };
}

export const mbit = (bytesPerSec: number): number => (bytesPerSec * 8) / 1e6;

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].toSorted((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export function netUrl(size: number, base = "https://speed.cloudflare.com/__down"): string {
  return `${base}?bytes=${size}`;
}

export function hostCurlCommand(url: string): string {
  return `curl -sS -o /dev/null --max-time 90 -w ${sq(CURL_FORMAT)} ${sq(url)}`;
}

export async function sshEndpoint(alias: string): Promise<{ hostname: string; port: number }> {
  const p = Bun.spawn(["ssh", "-G", alias], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(p.stdout).text();
  const kv = Object.fromEntries(text.split("\n").map(l => [l.split(" ")[0], l.split(" ").slice(1).join(" ")]));
  return {
    hostname: String(kv["hostname"] ?? alias),
    port: Number(kv["port"] ?? 22),
  };
}

export async function tcpConnectMs(hostname: string, port: number): Promise<number> {
  const t0 = Bun.nanoseconds();
  let first = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connect timeout")), 5000);
    Bun.connect({
      hostname,
      port,
      socket: {
        open() {
          first = Bun.nanoseconds();
        },
        data(socket) {
          clearTimeout(timer);
          socket.end();
          resolve();
        },
        error(_s, e) {
          clearTimeout(timer);
          reject(e);
        },
        close() {},
      },
    }).catch(reject);
  });
  return (first - t0) / 1e6;
}

export function planNet(host: HostName, size: number, url: string): Plan {
  const steps: Step[] = [];
  if (host !== "local") {
    steps.push({
      id: "tcp",
      title: "TCP connect latency from this machine to the host's ssh port (Bun.connect, 5 samples)",
      kind: "inproc",
      cmd: `Bun.connect ${host}:<ssh port from \`ssh -G ${host}\`>`,
      mutates: false,
      undo: null,
    });
    steps.push({
      id: "rtt",
      title: "ssh exec round trip through aphrody-infra (3 samples)",
      kind: "exec",
      cmd: "true",
      mutates: false,
      undo: null,
    });
    steps.push({
      id: "down-host",
      title: `download ${fmtBytes(size)} on the host (known size)`,
      kind: "exec",
      cmd: hostCurlCommand(url),
      mutates: false,
      undo: null,
      timeoutSecs: 120,
    });
  }
  steps.push({
    id: "down-local",
    title: `download ${fmtBytes(size)} from this machine (fetch, known size)`,
    kind: "inproc",
    cmd: `fetch(${url})`,
    mutates: false,
    undo: null,
  });
  return {
    host,
    command: "net",
    steps,
    notes: ["measurements only; nothing on the host is modified"],
    skipped: [],
  };
}

export async function runNet(
  t: Transport,
  host: HostName,
  size: number,
  url: string,
  out: (s: string) => void,
  json: boolean,
): Promise<number> {
  const result: Record<string, unknown> = { host, url, sizeBytes: size };
  const rows: string[][] = [["MEASUREMENT", "VALUE", "UNIT"]];
  if (host !== "local") {
    const ep = await sshEndpoint(host);
    const ms: number[] = [];
    for (let i = 0; i < 5; i++)
      // oxlint-disable-next-line no-await-in-loop -- latency samples are taken one after another: concurrent probes would contend and skew each other's timing
      ms.push(await tcpConnectMs(ep.hostname, ep.port).catch(() => Number.NaN));
    const good = ms.filter(Number.isFinite);
    result["tcpConnectMs"] = {
      endpoint: `${ep.hostname}:${ep.port}`,
      min: Math.min(...good),
      median: median(good),
      samples: ms,
    };
    rows.push(
      ["tcp connect (this machine -> host:" + ep.port + ") min", Math.min(...good).toFixed(1), "ms"],
      ["tcp connect median", median(good).toFixed(1), "ms"],
    );
    const rtt: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Bun.nanoseconds();
      // oxlint-disable-next-line no-await-in-loop -- latency samples are taken one after another: concurrent probes would contend and skew each other's timing
      await t.exec("true", 30);
      rtt.push((Bun.nanoseconds() - t0) / 1e6);
    }
    result["sshExecMs"] = { median: median(rtt), samples: rtt };
    rows.push(["ssh exec round trip (aphrody-infra) median", median(rtt).toFixed(0), "ms"]);
    const r = await t.exec(hostCurlCommand(url), 120);
    const stats = r.code === 0 ? parseCurlStats(r.stdout) : null;
    if (stats === null)
      rows.push(["download on the host", `failed (exit ${r.code}) ${r.stderr.trim().slice(0, 80)}`, ""]);
    else {
      result["hostDownload"] = {
        ...stats,
        mbitPerSec: mbit(stats.bytesPerSec),
        complete: stats.sizeBytes === size,
      };
      rows.push(
        [
          "download ON the host: size received",
          fmtBytes(stats.sizeBytes) + (stats.sizeBytes === size ? "" : " (INCOMPLETE)"),
          "",
        ],
        ["download ON the host: throughput", (stats.bytesPerSec / 1e6).toFixed(1), "MB/s"],
        ["download ON the host: throughput", mbit(stats.bytesPerSec).toFixed(0), "Mbit/s"],
        [
          "download ON the host: connect / first byte",
          `${(stats.connectSecs * 1000).toFixed(0)} / ${(stats.ttfbSecs * 1000).toFixed(0)}`,
          "ms",
        ],
      );
    }
  }
  try {
    const t0 = Bun.nanoseconds();
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    let got = 0;
    let ttfb = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      if (got === 0) ttfb = (Bun.nanoseconds() - t0) / 1e6;
      got += chunk.byteLength;
    }
    const secs = (Bun.nanoseconds() - t0) / 1e9;
    result["localDownload"] = {
      sizeBytes: got,
      secs,
      mbitPerSec: mbit(got / secs),
      ttfbMs: ttfb,
      complete: got === size,
    };
    rows.push(
      ["download FROM this machine (fetch): size received", fmtBytes(got) + (got === size ? "" : " (INCOMPLETE)"), ""],
      ["download FROM this machine (fetch): throughput", (got / secs / 1e6).toFixed(1), "MB/s"],
      ["download FROM this machine (fetch): throughput", mbit(got / secs).toFixed(0), "Mbit/s"],
      ["download FROM this machine (fetch): first byte", ttfb.toFixed(0), "ms"],
    );
  } catch (e) {
    rows.push(["download from this machine", `failed: ${(e as Error).message}`, ""]);
  }
  out(json ? JSON.stringify(result, null, 2) : `${bold(`yolo host net`)} ${host} (${url})\n${table(rows, [1])}`);
  return 0;
}

// ---------------------------------------------------------------------------------------------- mount

export interface MountOptions {
  readonly device: string;
  readonly rw: boolean;
  readonly confirmBackup: boolean;
  readonly fstab: boolean;
  readonly target?: string | undefined;
}

const VOLUME_LAYERS = new Set([
  "LVM2_member",
  "crypto_LUKS",
  "linux_raid_member",
  "zfs_member",
  "swap",
  "bcache",
  "drbd",
]);

/** Mount options that never write to a filesystem that holds data (no journal replay on ext/xfs). */
export function readOnlyOptions(fstype: string): string {
  const base = "ro,nosuid,nodev,noexec";
  if (fstype.startsWith("ext")) return `${base},noload`;
  if (fstype === "xfs") return `${base},norecovery`;
  return base;
}

export function planMount(a: Audit, o: MountOptions, host: HostName, now: Date): Plan {
  const refuse = (why: string): Plan => ({
    host,
    command: "mount",
    steps: [],
    notes: [`refused: ${why}`],
    skipped: [{ what: o.device, why }],
  });
  if (!/^\/dev\/[A-Za-z0-9/_-]+$/.test(o.device)) return refuse("device must look like /dev/sdb1");
  const disk = a.disks.find(d => d.devicePaths.includes(o.device));
  if (disk === undefined)
    return refuse(`${o.device} is not a disk or partition of this host (see \`yolo host audit\`)`);
  if (disk.state === "system") return refuse(`${o.device} belongs to the disk carrying the running system`);
  const fs = disk.filesystems.find(f => f.path === o.device);
  if (fs === undefined) {
    return refuse(
      disk.path === o.device && disk.filesystems.length > 0
        ? `${o.device} is a whole disk with partitions: choose one of ${disk.filesystems.map(f => f.path).join(", ")}`
        : `${o.device} has no filesystem: yolo never formats or wipes a disk`,
    );
  }
  if (VOLUME_LAYERS.has(fs.fstype))
    return refuse(`${o.device} is a ${fs.fstype} volume layer: assemble or unlock it first, yolo does not`);
  if (fs.mounted) return refuse(`${o.device} is already mounted (nothing to do)`);
  if (o.rw && !o.confirmBackup)
    return refuse(
      `${o.device} already holds an existing ${fs.fstype} filesystem with data: --rw also needs --i-know-this-is-a-backup (it only confirms that writing is intended, it never wipes)`,
    );

  const name = basename(o.device);
  const target = o.target ?? `/mnt/yolo/${name}`;
  let t: string;
  try {
    t = normalizePath(target);
  } catch (e) {
    return refuse((e as Error).message);
  }
  if (!(t.startsWith("/mnt/") || t.startsWith("/media/")))
    return refuse(`mount point ${t} must be under /mnt or /media`);
  const opts = o.rw ? "rw,nosuid,nodev,noexec,nofail" : `${readOnlyOptions(fs.fstype)},nofail`;
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const id = a.identity;
  const root = (cmd: string): { cmd: string; blocked?: string | undefined } => {
    const c = asRoot(id, cmd);
    return c === null ? { cmd, blocked: "needs root and passwordless sudo is not available" } : { cmd: c };
  };
  const steps: Step[] = [
    {
      id: "mkdir",
      title: `create the mount point ${t} (must be empty)`,
      kind: "exec",
      mutates: true,
      undo: `rmdir ${t}`,
      ...root(`mkdir -p -- ${sq(t)} && [ -z "$(ls -A -- ${sq(t)})" ]`),
    },
    {
      id: "mount",
      title: `mount ${o.device} (${fs.fstype}) ${o.rw ? "READ-WRITE" : "read-only"} at ${t}`,
      kind: "exec",
      mutates: true,
      undo: `umount ${t}`,
      ...root(
        `mountpoint -q ${sq(t)} || mount -t ${sq(fs.fstype)} -o ${opts.replace(",nofail", "")} ${sq(o.device)} ${sq(t)}`,
      ),
    },
    {
      id: "verify",
      title: "verify the mount",
      kind: "exec",
      mutates: false,
      undo: null,
      cmd: `findmnt -n -o TARGET,SOURCE,FSTYPE,OPTIONS ${sq(t)} && df -PB1 ${sq(t)}`,
    },
  ];
  if (o.fstab) {
    const ref = fs.uuid === null ? o.device : `UUID=${fs.uuid}`;
    const line = `${ref} ${t} ${fs.fstype} ${opts} 0 2`;
    steps.push({
      id: "fstab",
      title: "add an fstab entry with nofail (fstab backed up first)",
      kind: "exec",
      mutates: true,
      undo: `restore /etc/fstab from /etc/fstab.yolo-bak-${stamp}`,
      ...root(
        `cp -a /etc/fstab /etc/fstab.yolo-bak-${stamp} && (grep -qsF ${sq(`${ref} ${t} `)} /etc/fstab || echo ${sq(line)} >> /etc/fstab)`,
      ),
    });
  }
  return {
    host,
    command: "mount",
    steps,
    notes: [
      `${o.device}: ${fs.fstype}${fs.label ? ` "${fs.label}"` : ""}, ${fmtBytes(fs.sizeBytes)}; formatting is never implemented`,
    ],
    skipped: [],
  };
}

// ------------------------------------------------------------------------------------------- archive

export interface ArchiveOptions {
  readonly sources: readonly string[];
  readonly to: string;
  readonly pull?: string | undefined;
  readonly removeSource: boolean;
  readonly pgDump?: string | undefined;
  readonly pgUser?: string | undefined;
  readonly level: number;
  readonly threads: number;
  readonly sudo: boolean;
  readonly stamp?: string | undefined;
}

const SIMPLE_PATH = /^\/[\w./@+-]+$/;

export function archiveLabel(path: string): string {
  return (
    normalizePath(path)
      .replace(/^\//, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-") || "root"
  );
}

/** Pure: the archive plan for one or more sources. Everything that runs is visible in `cmd`. */
export function planArchive(a: Audit, o: ArchiveOptions, host: HostName, policy: Policy, now: Date): Plan {
  const steps: Step[] = [];
  const skipped: { what: string; why: string }[] = [];
  const notes: string[] = [];
  const ctx = pathContext(a, host, policy);
  const day = o.stamp ?? now.toISOString().slice(0, 10).replaceAll("-", "");
  const refuse = (what: string, why: string): void => void skipped.push({ what, why });
  let to: string;
  try {
    to = normalizePath(o.to);
    if (!SIMPLE_PATH.test(to)) throw new Error(`--to must use only letters, digits and ._/@+- (got ${o.to})`);
    if (o.pull !== undefined && !SIMPLE_PATH.test(normalizePath(o.pull)))
      throw new Error(`--pull must use only letters, digits and ._/@+- (got ${o.pull})`);
  } catch (e) {
    return {
      host,
      command: "archive",
      steps: [],
      notes: [`refused: ${(e as Error).message}`],
      skipped: [],
    };
  }
  const nice = `nice -n 19${a.identity.tools["ionice"] ? " ionice -c3" : ""}`;
  const sudo = o.sudo ? "sudo -n " : "";
  if (o.sudo && !a.identity.privileged && a.identity.uid !== 0)
    notes.push("--sudo requested but passwordless sudo is not available");

  const local = host === "local";
  /** Off-host copy of `main` and its manifest `sum`, resumable, then an in-process SHA-256 comparison. */
  const pullSteps = (group: string, main: string, sum: string): Step[] => {
    const dest = normalizePath(o.pull as string);
    const files = [main, sum];
    const rsync = local
      ? `rsync -a --partial --append-verify ${files.map(sq).join(" ")} ${sq(`${dest}/`)}`
      : `rsync -a --partial --append-verify -e ssh ${files.map(f => sq(`${host}:${f}`)).join(" ")} ${sq(`${dest}/`)}`;
    const rcloneRemote = (f: string): string => sq(local ? f : `${host.toUpperCase()}:${f}`);
    const rcloneEnv = local
      ? ""
      : `RCLONE_CONFIG_${host.toUpperCase()}_TYPE=sftp RCLONE_CONFIG_${host.toUpperCase()}_SSH=${sq(`ssh ${host}`)} `;
    const rclone = files
      .map(f => `${rcloneEnv}rclone copyto ${rcloneRemote(f)} ${sq(`${dest}/${posix.basename(f)}`)} --checksum`)
      .join(" && ");
    return [
      {
        id: `pull:${group}`,
        title: `pull ${posix.basename(main)} off the host into ${dest} (resumable: rsync --partial --append-verify, rclone --checksum when rsync is missing)`,
        kind: "local-exec",
        mutates: true,
        undo: `rm -f ${files.map(f => sq(`${dest}/${posix.basename(f)}`)).join(" ")}`,
        group,
        timeoutSecs: 86400,
        cmd: `mkdir -p -- ${sq(dest)} && { command -v rsync >/dev/null && ${rsync} || ${rclone}; }`,
      },
      {
        id: `pull-verify:${group}`,
        title: `verify the pulled copy: sha256 (Bun.CryptoHasher) of ${dest}/${posix.basename(main)} equals the host manifest`,
        kind: "inproc",
        mutates: false,
        undo: null,
        group,
        cmd: `sha256(${dest}/${posix.basename(main)}) == $(cat ${sum} on ${host})`,
        record: (r, st) =>
          void st.verification.set(group, {
            ...st.verification.get(group),
            pullChecksumMatches: r.ok,
          }),
        run: async ctx2 => {
          const m = await ctx2.transport.exec(`cat ${sq(sum)}`, 60);
          const expected = /^([0-9a-f]{64})\s/.exec(m.stdout)?.[1];
          if (m.code !== 0 || expected === undefined)
            return {
              ok: false,
              code: 1,
              output: "",
              note: "host manifest unreadable",
            };
          const hasher = new Bun.CryptoHasher("sha256");
          for await (const chunk of Bun.file(`${dest}/${posix.basename(main)}`).stream()) hasher.update(chunk);
          const actual = hasher.digest("hex");
          return {
            ok: actual === expected,
            code: actual === expected ? 0 : 1,
            output: "",
            note: `local ${actual.slice(0, 16)} vs manifest ${expected.slice(0, 16)}`,
          };
        },
      },
    ];
  };

  // a database dump is its own group: its verification gates the removal of every source
  const pgGroup = o.pgDump === undefined ? undefined : `pg:${o.pgDump}`;
  if (o.pgDump !== undefined && pgGroup !== undefined) {
    const db = o.pgDump;
    const dump = `${to}/${archiveLabel(`/db/${db}`)}-${day}.dump`;
    const who = o.pgUser === undefined ? "" : `sudo -n -u ${sq(o.pgUser)} `;
    steps.push({
      id: `pg-dump:${db}`,
      title: `pg_dump -Fc ${db} -> ${dump}`,
      kind: "exec",
      mutates: true,
      undo: `rm -f ${dump} ${dump}.sha256`,
      group: pgGroup,
      timeoutSecs: 86400,
      cmd: `mkdir -p -- ${sq(to)} && if [ -e ${sq(dump)} ]; then echo "dump exists, reusing"; else rm -f ${sq(`${dump}.part`)}; ${nice} ${who}pg_dump -Fc ${sq(db)} > ${sq(`${dump}.part`)} && mv -f ${sq(`${dump}.part`)} ${sq(dump)}; fi`,
    });
    steps.push({
      id: `pg-verify:${db}`,
      title: `verify: pg_restore -l ${dump} lists table-of-contents entries; sha256 manifest`,
      kind: "exec",
      mutates: true,
      undo: `rm -f ${dump}.sha256`,
      group: pgGroup,
      cmd: `n=$(pg_restore -l ${sq(dump)} 2>/dev/null | grep -c '^[0-9]'); echo "toc_entries=$n"; [ "$n" -gt 0 ] && cd ${sq(to)} && sha256sum -b -- ${sq(posix.basename(dump))} > ${sq(`${dump}.sha256`)} && sha256sum -c --quiet -- ${sq(`${dump}.sha256`)}`,
      record: (r, st) =>
        void st.verification.set(pgGroup, {
          ...st.verification.get(pgGroup),
          dumpListed: r.ok,
        }),
    });
    if (o.pull !== undefined) steps.push(...pullSteps(pgGroup, dump, `${dump}.sha256`));
  }

  for (const raw of o.sources) {
    let src: string;
    try {
      src = normalizePath(raw);
    } catch (e) {
      refuse(raw, (e as Error).message);
      continue;
    }
    if (
      ["/", "/proc", "/sys", "/dev", "/run"].includes(src) ||
      src.startsWith("/proc/") ||
      src.startsWith("/sys/") ||
      src.startsWith("/dev/")
    ) {
      refuse(src, "virtual or root filesystem: not archivable");
      continue;
    }
    if (to === src || to.startsWith(`${src}/`)) {
      refuse(src, `the archive directory ${to} is inside the source`);
      continue;
    }
    const label = archiveLabel(src);
    const arc = `${to}/${label}-${day}.tar.zst`;
    const part = `${arc}.part`;
    const sum = `${arc}.sha256`;
    const group = src;
    const prot = protectedReason(src, ctx);
    if (prot !== null) notes.push(`${src} is ${prot}: it can only be reduced through this archive + verify path`);
    if (isDatabasePath(src))
      notes.push(
        `${src} is database state: a file-level archive of a live database may be inconsistent, use --pg-dump for PostgreSQL`,
      );
    const refusals = removalRefusals(src, ctx);
    const wantRemove = o.removeSource && refusals.length === 0;
    if (o.removeSource && refusals.length > 0) notes.push(`--remove-source refused for ${src}: ${refusals.join("; ")}`);

    steps.push({
      id: `precheck:${src}`,
      title: `precheck ${src}: tools, source exists, free space in ${to}`,
      kind: "exec",
      mutates: true,
      undo: null,
      group,
      timeoutSecs: 600,
      cmd:
        `command -v zstd >/dev/null && command -v tar >/dev/null && command -v sha256sum >/dev/null || { echo "zstd, tar and sha256sum are required" >&2; exit 4; }; ` +
        `${sudo}test -e ${sq(src)} || { echo "source does not exist" >&2; exit 5; }; mkdir -p -- ${sq(to)} || exit 7; ` +
        `if [ ! -e ${sq(arc)} ]; then need=$(( $(${sudo}du -sxB1 ${sq(src)} 2>/dev/null | cut -f1) / 2 + 268435456 )); avail=$(df -PB1 -- ${sq(to)} | awk 'NR==2{print $4}'); ` +
        `echo "need_bytes=$need avail_bytes=$avail"; [ "$avail" -ge "$need" ] || { echo "not enough free space in ${to}" >&2; exit 6; }; fi`,
    });
    const inner = `${nice} ${sudo}tar -C ${sq(posix.dirname(src))} -cf - -- ${sq(posix.basename(src))} | ${nice} zstd -T${o.threads} -q -${o.level} -o ${sq(part)} && mv -f ${sq(part)} ${sq(arc)}`;
    steps.push({
      id: `create:${src}`,
      title: `tar | zstd -${o.level} ${src} -> ${arc} (nice 19, ionice idle; reuses an existing archive of the same name)`,
      kind: "exec",
      mutates: true,
      undo: `rm -f ${arc} ${sum}`,
      group,
      timeoutSecs: 86400,
      metricPaths: [to],
      cmd: `if [ -e ${sq(arc)} ]; then echo "archive exists, reusing: ${arc}"; else rm -f ${sq(part)}; bash -o pipefail -c ${sq(inner)}; fi`,
    });
    steps.push({
      id: `verify-zstd:${src}`,
      title: `verify: zstd -t ${arc}`,
      kind: "exec",
      mutates: false,
      undo: null,
      group,
      timeoutSecs: 7200,
      cmd: `${nice} zstd -t -q ${sq(arc)}`,
      record: (r, st) =>
        void st.verification.set(group, {
          ...st.verification.get(group),
          zstdTest: r.ok,
        }),
    });
    steps.push({
      id: `verify-count:${src}`,
      title: "verify: entry count of the source equals the entries listed in the archive",
      kind: "exec",
      mutates: false,
      undo: null,
      group,
      timeoutSecs: 7200,
      cmd: `src=$(${sudo}find ${sq(src)} ! -type s 2>/dev/null | wc -l); arc=$(zstd -dc ${sq(arc)} | tar -tf - | wc -l); echo "source_entries=$src archive_entries=$arc"; [ "$src" -gt 0 ] && [ "$src" = "$arc" ]`,
      record: (r, st) =>
        void st.verification.set(group, {
          ...st.verification.get(group),
          entryCountMatches: r.ok,
        }),
    });
    steps.push({
      id: `manifest:${src}`,
      title: `sha256 manifest ${sum} and check it`,
      kind: "exec",
      mutates: true,
      undo: `rm -f ${sum}`,
      group,
      timeoutSecs: 7200,
      cmd: `cd ${sq(to)} && sha256sum -b -- ${sq(posix.basename(arc))} > ${sq(sum)} && sha256sum -c --quiet -- ${sq(sum)} && echo manifest ok`,
      record: (r, st) =>
        void st.verification.set(group, {
          ...st.verification.get(group),
          manifestChecked: r.ok,
        }),
    });

    if (o.pull !== undefined) steps.push(...pullSteps(group, arc, sum));

    if (o.removeSource) {
      steps.push({
        id: `remove:${src}`,
        title: `remove source ${src} (only if every verification above passed in this run)`,
        kind: "exec",
        mutates: true,
        undo: `${nice} zstd -dc ${arc} | tar -C ${posix.dirname(src)} -xf -`,
        group,
        timeoutSecs: 7200,
        metricPaths: [src],
        blocked: wantRemove ? undefined : refusals.join("; "),
        cmd: `if mountpoint -q ${sq(src)}; then echo "${src} is a mount point, refusing" >&2; exit 3; fi; ${sudo}rm -rf --one-file-system -- ${sq(src)}`,
        gate: async (rc, st) => {
          const v = st.verification.get(group) ?? {};
          const need: Verification = {
            zstdTest: v.zstdTest === true,
            entryCountMatches: v.entryCountMatches === true,
            manifestChecked: v.manifestChecked === true,
            ...(pgGroup !== undefined
              ? {
                  dumpListed: st.verification.get(pgGroup)?.dumpListed === true,
                }
              : {}),
            ...(o.pull !== undefined
              ? {
                  pullChecksumMatches:
                    v.pullChecksumMatches === true &&
                    (pgGroup === undefined || st.verification.get(pgGroup)?.pullChecksumMatches === true),
                }
              : {}),
          };
          if (!canRemoveSource(need)) return `verification incomplete or failed (${JSON.stringify(need)}): source kept`;
          const lock = await rc.transport.exec(
            wrapScript(collectorScript(["locks"], rc.policy, effectiveLocks(rc.host, rc.policy))),
            60,
          );
          const held = heldLocks(buildAudit(rc.host, lock.stdout));
          return held.length > 0 ? `build lock held (${held[0]?.path}): source kept` : null;
        },
      });
    }
  }
  if (o.pull !== undefined && local) notes.push("host is local: --pull copies between local directories");
  return { host, command: "archive", steps, notes, skipped };
}

// ------------------------------------------------------------------------------------------------ CLI

interface Flags {
  readonly values: Map<string, string[]>;
  readonly positional: string[];
}

const VALUE_FLAGS = new Set([
  "host",
  "to",
  "pull",
  "policy",
  "tail",
  "size",
  "url",
  "target",
  "pg-dump",
  "pg-user",
  "stop",
  "level",
  "threads",
  "stamp",
  "min-free",
  "fs",
  "parallel",
  "depth",
]);

export function parseFlags(args: readonly string[]): Flags {
  const values = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    let value: string;
    if (eq > 0) value = arg.slice(eq + 1);
    else if (VALUE_FLAGS.has(name)) value = args[++i] ?? "";
    else value = "true";
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  return { values, positional };
}

const HELP = `Usage: yolo host <command> --host vps|dbfr|local [options]

  audit                 Inventory, findings, prioritized reclaim plan (read-only; --json, --print-script)
  reclaim               Remove regenerable data only: apt cache, journal, rotated logs, docker, old build output
  archive <path..>      tar | zstd to --to DIR, verify (zstd -t, entry count, sha256), optionally --pull DIR,
                        --pg-dump DB, and only then --remove-source
  services              Classify running services by host-policy.toml; --stop UNIT, --disable, --candidates
  tune                  sysctl (BBR, fq, buffers), THP, CPU governor, nginx workers, swap sizing
  net                   Latency and bandwidth (--size BYTES, --url URL)
  mount <device>        Read-only by default; --rw needs --i-know-this-is-a-backup; --fstab adds a nofail entry
  journal               What --apply did (var/host/<host>/journal.jsonl); --tail N, --json
  space <path..>        What deleting these paths really frees (hard-link aware) and whether the disk keeps
                        --min-free RATIO (variable: flag, YOLO_MIN_FREE, [space] min_free, default 0.2) on --fs MOUNT (default /);
                        scanned recursively and in parallel (--parallel N, --depth N); read-only, --sudo, --json

Every command is a plan unless --apply is given. --policy FILE selects another host-policy.toml.
Mutations are refused while a build lock is held. Nothing is ever formatted or wiped.`;

export async function runHostCommand(
  args: readonly string[],
  yoloRoot: string,
  deps: { transport?: Transport; out?: (s: string) => void; now?: Date } = {},
): Promise<number> {
  const out = deps.out ?? ((s: string): void => console.log(s));
  const sub = args[0];
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    out(HELP);
    return sub === undefined ? 2 : 0;
  }
  if (!(HOST_COMMANDS as readonly string[]).includes(sub)) {
    console.error(`Unknown host command: ${sub}\n`);
    out(HELP);
    return 2;
  }
  const f = parseFlags(args.slice(1));
  const one = (k: string): string | undefined => f.values.get(k)?.at(-1);
  const has = (k: string): boolean => f.values.has(k);
  const hostArg = one("host") ?? process.env["YOLO_HOST"];
  if (hostArg === undefined || !(HOSTS as readonly string[]).includes(hostArg)) {
    console.error(`--host is required: ${HOSTS.join("|")}`);
    return 2;
  }
  const host = hostArg as HostName;
  const apply = has("apply");
  const json = has("json");
  const now = deps.now ?? new Date();

  if (sub === "journal") {
    const entries = await readJournal(yoloRoot, host);
    const tail = Math.max(1, Number(one("tail") ?? 20));
    const shown = entries.slice(-tail);
    if (json) out(JSON.stringify(shown, null, 2));
    else if (shown.length === 0) out(`no journal for ${host} (${journalPath(yoloRoot, host)})`);
    else
      for (const e of shown) {
        const freed =
          e.before !== null && e.after !== null
            ? Object.keys(e.after.freeBytes).reduce(
                (n, k) => n + ((e.after?.freeBytes[k] ?? 0) - (e.before?.freeBytes[k] ?? 0)),
                0,
              )
            : 0;
        out(
          `${e.ts} ${pad(e.status, 7)} ${e.command}/${e.title}${freed !== 0 ? ` (free ${freed > 0 ? "+" : ""}${fmtBytes(freed)})` : ""}${e.undo === null ? "" : `\n    undo: ${e.undo}`}`,
        );
      }
    return 0;
  }

  let transport: Transport;
  try {
    transport = deps.transport ?? makeTransport(host);
  } catch (e) {
    console.error((e as Error).message);
    return 127;
  }
  let loaded: { policy: Policy; file: string | null };
  try {
    loaded = loadPolicy(yoloRoot, host, one("policy"));
  } catch (e) {
    console.error(`host-policy.toml: ${(e as Error).message}`);
    return 2;
  }
  const { policy, file: policyPath } = loaded;
  const ctx: RunContext = {
    host,
    command: sub,
    transport,
    local: new LocalTransport(),
    policy,
    yoloRoot,
    out,
  };

  try {
    if (sub === "audit") {
      if (has("print-script")) {
        out(collectorScript(SECTIONS, policy, effectiveLocks(host, policy)));
        return 0;
      }
      const a = await collect(transport, policy);
      const findings = analyze(
        a,
        resolveMinFree({
          flag: one("min-free"),
          env: process.env["YOLO_MIN_FREE"],
          policy: policy.space.minFree,
        }),
      );
      const plan = planReclaim(a, policy, host);
      const suggestions = archiveSuggestions(a, policy, host);
      if (json)
        out(
          JSON.stringify(
            {
              ...a,
              findings,
              reclaimPlan: plan.steps.map(stepJson),
              archiveFirst: suggestions,
              skipped: plan.skipped,
            },
            null,
            2,
          ),
        );
      else
        out(
          renderAudit(a, findings, plan, suggestions) +
            `\n\n${dim(`policy: ${policyPath ?? "built-in defaults (no host-policy.toml found)"}`)}`,
        );
      return 0;
    }

    if (sub === "reclaim") {
      const a = await collect(transport, policy);
      return finish(planReclaim(a, policy, host), ctx, apply, json);
    }

    if (sub === "services") {
      const a = await collect(transport, policy, ["identity", "services"]);
      const { rows, plan } = planServices(a, policy, host, {
        stop: (f.values.get("stop") ?? []).flatMap(s => s.split(",")).filter(s => s !== ""),
        disable: has("disable"),
        candidates: has("candidates") || (!has("stop") && !has("no-candidates")),
      });
      if (!json)
        out(
          `${bold("Running services")} (${rows.length}) classified by ${policyPath ?? "built-in policy"}\n${renderServices(rows)}\n`,
        );
      return finish(plan, ctx, apply, json);
    }

    if (sub === "tune") {
      const a = await collect(transport, policy, ["identity", "meminfo", "swapon", "zram", "locks"]);
      const keys = [...SYSCTL_TARGETS.map(t => t.key), "vm.swappiness"];
      const probe = parseKeyValues((await transport.exec(tuneProbeScript(keys), 60)).stdout);
      const ownerRes = host === "local" ? null : await transport.tune(false);
      const owner = ownerRes !== null && ownerRes.code === 0 ? parseOwnerTune(ownerRes.stdout) : [];
      const { rows, plan } = planTune(a, probe, owner, policy, host, now);
      if (!json) out(`${bold("Tuning")} on ${host}\n${renderTune(rows)}\n`);
      return finish(plan, ctx, apply, json);
    }

    if (sub === "space") {
      if (f.positional.length === 0) {
        console.error(
          "Usage: yolo host space <path..> --host H [--min-free R] [--fs /] [--parallel N] [--depth N] [--sudo] [--json]",
        );
        return 2;
      }
      let minFree: number;
      try {
        minFree = resolveMinFree({
          flag: one("min-free"),
          env: process.env["YOLO_MIN_FREE"],
          policy: policy.space.minFree,
        });
      } catch (e) {
        console.error((e as Error).message);
        return 2;
      }
      const fs = one("fs") ?? "/";
      const parallel = Math.max(1, Number(one("parallel") ?? policy.space.parallel));
      const depth = Math.max(0, Number(one("depth") ?? policy.space.splitDepth));
      const scanStart = performance.now();
      const links = await scanLinks(f.positional, {
        run: async cmd => (await transport.exec(`timeout 300 nice -n 19 ionice -c3 ${cmd}`, 330)).stdout,
        depth,
        parallel,
        sudo: has("sudo"),
      });
      const scanMs = Math.round(performance.now() - scanStart);
      const df = await transport.exec(`df -B1 --output=size,avail -- ${sq(fs)}`, 30);
      if (df.code !== 0) {
        console.error(`df ${fs} failed: ${df.stderr.trim()}`);
        return 1;
      }
      const est = estimateReclaim(links);
      const { totalBytes, freeBytes } = parseDfSizeAvail(df.stdout);
      const before = spaceGate(totalBytes, freeBytes, minFree);
      const after = spaceGate(totalBytes, freeBytes + est.freedBytes, minFree);
      if (json) {
        out(
          JSON.stringify(
            {
              host,
              fs,
              totalBytes,
              freeBytes,
              minFree,
              parallel,
              depth,
              scanMs,
              estimate: est,
              before,
              after,
            },
            null,
            2,
          ),
        );
      } else {
        out(
          table([
            ["paths", f.positional.join(" ")],
            [
              "links found",
              `${est.inodes} inodes, ${fmtBytes(est.naiveBytes)} summed per name (${scanMs} ms, ${parallel} parallel, depth ${depth})`,
            ],
            ["unique bytes", fmtBytes(est.uniqueBytes)],
            ["really freed", `${fmtBytes(est.freedBytes)} (${fmtBytes(est.keptBytes)} kept alive by links outside)`],
            [
              "free now",
              `${fmtBytes(freeBytes)} of ${fmtBytes(totalBytes)} on ${fs} (${(before.freeRatio * 100).toFixed(1)} %)`,
            ],
            ["free after", `${fmtBytes(freeBytes + est.freedBytes)} (${(after.freeRatio * 100).toFixed(1)} %)`],
            [
              `floor ${(minFree * 100).toFixed(0)} %`,
              after.ok ? green("reached") : red(`short by ${fmtBytes(after.shortfallBytes)}`),
            ],
          ]),
        );
      }
      return after.ok ? 0 : 3;
    }

    if (sub === "net") {
      const size = Math.max(1, Number(one("size") ?? 50_000_000));
      const url = one("url") ?? netUrl(size);
      const plan = planNet(host, size, url);
      if (!apply) return finish(plan, ctx, false, json);
      return runNet(transport, host, size, url, out, json);
    }

    if (sub === "mount") {
      const device = f.positional[0];
      if (device === undefined) {
        console.error(
          "Usage: yolo host mount <device> --host H [--rw --i-know-this-is-a-backup] [--fstab] [--target DIR] [--apply]",
        );
        return 2;
      }
      const a = await collect(transport, policy, ["identity", "lsblk", "locks"]);
      const plan = planMount(
        a,
        {
          device,
          rw: has("rw"),
          confirmBackup: has("i-know-this-is-a-backup"),
          fstab: has("fstab"),
          target: one("target"),
        },
        host,
        now,
      );
      const refused = plan.steps.length === 0;
      if (refused) {
        out(red(plan.notes.join("\n")));
        return 3;
      }
      return finish(plan, ctx, apply, json);
    }

    if (sub === "archive") {
      const to = one("to");
      if ((f.positional.length === 0 && !has("pg-dump")) || to === undefined) {
        console.error(
          "Usage: yolo host archive <path..> --to DIR --host H [--pull DIR] [--remove-source] [--pg-dump DB [--pg-user U]] [--sudo] [--level N] [--apply]",
        );
        return 2;
      }
      const a = await collect(transport, policy, FACT_SECTIONS);
      const plan = planArchive(
        a,
        {
          sources: f.positional,
          to,
          pull: one("pull"),
          removeSource: has("remove-source"),
          pgDump: one("pg-dump"),
          pgUser: one("pg-user"),
          level: Math.min(19, Math.max(1, Number(one("level") ?? 3))),
          threads: Math.min(8, Math.max(1, Number(one("threads") ?? 2))),
          sudo: has("sudo"),
          stamp: one("stamp"),
        },
        host,
        policy,
        now,
      );
      if (plan.steps.length === 0) {
        out(red(`nothing to do: ${plan.skipped.map(s => `${s.what}: ${s.why}`).join("; ") || plan.notes.join("; ")}`));
        return 3;
      }
      return finish(plan, ctx, apply, json);
    }
  } catch (e) {
    console.error(`yolo host ${sub}: ${(e as Error).message}`);
    return 1;
  }
  return 2;
}
