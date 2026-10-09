/**
 * Native bridge to the Aphrody control plane, so that yolo is one workflow with it:
 *
 *   yolo infra|workflow|git|ssh ...                  pass-through to the installed aphrody-infra
 *   yolo ship [--apply] [--sha X] [--detach]         build all of yolo on the build factory host
 *   yolo ship status|log [--sha X]                   follow a build
 *   yolo hooks install|uninstall                     run `ship` automatically on `git push` to main/dev
 *
 * Owners stay owners: `aphrody-infra` (host matrix, SSH, workflow stages, git audit); the workspace gates
 * (`yolo ops|workspace`) run in-process from the CLI. Heavy builds run on the host declared in the Aphrody
 * `tools/config/build-factory.json`, behind its heavy lock; secrets stay on that host.
 */
import { diskDecision, diskProbeCommand, resolveMinFree } from "../fleet/space";
import { parsePolicy } from "../fleet/safety";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";

const PASSTHROUGH: Readonly<Record<string, readonly string[]>> = {
  infra: ["aphrody-infra"],
  workflow: ["aphrody-infra", "workflow"],
  git: ["aphrody-infra", "git"],
  ssh: ["aphrody-infra", "ssh"],
};

export const APHRODY_COMMANDS = [...Object.keys(PASSTHROUGH), "ship", "hooks"] as const;

export function aphrodyRoot(): string {
  return resolve(process.env["YOLO_APHRODY_ROOT"] ?? join(homedir(), "src", "aphrody"));
}

export function onPath(bin: string): boolean {
  return Boolean(Bun.which(bin));
}

function run(cmd: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): number {
  const result = Bun.spawnSync([...cmd], {
    windowsHide: true,
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, ...env },
  });
  return result.exitCode ?? 1;
}

interface Factory {
  readonly target: string;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly lockPath: string;
  readonly cacheRoot?: string;
  readonly executionOnlyTargets?: readonly string[];
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

function factoryDirectoryCommand(path: string): string {
  const quoted = shellQuote(path);
  return `if [ ! -d ${quoted} ]; then mkdir -p -- ${quoted} 2>/dev/null || sudo -n install -d -m 0755 -o "$(id -u)" -g "$(id -g)" -- ${quoted}; fi; test -w ${quoted} || { echo 'Factory directory is not writable; existing ownership preserved' >&2; exit 2; }`;
}

function loadFactory(): Factory {
  const customConfig = process.env["YOLO_BUILD_FACTORY_CONFIG"];
  const file = customConfig ?? join(aphrodyRoot(), "tools/config/build-factory.json");
  if (!existsSync(file)) throw new Error(`Build factory config not found: ${file}`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as Factory & { enabled?: boolean };
  if (raw.enabled === false) throw new Error("The Aphrody build factory is disabled");
  return raw;
}

/** The build factory as the Aphrody config declares it, or null when absent/disabled (used by `yolo host`). */
export function buildFactoryInfo(): (Factory & { cacheRoot?: string }) | null {
  try {
    return loadFactory() as Factory & { cacheRoot?: string };
  } catch {
    return null;
  }
}

const git = (cwd: string, ...args: string[]): string =>
  Bun.spawnSync(["git", ...args], { windowsHide: true, cwd, stdout: "pipe", stderr: "pipe" })
    .stdout.toString()
    .trim();

export function remotePaths(factory: Factory, sha: string) {
  // sibling of the other first-party workspaces: <workspaces>/yolo
  const workspace = posix.join(posix.dirname(posix.normalize(factory.workspaceRoot)), "yolo");
  const artifacts = `${factory.artifactRoot}/yolo/${sha}`;
  return { workspace, artifacts, lock: factory.lockPath };
}

/** tmux session (and systemd unit) name of one build: stable per commit so it can be attached, queried and stopped. */
export function sessionName(sha: string): string {
  return `yolo-ship-${sha.slice(0, 12)}`;
}

/**
 * The remote command: a detached tmux session on the build host (survives any ssh disconnect) that runs the
 * commit's own `ship_unit.sh`, copied next to the artifacts first so a later checkout can never rewrite the script
 * while bash reads it. The unit script takes the heavy lock, checks the commit out and runs the build as a transient
 * systemd unit with the cgroup ceilings lifted. A build already running for this commit is left alone unless forced.
 */
export function remoteCommand(factory: Factory, sha: string, force = false): string {
  const p = remotePaths(factory, sha);
  const name = sessionName(sha);
  const start = [
    `mkdir -p '${p.artifacts}'`,
    `git -C '${p.workspace}' show '${sha}:scripts/release/ship_unit.sh' > '${p.artifacts}/ship_unit.sh'`,
    `echo queued > '${p.artifacts}/STATUS'`,
    `tmux new-session -d -s '${name}' -c '${p.workspace}' "bash '${p.artifacts}/ship_unit.sh' '${sha}' '${p.workspace}' '${p.artifacts}' '${p.lock}'"`,
    "echo started",
  ].join(" && ");
  if (force) return `${stopCommand(sha)} >/dev/null; ${start}`;
  return `if tmux has-session -t '${name}' 2>/dev/null; then echo "already running: ${name} (yolo ship attach|stop, or --force)"; else ${start}; fi`;
}

/** Stop one build: the tmux session and its systemd unit (the whole cgroup, so no stray cargo/rustc survives). */
export function stopCommand(sha: string): string {
  const name = sessionName(sha);
  return `(tmux kill-session -t '${name}' 2>/dev/null || true); (sudo -n systemctl stop '${name}.service' 2>/dev/null || true); echo stopped ${name}`;
}

/** Block on the build host until the build of `sha` ends; exits 0 only when it ended `ok`. */
export function waitCommand(factory: Factory, sha: string): string {
  const p = remotePaths(factory, sha);
  return [
    `[ -f '${p.artifacts}/STATUS' ] || { echo no-build-for-${sha}; exit 2; }`,
    `until grep -qE '^(ok|failed|stopped)' '${p.artifacts}/STATUS'; do sleep 20; done`,
    `tail -n 40 '${p.artifacts}/ship.log'`,
    `echo; echo "STATUS: $(cat '${p.artifacts}/STATUS')"`,
    `grep -qx ok '${p.artifacts}/STATUS'`,
  ].join("\n");
}

/** HTTPS form of the origin remote (the build host authenticates with `gh`, not with this machine's ssh aliases). */
export function originUrl(cwd: string): string {
  const raw = git(cwd, "remote", "get-url", "origin");
  return raw
    .replace(/^git@[^:]+:/, "https://github.com/")
    .replace(/^ssh:\/\/git@[^/]+\//, "https://github.com/");
}

/**
 * Transport is git and gh only: clone the repository on the build host once, then fetch the pushed commit and the
 * tags through HTTPS. The commit may still be in flight when the pre-push hook starts this, so the fetch retries for
 * a while. The working tree is not touched here: the checkout happens under the heavy lock (`ship_unit.sh`), so a
 * build in progress never sees its sources change.
 */
export function remoteSyncCommand(factory: Factory, sha: string, url: string): string {
  const p = remotePaths(factory, sha);
  const ws = `'${p.workspace}'`;
  return [
    "set -e",
    // Command-local configuration reuses gh authentication without rewriting the operator's Git config.
    `git() { command git -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c 'url.https://github.com/.insteadOf=git@github-dev:' "$@"; }`,
    factoryDirectoryCommand(dirname(p.workspace)),
    `[ -d ${ws}/.git ] || git clone --filter=blob:none --no-checkout '${url}' ${ws}`,
    `cd ${ws}`,
    "git fetch --prune --tags --filter=blob:none origin",
    `i=0; until git cat-file -e '${sha}^{commit}' 2>/dev/null; do sleep 15; git fetch --prune --tags --filter=blob:none origin || true; i=$((i+1)); [ $i -ge 40 ] && { echo "commit ${sha} not on origin"; exit 1; }; done`,
    "command -v tmux >/dev/null || sudo -n apt-get install -y -qq tmux",
    "echo synced",
  ].join("\n");
}

/** Prepare a pinned factory workspace under its heavy lock, without starting a build. */
export function remotePrepareCommand(factory: Factory, sha: string): string {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Factory preparation requires a full Git SHA");
  const paths = remotePaths(factory, sha);
  const body = [
    "set -euo pipefail",
    `cd -- ${shellQuote(paths.workspace)}`,
    `git() { command git -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c 'url.https://github.com/.insteadOf=git@github-dev:' "$@"; }`,
    // clone --no-checkout has no index. Only an otherwise empty worktree is eligible for its first checkout.
    `if [ -f .git/index ]; then test -z "$(git status --porcelain --untracked-files=all)" || { echo 'Factory checkout is dirty; preserved' >&2; exit 2; }; else test -z "$(find . -mindepth 1 -maxdepth 1 ! -name .git -print -quit)" || { echo 'Factory checkout contains unowned files; preserved' >&2; exit 2; }; fi`,
    `git submodule foreach --quiet --recursive 'test -z "$(git status --porcelain --untracked-files=all)"'`,
    `git checkout --detach --no-overwrite-ignore ${shellQuote(sha)}`,
    "git submodule sync --recursive",
    "git submodule update --init --recursive --jobs 4 --filter=blob:none",
    `test "$(git rev-parse HEAD)" = ${shellQuote(sha)}`,
    `test -z "$(git status --porcelain --untracked-files=all)"`,
    "echo 'Factory workspace prepared; no build started'",
  ].join("\n");
  const directories = [dirname(factory.lockPath), factory.artifactRoot];
  if (factory.cacheRoot) directories.push(factory.cacheRoot);
  return `${directories.map(factoryDirectoryCommand).join("\n")}\nflock --close -- ${shellQuote(factory.lockPath)} bash -c ${shellQuote(body)}`;
}

function ssh(host: string, command: string, timeoutSecs = 120): number {
  return run(["aphrody-infra", "ssh", "exec", "--host", host, "--cmd", command], aphrodyRoot(), {
    APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(timeoutSecs),
  });
}

export interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const RC_MARK = "@@yolo-rc=";

/**
 * `aphrody-infra ssh exec` fails the whole call (and drops stdout) on a non-zero remote exit. Running the
 * command in a subshell and printing its status keeps stdout, stderr and the real exit code.
 */
export function withExitSentinel(command: string): string {
  return `(${command}\n); printf '\\n${RC_MARK}%s\\n' "$?"`;
}

export function splitExitSentinel(stdout: string): { stdout: string; code: number | null } {
  const i = stdout.lastIndexOf(`\n${RC_MARK}`);
  if (i < 0) return { stdout, code: null };
  const code = Number.parseInt(stdout.slice(i + 1 + RC_MARK.length), 10);
  return { stdout: stdout.slice(0, i), code: Number.isNaN(code) ? null : code };
}

async function captureAphrody(argv: readonly string[], timeoutSecs: number): Promise<Captured> {
  const root = aphrodyRoot();
  const proc = Bun.spawn([...argv], {
    windowsHide: true,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      APHRODY_INFRA_ROOT: root,
      APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(timeoutSecs),
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Run a command on an `aphrody-infra` host through `ssh exec --json` and return its real output. */
export async function sshCapture(
  host: string,
  command: string,
  timeoutSecs = 120,
): Promise<Captured> {
  const r = await captureAphrody(
    ["aphrody-infra", "ssh", "exec", "--host", host, "--json", "--cmd", withExitSentinel(command)],
    timeoutSecs,
  );
  if (r.code !== 0) return { code: 255, stdout: "", stderr: (r.stderr || r.stdout).trim() };
  try {
    const j = JSON.parse(r.stdout) as { stdout?: string; stderr?: string };
    const split = splitExitSentinel(j.stdout ?? "");
    return { code: split.code ?? 255, stdout: split.stdout, stderr: j.stderr ?? "" };
  } catch {
    return {
      code: 255,
      stdout: "",
      stderr: `unparseable aphrody-infra output: ${r.stdout.slice(0, 200)}`,
    };
  }
}

/** Query or mutate one systemd unit through the owner (`stop`/`disable` carry --confirm). */
export function sshServiceArgs(host: string, unit: string, action: string): string[] {
  const confirm = action === "stop" || action === "disable" ? ["--confirm"] : [];
  return ["aphrody-infra", "ssh", "service", "--host", host, "--action", action, ...confirm, unit];
}

export async function sshService(host: string, unit: string, action: string): Promise<Captured> {
  const r = await captureAphrody(sshServiceArgs(host, unit, action), 60);
  return r;
}

/** Owner tuning report/application (`aphrody-infra ssh tune`), JSON. */
export async function sshTune(host: string, apply: boolean): Promise<Captured> {
  return captureAphrody(
    ["aphrody-infra", "ssh", "tune", "--host", host, "--json", ...(apply ? ["--apply"] : [])],
    120,
  );
}

/**
 * `.coord/claims/yolo-ship-<sha12>.json` in the Aphrody checkout: the same coarse, file-based coordination other
 * agents already use (`owner`, `paths`, `state`, `task`). A Codex session stopped a running ship build by mistake
 * once (no visible signal that it was in progress); this makes the running build visible and names the one safe
 * way to cancel it, without requiring any change on the Aphrody side. Best effort: a missing/unwritable `.coord`
 * never fails the ship itself.
 */
export function shipClaimPath(sha: string): string {
  return join(aphrodyRoot(), ".coord/claims", `yolo-ship-${sha.slice(0, 12)}.json`);
}

export function writeShipClaim(host: string, factory: Factory, sha: string): void {
  const sha12 = sha.slice(0, 12);
  try {
    mkdirSync(dirname(shipClaimPath(sha)), { recursive: true });
    writeFileSync(
      shipClaimPath(sha),
      `${JSON.stringify(
        {
          owner: "yolo-ship",
          paths: [factory.lockPath, `${host}:tmux:${sessionName(sha)}`],
          state: "active",
          task: `yolo ship ${sha12} is building on ${host} (heavy lock + systemd unit ${sessionName(sha)}); do not stop or restart it from outside yolo — \`yolo ship stop --sha ${sha12}\` is the one safe way to cancel it`,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  } catch {
    // coordination is advisory; never block a build on it
  }
}

export function releaseShipClaim(sha: string, state: string): void {
  const path = shipClaimPath(sha);
  try {
    if (!existsSync(path)) return;
    const claim = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(
      path,
      `${JSON.stringify({ ...claim, state, endedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch {
    // best effort, see writeShipClaim
  }
}

async function waitFor(host: string, factory: Factory, sha: string): Promise<number> {
  const r = await sshCapture(host, waitCommand(factory, sha), 86_400);
  process.stdout.write(r.stdout);
  if (r.stderr.trim() !== "") process.stderr.write(`${r.stderr.trim()}\n`);
  releaseShipClaim(sha, r.code === 0 ? "complete: ok" : "complete: failed or stopped");
  return r.code;
}

async function runShip(args: readonly string[], yoloRoot: string): Promise<number> {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const apply = args.includes("--apply");
  const detach = args.includes("--detach");
  const force = args.includes("--force");
  const wait = args.includes("--wait");
  const prepare = args.includes("--prepare");
  const factory = loadFactory();
  const host = flag("--host") ?? factory.target;
  const sha = flag("--sha") ?? git(yoloRoot, "rev-parse", "HEAD");
  const p = remotePaths(factory, sha);
  const sub = args[0];

  if (sub === "stop") {
    const code = ssh(host, stopCommand(sha));
    if (code === 0) releaseShipClaim(sha, "released: stopped by operator");
    return code;
  }
  if (sub === "wait") return waitFor(host, factory, sha);
  if (sub === "attach") {
    return run(["ssh", "-t", host, "tmux", "attach", "-t", sessionName(sha)], yoloRoot);
  }
  if (sub === "status" || sub === "log") {
    const file = sub === "status" ? "STATUS" : "ship.log";
    return ssh(host, `tail -n 60 '${p.artifacts}/${file}' 2>&1 || echo no-build-for-${sha}`);
  }
  if (factory.executionOnlyTargets?.includes(host)) {
    console.error(`yolo ship refused: ${host} is execution-only in the factory configuration`);
    return 2;
  }
  if (prepare && (detach || wait || force)) {
    console.error("yolo ship --prepare cannot be combined with --detach, --wait or --force");
    return 2;
  }
  if (prepare && !/^[a-f0-9]{40}$/.test(sha)) {
    console.error("yolo ship --prepare requires a full pinned Git SHA");
    return 2;
  }
  if (detach) {
    // used by the pre-push hook: never block the push, keep a local log
    const logDir = join(yoloRoot, "var/ship");
    mkdirSync(logDir, { recursive: true });
    const fd = openSync(join(logDir, `${sha.slice(0, 12)}.log`), "a");
    const child = Bun.spawn(
      [
        process.execPath,
        ...process.argv.slice(1).filter((a) => a !== "--detach"),
        "--apply",
        "--sha",
        sha,
      ],
      { windowsHide: true, cwd: yoloRoot, detached: true, stdin: "ignore", stdout: fd, stderr: fd },
    );
    child.unref();
    console.log(`yolo ship ${sha.slice(0, 12)} started in the background (var/ship)`);
    return 0;
  }

  console.log(`\x1b[1myolo ship\x1b[0m ${sha.slice(0, 12)} -> ${host}:${p.workspace}`);
  console.log(
    `  1. git (gh auth) on ${host}  fetch ${sha.slice(0, 12)} and tags -> ${p.workspace}`,
  );
  console.log(
    prepare
      ? `  2. heavy lock -> clean pinned checkout + submodules (preparation only)`
      : `  2. tmux ${sessionName(sha)}  heavy lock -> checkout + submodules -> systemd unit -> ${p.artifacts}`,
  );
  if (!apply) {
    console.log(
      prepare
        ? "\nPlan only. Re-run with --apply to prepare the pinned factory workspace."
        : "\nPlan only. Re-run with --apply to fetch the pushed commit and start the build.",
    );
    return 0;
  }
  const probe = await sshCapture(host, diskProbeCommand(factory.workspaceRoot), 60);
  const policyFile = join(yoloRoot, "host-policy.toml");
  const policy = parsePolicy(
    existsSync(policyFile) ? readFileSync(policyFile, "utf8") : null,
    host,
  );
  let minFree: number;
  try {
    minFree = resolveMinFree({
      flag: flag("--min-free"),
      env: process.env["YOLO_MIN_FREE"],
      policy: policy.space.minFree,
    });
  } catch (e) {
    console.error(`yolo ship: ${(e as Error).message}`);
    return 2;
  }
  const disk = diskDecision(probe.code === 0 ? probe.stdout : null, minFree);
  if (!disk.ok) {
    console.error(
      `yolo ship refused: ${host}: ${disk.message}. Free space first (yolo host space <paths> --host ${host}), then retry.`,
    );
    return 3;
  }
  console.log(`  disk: ${host} ${disk.message}`);
  if (git(yoloRoot, "status", "--porcelain") !== "")
    console.log(
      "  note: uncommitted changes are not shipped; the remote checks out the pushed commit",
    );
  let code = ssh(host, remoteSyncCommand(factory, sha, originUrl(yoloRoot)), 3600);
  if (code !== 0) return code;
  if (prepare) return ssh(host, remotePrepareCommand(factory, sha), 3600);
  code = ssh(host, remoteCommand(factory, sha, force));
  if (code !== 0) return code;
  writeShipClaim(host, factory, sha);
  if (wait) return waitFor(host, factory, sha);
  console.log(`  follow: yolo ship status|log|wait|attach|stop --sha ${sha.slice(0, 12)}`);
  return 0;
}

const HOOK_MARK = "# yolo-ship";

function runHooks(args: readonly string[], yoloRoot: string): number {
  const dir = join(yoloRoot, ".githooks");
  const hook = join(dir, "pre-push");
  if (args[0] === "install") {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      hook,
      `#!/bin/sh\n${HOOK_MARK}\n# Starts the full yolo build on the build factory for pushes to main/dev (non-blocking).\nwhile read -r _ local_sha _ remote_ref; do\n  case "$remote_ref" in\n    refs/heads/main|refs/heads/dev)\n      [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue\n      (cd "$(git rev-parse --show-toplevel)" && bun run cli ship --detach --sha "$local_sha" >/dev/null 2>&1 || true)\n      ;;\n  esac\ndone\nexit 0\n`,
      { mode: 0o755 },
    );
    const code = run(["git", "config", "core.hooksPath", ".githooks"], yoloRoot);
    if (code === 0)
      console.log("Installed .githooks/pre-push: pushes to main/dev start `yolo ship`.");
    return code;
  }
  if (args[0] === "uninstall") {
    return run(["git", "config", "--unset", "core.hooksPath"], yoloRoot);
  }
  console.error("Usage: yolo hooks install|uninstall");
  return 1;
}

export async function runAphrodyCommand(
  command: string,
  args: readonly string[],
  yoloRoot: string = process.cwd(),
): Promise<number> {
  if (command === "ship") return runShip(args, yoloRoot);
  if (command === "hooks") return runHooks(args, yoloRoot);
  const base = PASSTHROUGH[command];
  if (base === undefined) throw new Error(`Unknown Aphrody command ${command}`);
  if (!onPath(base[0] as string)) {
    console.error(`\`${base[0]}\` is not on PATH (Aphrody install: ${aphrodyRoot()})`);
    return 127;
  }
  const root = aphrodyRoot();
  return run([...base, ...args], root, { APHRODY_INFRA_ROOT: root, YOLO_ROOT: yoloRoot });
}

/** For `yolo doctor`: which Aphrody owners are reachable. */
export function aphrodyTools(): { name: string; found: boolean }[] {
  return ["aphrody-infra"].map((name) => ({
    name,
    found: onPath(name),
  }));
}
