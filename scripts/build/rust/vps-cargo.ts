#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * WSL -> VPS Cargo tunnel. Heavy Cargo (check, clippy, test, build --release) never runs in WSL:
 * the exact WSL worktree (HEAD plus uncommitted and untracked files, `.gitignore` respected) is
 * snapshotted into `refs/wsl/snapshot`, sent to a dedicated VPS checkout and built there through
 * `scripts/build/rust/cargo-serial.sh` under the factory heavy lock, inside the remote tmux session.
 * Logs stream back live; artifacts come back with `fetch`. Configuration: config/host/vps-cargo.json.
 *
 *   bun scripts/build/rust/vps-cargo.ts tunnel up|down|status   local tmux: SSH master + git daemon
 *   bun scripts/build/rust/vps-cargo.ts sync [--pull]           snapshot + checkout on the VPS
 *   bun scripts/build/rust/vps-cargo.ts run [--jobs N] [--pull] -- <cargo args>
 *   bun scripts/build/rust/vps-cargo.ts logs <job>              replay a remote job log
 *   bun scripts/build/rust/vps-cargo.ts fetch --bin <name> [--profile release] [--dest <dir>]
 *   bun scripts/build/rust/vps-cargo.ts attach                  attach the remote tmux session
 *
 * `--repo <name>` (sync, run, fetch) builds an external repository declared under `repositories` in the config
 * (for example the private vu runtime repository) through the same tunnel, locks and wrapper: its own worktree is
 * snapshotted into its own ref, pushed to its own VPS checkout and built into its own target directory. The
 * repository does not carry a copy of `cargo-serial.sh`; the wrapper of the Aphrody checkout on the VPS is used.
 */
import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type Forward = { bind: string; to: string; purpose?: string };
/** An external repository built through the tunnel (`--repo <name>`). */
export type RepositoryConfig = {
  /** Local worktree, `~` expanded. */
  root: string;
  remoteWorkspace: string;
  /** Optional factory checkout to share objects with; empty or absent starts from an empty repository. */
  remoteSeed?: string;
  remoteTargetDir: string;
  snapshotRef: string;
  /** Absolute path of cargo-serial.sh on the VPS (an Aphrody checkout). */
  cargoSerial: string;
  remoteEnv?: Record<string, string>;
};

export type VpsCargoConfig = {
  host: string;
  controlPath: string;
  localSession: string;
  remoteSession: string;
  remoteWorkspace: string;
  remoteSeed: string;
  remoteTargetDir: string;
  remoteLockDir: string;
  remoteHeavyLock: string;
  remoteLogDir: string;
  remoteEnv: Record<string, string>;
  jobs: number;
  /** Largest `--jobs` the host accepts (a production host stays below its core count). */
  maxJobs?: number;
  /**
   * False when the host has no GTK 4 development libraries (the CEF desktop runtime; a production server keeps a minimum
   * surface, config/system-packages.json): packages that need them stay on the primary host. Default true.
   */
  desktopLibraries?: boolean;
  /** Crates whose presence in a package's dependency closure means the desktop libraries are needed. */
  desktopSysCrates?: string[];
  /** Per-host overrides merged over this config: secondary build hosts such as dbfr. */
  hosts?: Record<string, Partial<Omit<VpsCargoConfig, "hosts" | "repositories">>>;
  /** External repositories, by name, for `--repo`: primary host only. */
  repositories?: Record<string, RepositoryConfig>;
  /** Wrapper path on the VPS; the Aphrody default is relative to the remote workspace. Set by `--repo`. */
  cargoSerial?: string;
  forwards: { remote: Forward[]; local: Forward[] };
  gitDaemon: { listen: string; port: number; basePath: string; repository: string };
  snapshotRef: string;
  refuseSnapshotPaths: string[];
};

const ROOT = resolve(import.meta.dir, "../../..");
const CONFIG_PATH = join(ROOT, "config/host/vps-cargo.json");
const MAX_SNAPSHOT_FILE_BYTES = 50 * 1024 * 1024;

export function expandHome(path: string, home = homedir()): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/** POSIX single-quote for remote shell commands. */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function loadConfig(path = CONFIG_PATH, host?: string): Promise<VpsCargoConfig> {
  const base = (await Bun.file(path).json()) as VpsCargoConfig;
  if (host === undefined || host === base.host) return base;
  const override = base.hosts?.[host];
  if (!override) throw new Error(`unknown build host "${host}" (config/host/vps-cargo.json hosts)`);
  return { ...base, ...override, remoteEnv: { ...base.remoteEnv, ...override.remoteEnv }, host };
}

/**
 * The configuration of one external repository: its checkout, ref, target directory and wrapper replace the
 * Aphrody ones, everything else (host, locks, tunnel) is shared. Returns the local worktree root with it.
 */
export function repositoryConfig(
  config: VpsCargoConfig,
  name: string,
): { config: VpsCargoConfig; root: string } {
  const repository = config.repositories?.[name];
  if (!repository)
    throw new Error(`unknown repository "${name}" (config/host/vps-cargo.json repositories)`);
  const secondaries = Object.keys(config.hosts ?? {});
  if (secondaries.includes(config.host)) {
    throw new Error(
      `repository "${name}" is configured for the primary host only, not ${config.host}`,
    );
  }
  return {
    root: expandHome(repository.root),
    config: {
      ...config,
      remoteWorkspace: repository.remoteWorkspace,
      remoteSeed: repository.remoteSeed ?? "",
      remoteTargetDir: repository.remoteTargetDir,
      snapshotRef: repository.snapshotRef,
      cargoSerial: repository.cargoSerial,
      remoteEnv: { ...config.remoteEnv, ...repository.remoteEnv },
    },
  };
}

/** True when the primary host's heavy lock is held: a build is running there. */
export function heavyLockBusy(config: VpsCargoConfig): boolean {
  const probe = Bun.spawnSync(
    [...sshBase(config), config.host, `flock -n ${shellQuote(config.remoteHeavyLock)} true`],
    { stdout: "ignore", stderr: "ignore" },
  );
  return probe.exitCode === 1;
}

/** Workspace packages that need the GTK 4 (CEF runtime) development libraries: for plain builds, and with test/dev targets. */
export type DesktopRequirements = { build: Set<string>; all: Set<string> };

type CargoMetadata = {
  packages: { id: string; name: string }[];
  workspace_members: string[];
  resolve: {
    nodes: { id: string; deps: { pkg: string; dep_kinds?: { kind: string | null }[] }[] }[];
  };
};

/**
 * Which workspace members reach one of `sysCrates` through their dependency graph (`cargo metadata`, Linux
 * target): `build` follows normal and build dependencies (check, build, clippy), `all` also dev dependencies
 * (test, `--all-targets`).
 */
export function desktopRequirements(
  metadata: CargoMetadata,
  sysCrates: readonly string[],
): DesktopRequirements {
  const name = new Map(metadata.packages.map((p) => [p.id, p.name] as const));
  const reaching = (kinds: ReadonlySet<string>) => {
    const parents = new Map<string, string[]>();
    for (const node of metadata.resolve.nodes) {
      for (const dep of node.deps) {
        if (!(dep.dep_kinds ?? []).some((k) => kinds.has(k.kind ?? "normal"))) continue;
        const list = parents.get(dep.pkg) ?? [];
        list.push(node.id);
        parents.set(dep.pkg, list);
      }
    }
    const seen = new Set(
      metadata.resolve.nodes
        .filter((n) => sysCrates.includes(name.get(n.id) ?? ""))
        .map((n) => n.id),
    );
    const stack = [...seen];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      for (const parent of parents.get(id) ?? []) {
        if (!seen.has(parent)) {
          seen.add(parent);
          stack.push(parent);
        }
      }
    }
    return new Set(
      metadata.workspace_members.filter((id) => seen.has(id)).map((id) => name.get(id) ?? id),
    );
  };
  return {
    build: reaching(new Set(["normal", "build"])),
    all: reaching(new Set(["normal", "build", "dev"])),
  };
}

const DEV_TARGET_FLAGS = new Set([
  "--all-targets",
  "--tests",
  "--benches",
  "--examples",
  "--test",
  "--bench",
  "--example",
]);
const DEV_SUBCOMMANDS = new Set(["test", "bench", "nextest"]);

/** What a cargo command line selects: its packages, whether it is workspace-wide, and whether it compiles dev targets. */
export function cargoSelection(cargoArgs: readonly string[]) {
  const packages: string[] = [];
  const excluded: string[] = [];
  let workspace = false;
  let devTargets = false;
  let subcommand = "";
  for (let i = 0; i < cargoArgs.length; i++) {
    const arg = cargoArgs[i] as string;
    if (arg === "--") break;
    const next = cargoArgs[i + 1] ?? "";
    if (arg === "-p" || arg === "--package") (packages.push(next), i++);
    else if (arg.startsWith("--package=")) packages.push(arg.slice("--package=".length));
    else if (arg === "--exclude") (excluded.push(next), i++);
    else if (arg.startsWith("--exclude=")) excluded.push(arg.slice("--exclude=".length));
    else if (arg === "--workspace" || arg === "--all") workspace = true;
    else if (DEV_TARGET_FLAGS.has(arg) || /^--(test|bench|example)=/.test(arg)) devTargets = true;
    else if (!subcommand && !arg.startsWith("-") && !arg.startsWith("+")) subcommand = arg;
  }
  if (DEV_SUBCOMMANDS.has(subcommand)) devTargets = true;
  return { subcommand, packages, excluded, workspace, devTargets };
}

/** `name`, `name@version` or a glob such as `aphrody-tauri-*` against one package name. */
export function matchesPackageSpec(spec: string, name: string): boolean {
  const bare = spec.split(/[@:]/, 1)[0] as string;
  if (!/[*?[]/.test(bare)) return bare === name;
  const regex = bare
    .replace(/[.+^${}()|\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(name);
}

/** The packages of this cargo command line that need the desktop libraries (empty: any host can build it). */
export function desktopOffenders(
  cargoArgs: readonly string[],
  requirements: DesktopRequirements,
): string[] {
  const selection = cargoSelection(cargoArgs);
  const needed = selection.devTargets ? requirements.all : requirements.build;
  const scoped = selection.packages.length > 0 && !selection.workspace;
  return [...needed]
    .filter((pkg) =>
      scoped
        ? selection.packages.some((spec) => matchesPackageSpec(spec, pkg))
        : !selection.excluded.some((spec) => matchesPackageSpec(spec, pkg)),
    )
    .sort();
}

/** The cargo arguments of a `run` command line (everything after the first `--`). */
function cargoArgsOf(options: readonly string[]): string[] {
  const separator = options.indexOf("--");
  return separator < 0 ? [] : options.slice(separator + 1);
}

/** Desktop requirements of the worktree, from `cargo metadata` (light, offline), cached by Cargo.lock hash. */
async function worktreeDesktopRequirements(
  sysCrates: readonly string[],
): Promise<DesktopRequirements> {
  const lock = await Bun.file(join(ROOT, "Cargo.lock")).text();
  const key = new Bun.CryptoHasher("sha256")
    .update(lock)
    .update(sysCrates.join(","))
    .digest("hex")
    .slice(0, 16);
  const cache = join(tmpdir(), `vps-cargo-desktop-${key}.json`);
  const cached = Bun.file(cache);
  if (await cached.exists()) {
    const saved = (await cached.json()) as { build: string[]; all: string[] };
    return { build: new Set(saved.build), all: new Set(saved.all) };
  }
  const json =
    await $`cargo metadata --offline --format-version 1 --filter-platform x86_64-unknown-linux-gnu`
      .cwd(ROOT)
      .quiet()
      .text();
  const requirements = desktopRequirements(JSON.parse(json) as CargoMetadata, sysCrates);
  await Bun.write(
    cache,
    JSON.stringify({ build: [...requirements.build], all: [...requirements.all] }),
  );
  return requirements;
}

/** A host without the desktop libraries refuses (explicit `--host`) or yields (`auto`) to packages that need them. */
async function ensureHostCanBuild(
  candidate: VpsCargoConfig,
  primary: VpsCargoConfig,
  options: readonly string[],
  requested: string,
): Promise<VpsCargoConfig> {
  if (candidate.desktopLibraries !== false) return candidate;
  const cargoArgs = cargoArgsOf(options);
  if (cargoArgs.length === 0) return candidate;
  const offenders = desktopOffenders(
    cargoArgs,
    await worktreeDesktopRequirements(primary.desktopSysCrates ?? ["gdk4-sys", "gtk4-sys"]),
  );
  if (offenders.length === 0) return candidate;
  const sample = `${offenders.slice(0, 3).join(", ")}${offenders.length > 3 ? `, … (${offenders.length})` : ""}`;
  if (requested === "auto") {
    console.log(
      `${candidate.host} has no desktop libraries (needed by ${sample}): staying on ${primary.host}`,
    );
    return primary;
  }
  throw new Error(
    `${candidate.host} has no GTK 4 development libraries (minimum host surface); needed by ${sample}. Use --host ${primary.host} or select other packages.`,
  );
}

/** `--host <name|auto>` or VPS_CARGO_HOST: the primary host, a named secondary, or the first idle one. */
export async function selectConfig(options: readonly string[]): Promise<VpsCargoConfig> {
  const requested = flag(options, "--host") ?? process.env["VPS_CARGO_HOST"];
  const primary = await loadConfig();
  if (requested === undefined || requested === primary.host) return primary;
  if (requested !== "auto") {
    return ensureHostCanBuild(
      await loadConfig(CONFIG_PATH, requested),
      primary,
      options,
      requested,
    );
  }
  if (!heavyLockBusy(primary)) return primary;
  const fallback = Object.keys(primary.hosts ?? {})[0];
  if (!fallback) return primary;
  const candidate = await ensureHostCanBuild(
    await loadConfig(CONFIG_PATH, fallback),
    primary,
    options,
    requested,
  );
  if (candidate.host !== fallback) return candidate;
  console.log(`${primary.host} is busy, building on ${fallback}`);
  return candidate;
}

/** Snapshot paths that look like secrets: the snapshot leaves the machine, so it fails closed. */
export function secretLikePaths(paths: readonly string[], patterns: readonly string[]): string[] {
  const regexes = patterns.map((pattern) => new RegExp(pattern, "i"));
  return paths.filter((path) => regexes.some((regex) => regex.test(path)));
}

export function sshBase(config: VpsCargoConfig): string[] {
  return [
    "ssh",
    "-o",
    `ControlPath=${expandHome(config.controlPath)}`,
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPersist=8h",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
  ];
}

/** The persistent, self-reconnecting SSH master carrying both forward directions. */
export function tunnelCommand(config: VpsCargoConfig): string {
  const forwards = [
    ...config.forwards.remote.map((forward) => `-R ${forward.bind}:${forward.to}`),
    ...config.forwards.local.map((forward) => `-L ${forward.bind}:${forward.to}`),
  ];
  const ssh = [
    ...sshBase(config).map(shellQuote),
    "-o",
    "ControlMaster=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-N",
    ...forwards,
    config.host,
  ].join(" ");
  return `while true; do ${ssh}; echo "tunnel lost, reconnecting in 5s"; sleep 5; done`;
}

/** Read-only git daemon on loopback: the VPS reaches it through the reverse forward. */
export function gitDaemonCommand(config: VpsCargoConfig): string {
  const base = expandHome(config.gitDaemon.basePath);
  return [
    "git daemon --reuseaddr --export-all --informative-errors",
    `--listen=${config.gitDaemon.listen}`,
    `--port=${config.gitDaemon.port}`,
    `--base-path=${shellQuote(base)}`,
    shellQuote(join(base, config.gitDaemon.repository)),
  ].join(" ");
}

/** Remote script that creates the dedicated VPS checkout (sharing the factory objects) once. */
export function remoteSeedScript(config: VpsCargoConfig): string {
  const ws = shellQuote(config.remoteWorkspace);
  return [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(config.remoteLockDir)} ${shellQuote(config.remoteLogDir)} ${shellQuote(config.remoteTargetDir)}`,
    // A host without a factory seed checkout starts from an empty repository: the push is a full pack.
    `test -d ${ws}/.git || { test -d ${shellQuote(config.remoteSeed)}/.git && git clone --quiet --shared --no-checkout ${shellQuote(config.remoteSeed)} ${ws} || git init --quiet ${ws}; }`,
  ].join("\n");
}

/** Remote script that moves the dedicated VPS checkout to the snapshot commit. */
export function remoteCheckoutScript(config: VpsCargoConfig, sha: string, pull: boolean): string {
  const port = config.forwards.remote[0]?.bind.split(":").at(-1) ?? "19418";
  const fetch = pull
    ? `git fetch --quiet git://127.0.0.1:${port}/${config.gitDaemon.repository} ${config.snapshotRef}`
    : ":";
  return [
    remoteSeedScript(config),
    `cd ${shellQuote(config.remoteWorkspace)}`,
    fetch,
    // Moving the shared checkout under a running job would corrupt its build: when the factory lock is held, the move
    // is deferred to the job itself (remoteRunScript checks out the snapshot once it owns the lock).
    `if flock -n ${shellQuote(config.remoteHeavyLock)} true; then`,
    `git checkout --quiet --detach --force ${sha}`,
    // Untracked leftovers of a previous snapshot go; ignored outputs (node_modules) stay.
    "git clean -fdq",
    `test "$(git rev-parse HEAD)" = ${sha}`,
    `echo "vps checkout at ${sha.slice(0, 12)}"`,
    "else",
    `git cat-file -e ${sha}^{commit}`,
    `echo "vps factory busy: checkout of ${sha.slice(0, 12)} deferred to the job"`,
    "fi",
  ].join("\n");
}

/** Remote script that runs one cargo-serial job in the remote tmux session and streams its log. */
export function remoteRunScript(
  config: VpsCargoConfig,
  sha: string,
  job: string,
  cargoArgs: readonly string[],
  jobs: number,
): string {
  const log = `${config.remoteLogDir}/${job}.log`;
  const exit = `${config.remoteLogDir}/${job}.exit`;
  const env = Object.entries({
    ...config.remoteEnv,
    APHRODY_CARGO_JOBS: String(jobs),
    APHRODY_CARGO_LOCK_DIR: config.remoteLockDir,
    CARGO_TARGET_DIR: config.remoteTargetDir,
    APHRODY_CARGO_TARGET_DIR: config.remoteTargetDir,
  }).map(([key, value]) => `${key}=${shellQuote(value)}`);
  const body = [
    // Deterministic file modes: tests assert 0o644/0o600 and the builder user's default umask is 002.
    "umask 022",
    `cd ${shellQuote(config.remoteWorkspace)}`,
    `git cat-file -e ${sha}^{commit} || { echo "snapshot ${sha} is not in the checkout" >&2; exit 2; }`,
    `export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"`,
    // The shared checkout is moved to the job snapshot only once this job holds the factory lock: another session may
    // have synced its own snapshot while this job waited, and building then would compile the wrong tree.
    `exec env ${env.join(" ")} flock --close ${shellQuote(config.remoteHeavyLock)} sh -c ${shellQuote(`git checkout -q -f ${sha} || { echo "checkout moved away from ${sha}" >&2; exit 2; }; exec "$@"`)} sh ${shellQuote(config.cargoSerial ?? "scripts/build/rust/cargo-serial.sh")} ${cargoArgs.map(shellQuote).join(" ")}`,
  ].join("; ");
  const window = `bash -c ${shellQuote(`(${body}) > ${log} 2>&1; echo $? > ${exit}`)}`;
  const session = shellQuote(config.remoteSession);
  return [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(config.remoteLogDir)}`,
    `rm -f ${shellQuote(exit)}; : > ${shellQuote(log)}`,
    `tmux has-session -t ${session} 2>/dev/null || tmux new-session -d -s ${session} -n idle`,
    `tmux new-window -d -t ${session} -n ${shellQuote(job)} ${shellQuote(window)}`,
    `tail -n +1 -F ${shellQuote(log)} 2>/dev/null & tailer=$!`,
    `while [ ! -f ${shellQuote(exit)} ]; do sleep 1; done`,
    "sleep 1; kill $tailer 2>/dev/null || true",
    `exit "$(cat ${shellQuote(exit)})"`,
  ].join("\n");
}

async function ssh(config: VpsCargoConfig, script: string): Promise<number> {
  const child = Bun.spawn([...sshBase(config), config.host, "bash -s"], {
    stdin: new Blob([script]),
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

/** A git operation of the snapshot lost a race with another session (lock held, ref moved): retry it. */
export class SnapshotCollision extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotCollision";
  }
}

const COLLISION_PATTERN =
  /index\.lock|cannot lock ref|Unable to create '.*\.lock'|File exists|another git process|unable to write|cannot update the ref/i;

/**
 * Whether an error is a snapshot collision: git exits 128 when it cannot take a lock or update a ref that
 * another session holds (`refs/wsl/snapshot` is shared by every worktree of the repository).
 */
export function isSnapshotCollision(error: unknown): boolean {
  if (error instanceof SnapshotCollision) return true;
  if (typeof error !== "object" || error === null) return false;
  const { exitCode, stderr, message } = error as {
    exitCode?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  if (exitCode !== 128) return false;
  const text = `${stderr ?? ""} ${message ?? ""}`;
  // Exit 128 is also git's generic fatal error: only lock and ref races are worth retrying.
  return text.trim() === "" || COLLISION_PATTERN.test(text);
}

export type BackoffOptions = {
  /** Total tries, first one included. */
  attempts?: number;
  /** Delay before the second try; doubles each time, plus jitter. */
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0, 1): injectable for tests. */
  random?: () => number;
};

/** Retry `operation` with exponential backoff and jitter while it fails with a snapshot collision. */
export async function withSnapshotBackoff<T>(
  operation: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 6;
  const baseMs = options.baseMs ?? 250;
  const sleep = options.sleep ?? Bun.sleep;
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isSnapshotCollision(error)) throw error;
      const delay = baseMs * 2 ** (attempt - 1) * (1 + random());
      console.error(
        `vps-cargo: snapshot collision, retry ${attempt}/${attempts - 1} in ${Math.round(delay)} ms`,
      );
      await sleep(delay);
    }
  }
}

/** Commit the exact worktree (tracked + untracked, ignores honoured) without touching index or HEAD. */
export function snapshot(config: VpsCargoConfig, cwd = ROOT): Promise<string> {
  return withSnapshotBackoff(() => snapshotOnce(config, cwd));
}

async function snapshotOnce(config: VpsCargoConfig, cwd: string): Promise<string> {
  // `.git` is a file in a linked worktree: ask git for the per-worktree directory holding the index.
  const gitDir = (await $`git rev-parse --absolute-git-dir`.cwd(cwd).text()).trim();
  // One scratch index per process: two runs from the same worktree no longer fight over one index file.
  const index = join(gitDir, `vps-cargo.${process.pid}.index`);
  try {
    await Bun.write(index, Bun.file(join(gitDir, "index")));
    const env = { ...process.env, GIT_INDEX_FILE: index };
    await $`git add -A`.cwd(cwd).env(env).quiet();
    const changed = (await $`git diff --cached --name-only HEAD`.cwd(cwd).env(env).text())
      .split("\n")
      .filter(Boolean);
    const refused = secretLikePaths(changed, config.refuseSnapshotPaths);
    if (refused.length > 0) {
      throw new Error(`refusing to snapshot secret-like paths: ${refused.join(", ")}`);
    }
    const large: string[] = [];
    for (const path of changed) {
      const file = Bun.file(join(cwd, path));
      if ((await file.exists()) && file.size > MAX_SNAPSHOT_FILE_BYTES) large.push(path);
    }
    if (large.length > 0) {
      throw new Error(`refusing files over 50 MiB (ignore them first): ${large.join(", ")}`);
    }
    const tree = (await $`git write-tree`.cwd(cwd).env(env).text()).trim();
    const head = (await $`git rev-parse HEAD`.cwd(cwd).text()).trim();
    const headTree = (await $`git rev-parse HEAD^{tree}`.cwd(cwd).text()).trim();
    const message = "wsl snapshot";
    const sha =
      tree === headTree
        ? head
        : (
            await $`git -c user.name=aphrody-dev -c user.email=contact@aphrody.com commit-tree ${tree} -p ${head} -m ${message}`
              .cwd(cwd)
              .text()
          ).trim();
    await $`git update-ref ${config.snapshotRef} ${sha}`.cwd(cwd);
    return sha;
  } finally {
    await rm(index, { force: true });
  }
}

async function sync(config: VpsCargoConfig, pull: boolean, root = ROOT): Promise<string> {
  if (pull && root !== ROOT)
    throw new Error("--pull reads the Aphrody git daemon: not available with --repo");
  const sha = await snapshot(config, root);
  if (!pull) {
    // Seed the dedicated checkout first so the push has a repository to land in.
    if ((await ssh(config, remoteSeedScript(config))) !== 0) {
      throw new Error("cannot prepare the VPS checkout");
    }
    await withSnapshotBackoff(async () => {
      const push = Bun.spawn(
        [
          "git",
          "push",
          "--quiet",
          "--force",
          // The VPS checkout is seeded shallow: a thin pack may delta against bases it lacks.
          "--no-thin",
          `${config.host}:${config.remoteWorkspace}`,
          `${sha}:${config.snapshotRef}`,
        ],
        {
          cwd: root,
          env: { ...process.env, GIT_SSH_COMMAND: sshBase(config).join(" ") },
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      const code = await push.exited;
      if (code === 128)
        throw new SnapshotCollision("git push of the snapshot hit a lock (exit 128)");
      if (code !== 0) throw new Error("git push of the snapshot failed");
    });
  }
  if ((await ssh(config, remoteCheckoutScript(config, sha, pull))) !== 0) {
    throw new Error("VPS checkout failed");
  }
  return sha;
}

function tmuxLocal(args: string[]): Promise<number> {
  return Bun.spawn(["tmux", ...args], { stdout: "inherit", stderr: "inherit" }).exited;
}

async function tunnel(config: VpsCargoConfig, action: string | undefined): Promise<number> {
  const session = config.localSession;
  const has = Bun.spawn(["tmux", "has-session", "-t", session], { stderr: "ignore" });
  const alive = (await has.exited) === 0;
  if (action === "up") {
    if (alive) {
      console.log(`tmux session ${session} already running`);
      return 0;
    }
    await mkdir(dirname(expandHome(config.controlPath)), { recursive: true, mode: 0o700 });
    await tmuxLocal(["new-session", "-d", "-s", session, "-n", "ssh", tunnelCommand(config)]);
    await tmuxLocal([
      "new-window",
      "-d",
      "-t",
      session,
      "-n",
      "git-daemon",
      gitDaemonCommand(config),
    ]);
    console.log(`tunnel up: tmux attach -t ${session}`);
    return 0;
  }
  if (action === "down") {
    if (alive) await tmuxLocal(["kill-session", "-t", session]);
    await Bun.spawn([...sshBase(config), "-O", "exit", config.host], { stderr: "ignore" }).exited;
    console.log("tunnel down");
    return 0;
  }
  const check = Bun.spawn([...sshBase(config), "-O", "check", config.host], { stderr: "ignore" });
  const master = (await check.exited) === 0;
  console.log(
    `tmux session ${session}: ${alive ? "up" : "down"}; ssh master: ${master ? "up" : "down"}`,
  );
  return alive && master ? 0 : 1;
}

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function fetchArtifact(
  config: VpsCargoConfig,
  args: readonly string[],
  root = ROOT,
): Promise<number> {
  const bin = flag(args, "--bin");
  if (!bin) throw new Error("fetch needs --bin <name>");
  const profile = flag(args, "--profile") ?? "release";
  const sha = (await $`git rev-parse ${config.snapshotRef}`.cwd(root).text()).trim();
  const dest = expandHome(flag(args, "--dest") ?? `~/.local/lib/aphrody/wsl-${sha.slice(0, 12)}`);
  const remote = `${config.remoteTargetDir}/${profile}/${bin}`;
  await mkdir(dest, { recursive: true });
  const control = `ControlPath=${expandHome(config.controlPath)}`;
  const copy = Bun.spawn(["scp", "-o", control, `${config.host}:${remote}`, dest], {
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await copy.exited) !== 0) return 1;
  const local = join(dest, bin);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(local).arrayBuffer());
  const digest = hasher.digest("hex");
  const remoteSum = Bun.spawn(
    [...sshBase(config), config.host, `sha256sum ${shellQuote(remote)}`],
    {
      stdout: "pipe",
    },
  );
  const remoteDigest = (await new Response(remoteSum.stdout).text()).split(/\s+/)[0];
  if (digest !== remoteDigest) throw new Error(`sha256 mismatch for ${bin}`);
  // A WebAssembly module or a shared library is a verified copy, not something to execute.
  if (/\.(wasm|so|dll|dylib)$/.test(bin)) {
    console.log(`${local} sha256=${digest} (not executed)`);
    return 0;
  }
  const runs = Bun.spawnSync([local, "--version"]).exitCode === 0;
  console.log(`${local} sha256=${digest} ${runs ? "runs here" : "does NOT run here (ABI)"}`);
  return runs ? 0 : 3;
}

const USAGE =
  "usage: vps-cargo <tunnel up|down|status | sync [--pull] | run [--jobs N] [--pull] -- <cargo args> | logs <job> | fetch --bin <name> [--profile p] [--dest d] | attach> [--host <name|auto>] [--repo <name>]";

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const selected = await selectConfig(rest);
  const repo = flag(rest, "--repo");
  const { config, root } = repo
    ? repositoryConfig(selected, repo)
    : { config: selected, root: ROOT };
  switch (command) {
    case "tunnel":
      return tunnel(config, rest[0]);
    case "sync":
      console.log(await sync(config, rest.includes("--pull"), root));
      return 0;
    case "run": {
      const separator = rest.indexOf("--");
      if (separator < 0 || separator === rest.length - 1) throw new Error(USAGE);
      const options = rest.slice(0, separator);
      const limit = Math.min(6, config.maxJobs ?? 6);
      const jobs = Number(flag(options, "--jobs") ?? Math.min(config.jobs, limit));
      if (!Number.isInteger(jobs) || jobs < 1 || jobs > limit)
        throw new Error(`--jobs must be 1..${limit} on ${config.host}`);
      const sha = await sync(config, options.includes("--pull"), root);
      const job = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${sha.slice(0, 12)}`;
      console.log(`job ${job} (attach: bun scripts/build/rust/vps-cargo.ts attach)`);
      return ssh(config, remoteRunScript(config, sha, job, rest.slice(separator + 1), jobs));
    }
    case "logs":
      if (!rest[0]) throw new Error("usage: vps-cargo logs <job>");
      return ssh(config, `cat ${shellQuote(`${config.remoteLogDir}/${rest[0]}.log`)}`);
    case "fetch":
      return fetchArtifact(config, rest, root);
    case "attach":
      return Bun.spawn(
        [...sshBase(config), "-t", config.host, "tmux", "attach", "-t", config.remoteSession],
        { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
      ).exited;
    default:
      console.error(USAGE);
      return 64;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`vps-cargo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
