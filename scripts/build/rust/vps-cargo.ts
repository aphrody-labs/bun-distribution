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
 */
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type Forward = { bind: string; to: string; purpose?: string };
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

export async function loadConfig(path = CONFIG_PATH): Promise<VpsCargoConfig> {
  return (await Bun.file(path).json()) as VpsCargoConfig;
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
    `test -d ${ws}/.git || git clone --quiet --shared --no-checkout ${shellQuote(config.remoteSeed)} ${ws}`,
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
    `git checkout --quiet --detach --force ${sha}`,
    // Untracked leftovers of a previous snapshot go; ignored outputs (node_modules) stay.
    "git clean -fdq",
    `test "$(git rev-parse HEAD)" = ${sha}`,
    `echo "vps checkout at ${sha.slice(0, 12)}"`,
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
    `cd ${shellQuote(config.remoteWorkspace)}`,
    `test "$(git rev-parse HEAD)" = ${sha} || { echo "checkout moved away from ${sha}" >&2; exit 2; }`,
    `export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"`,
    `exec env ${env.join(" ")} flock --close ${shellQuote(config.remoteHeavyLock)} scripts/build/rust/cargo-serial.sh ${cargoArgs.map(shellQuote).join(" ")}`,
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

/** Commit the exact worktree (tracked + untracked, ignores honoured) without touching index or HEAD. */
export async function snapshot(config: VpsCargoConfig, cwd = ROOT): Promise<string> {
  const index = join(cwd, ".git", "vps-cargo.index");
  await Bun.write(index, Bun.file(join(cwd, ".git", "index")));
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
}

async function sync(config: VpsCargoConfig, pull: boolean): Promise<string> {
  const sha = await snapshot(config);
  if (!pull) {
    // Seed the dedicated checkout first so the push has a repository to land in.
    if ((await ssh(config, remoteSeedScript(config))) !== 0) {
      throw new Error("cannot prepare the VPS checkout");
    }
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
        cwd: ROOT,
        env: { ...process.env, GIT_SSH_COMMAND: sshBase(config).join(" ") },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if ((await push.exited) !== 0) throw new Error("git push of the snapshot failed");
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

async function fetchArtifact(config: VpsCargoConfig, args: readonly string[]): Promise<number> {
  const bin = flag(args, "--bin");
  if (!bin) throw new Error("fetch needs --bin <name>");
  const profile = flag(args, "--profile") ?? "release";
  const sha = (await $`git rev-parse ${config.snapshotRef}`.cwd(ROOT).text()).trim();
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
  const runs = Bun.spawnSync([local, "--version"]).exitCode === 0;
  console.log(`${local} sha256=${digest} ${runs ? "runs here" : "does NOT run here (ABI)"}`);
  return runs ? 0 : 3;
}

const USAGE =
  "usage: vps-cargo <tunnel up|down|status | sync [--pull] | run [--jobs N] [--pull] -- <cargo args> | logs <job> | fetch --bin <name> [--profile p] [--dest d] | attach>";

export async function main(argv: readonly string[]): Promise<number> {
  const config = await loadConfig();
  const [command, ...rest] = argv;
  switch (command) {
    case "tunnel":
      return tunnel(config, rest[0]);
    case "sync":
      console.log(await sync(config, rest.includes("--pull")));
      return 0;
    case "run": {
      const separator = rest.indexOf("--");
      if (separator < 0 || separator === rest.length - 1) throw new Error(USAGE);
      const options = rest.slice(0, separator);
      const jobs = Number(flag(options, "--jobs") ?? config.jobs);
      if (!Number.isInteger(jobs) || jobs < 1 || jobs > 6) throw new Error("--jobs must be 1..6");
      const sha = await sync(config, options.includes("--pull"));
      const job = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${sha.slice(0, 12)}`;
      console.log(`job ${job} (attach: bun scripts/build/rust/vps-cargo.ts attach)`);
      return ssh(config, remoteRunScript(config, sha, job, rest.slice(separator + 1), jobs));
    }
    case "logs":
      if (!rest[0]) throw new Error("usage: vps-cargo logs <job>");
      return ssh(config, `cat ${shellQuote(`${config.remoteLogDir}/${rest[0]}.log`)}`);
    case "fetch":
      return fetchArtifact(config, rest);
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
