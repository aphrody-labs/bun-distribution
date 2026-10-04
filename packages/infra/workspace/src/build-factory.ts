// SPDX-License-Identifier: Apache-2.0
import { join, posix, resolve } from "node:path";
import { infraRoot, runInfra } from "./runtime.ts";

export interface BuildFactoryConfig {
  schemaVersion: number;
  enabled: boolean;
  target: string;
  executionOnlyTargets?: string[];
  cacheRoot: string;
  artifactRoot: string;
  lockPath: string;
  repositories: Record<string, string>;
  rust: { maxJobs: number };
  commandTimeoutSeconds?: number;
}

function shellQuote(value: string): string {
  if (value.includes("\0")) throw new Error("Build argument contains NUL");
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function absolutePath(value: string, field: string): string {
  if (!value || !value.startsWith("/") || posix.normalize(value) !== value)
    throw new Error(`Invalid build factory ${field}: expected a normalized absolute path`);
  return value;
}

/** All heavy work shares Infra's host policy, transport and lock; Cargo retains its owner lock. */
export function buildFactoryPlan(
  config: BuildFactoryConfig,
  repository: string,
  revision: string,
  command: readonly string[],
) {
  if (config.executionOnlyTargets?.includes(config.target))
    throw new Error(
      `Build target ${config.target} is execution-only; designate a new factory host`,
    );
  if (config.schemaVersion !== 1 || !config.enabled || config.target !== "vps")
    throw new Error("Build factory must be enabled on the canonical vps target");
  if (!Object.hasOwn(config.repositories, repository))
    throw new Error(`Unknown build factory repository: ${repository}`);
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A full pinned Git revision is required");
  if (!command.length || !command[0]) throw new Error("An owner command is required after --");
  if (
    !Number.isSafeInteger(config.rust.maxJobs) ||
    config.rust.maxJobs < 1 ||
    config.rust.maxJobs > 6
  )
    throw new Error("Build factory rust.maxJobs must be between 1 and 6");
  const commandTimeoutSeconds = config.commandTimeoutSeconds ?? 21600;
  if (
    !Number.isSafeInteger(commandTimeoutSeconds) ||
    commandTimeoutSeconds < 1 ||
    commandTimeoutSeconds > 86400
  )
    throw new Error("Build factory commandTimeoutSeconds must be between 1 and 86400");
  const root = absolutePath(config.repositories[repository]!, "repository");
  const cache = absolutePath(config.cacheRoot, "cacheRoot");
  const artifacts = absolutePath(config.artifactRoot, "artifactRoot");
  const lock = absolutePath(config.lockPath, "lockPath");
  const environment = [
    "APHRODY_BUILD_HOST=vps",
    `APHRODY_CARGO_JOBS=${config.rust.maxJobs}`,
    "CARGO_INCREMENTAL=0",
    "CARGO_NET_GIT_FETCH_WITH_CLI=true",
    `APHRODY_CARGO_LOCK_DIR=${posix.dirname(lock)}`,
    `SCCACHE_DIR=${cache}/sccache`,
    `BUN_INSTALL_CACHE_DIR=${cache}/bun`,
    `UV_CACHE_DIR=${cache}/uv`,
    `APHRODY_ARTIFACT_ROOT=${artifacts}`,
  ];
  // Yolo/IECODE packaging consumes canonical target/ layouts; retain them while sharing sccache.
  if (repository === "aphrody")
    environment.push(
      `CARGO_TARGET_DIR=${cache}/cargo/${repository}`,
      `APHRODY_CARGO_TARGET_DIR=${cache}/cargo/${repository}`,
    );
  // Verify inside the lock: no queued job can consume a changed source revision.
  const body = [
    "set -euo pipefail",
    'export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"',
    `cd -- ${shellQuote(root)}`,
    `test "$(git rev-parse HEAD)" = ${shellQuote(revision)} || { echo 'Build factory source revision differs from the requested pin' >&2; exit 2; }`,
    "test -z \"$(git status --porcelain --untracked-files=all --ignore-submodules=none)\" || { echo 'Build factory source checkout is dirty' >&2; exit 2; }",
    `git submodule foreach --quiet --recursive 'test -z "$(git status --porcelain --untracked-files=all --ignore-submodules=none)"'`,
    `exec env ${environment.map(shellQuote).join(" ")} ${command.map(shellQuote).join(" ")}`,
  ].join("\n");
  // The supervisor owns the descriptor; long-lived cache daemons must not inherit it.
  const remoteCommand = `flock --close -- ${shellQuote(lock)} bash -c ${shellQuote(body)}`;
  return {
    repository,
    revision,
    target: config.target,
    workspace: root,
    command: [...command],
    serialized: true,
    commandTimeoutSeconds,
    transport: ["ssh", "exec", "--host", config.target, "--cmd", remoteCommand],
  };
}

export interface FactorySource {
  path: string;
  remote: string;
  url: string;
  owners: readonly string[];
}

/** Keep credentials out of plans and reject undeclared Git hosts, aliases and repositories. */
export function factoryRemoteUrl(
  url: string,
  repository: string,
  owners: readonly string[],
): string {
  const match =
    /^(?:https:\/\/github\.com\/|git@(?:github\.com|github-dev):|ssh:\/\/git@(?:github\.com|github-dev)\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/u.exec(
      url,
    );
  if (!match || !owners.includes(match[1]!) || match[2] !== repository) {
    throw new Error("Factory source remote is not the declared private owner repository");
  }
  return `https://github.com/${match[1]}/${match[2]}.git`;
}

const FACTORY_GIT = `git() { command git -c credential.helper= -c 'credential.helper=!gh auth git-credential' -c 'url.https://github.com/.insteadOf=git@github-dev:' -c 'url.https://github.com/.insteadOf=git@github.com:' -c 'url.https://github.com/.insteadOf=ssh://git@github-dev/' -c 'url.https://github.com/.insteadOf=ssh://git@github.com/' "$@"; }`;

function factoryDirectory(path: string): string {
  const quoted = shellQuote(path);
  return `test "$(realpath -m -- ${quoted})" = ${quoted} || { echo 'Factory path resolves outside its declared location; preserved' >&2; exit 2; }; if [ ! -e ${quoted} ]; then install -d -- ${quoted} 2>/dev/null || sudo -n install -d -o "$(id -un)" -g "$(id -gn)" -- ${quoted}; fi; test -d ${quoted} || { echo 'Factory path is not a directory; preserved' >&2; exit 2; }`;
}

/** Prepare only the owner's three declared sources. No build starts and existing authentication remains local. */
export function buildFactoryPreparePlan(
  config: BuildFactoryConfig,
  repository: string,
  revision: string,
  source: FactorySource,
) {
  if (!["yolo", "aphrody", "aphrody-py"].includes(repository)) {
    throw new Error("Factory preparation is limited to yolo, aphrody and aphrody-py");
  }
  const validation = buildFactoryPlan(config, repository, revision, ["git", "checkout"]);
  const base = posix.dirname(absolutePath(config.repositories.aphrody!, "aphrody repository"));
  if (validation.workspace !== posix.join(base, repository) || base === "/") {
    throw new Error("Factory repository must stay in its declared sibling workspace");
  }
  for (const path of [config.cacheRoot, config.artifactRoot, config.lockPath]) {
    if (path === validation.workspace || path.startsWith(`${validation.workspace}/`)) {
      throw new Error("Factory caches, artifacts and locks must stay outside source checkouts");
    }
  }
  if (
    !source.path ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(source.remote) ||
    source.remote === "legacy-aphrody"
  ) {
    throw new Error("Invalid declared factory source path or remote");
  }
  const remote = factoryRemoteUrl(source.url, repository, source.owners);
  const normalizedExisting = [
    remote,
    remote.replace(/\.git$/, ""),
    remote.replace("https://github.com/", "git@github-dev:"),
    remote.replace("https://github.com/", "git@github.com:"),
    remote.replace("https://github.com/", "ssh://git@github-dev/"),
    remote.replace("https://github.com/", "ssh://git@github.com/"),
  ];
  const clean = `test -z "$(git status --porcelain --untracked-files=all --ignore-submodules=none)" || { echo 'Factory source checkout is dirty; preserved' >&2; exit 2; }`;
  const guardedSubmodules = [
    FACTORY_GIT,
    clean,
    'git fetch --filter=blob:none origin "$sha1"',
    'git checkout --detach --no-overwrite-ignore "$sha1"',
  ].join("\n");
  const body = [
    "set -euo pipefail",
    'export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH" GIT_TERMINAL_PROMPT=0',
    FACTORY_GIT,
    `root=${shellQuote(validation.workspace)}`,
    `test "$(realpath -m -- "$root")" = "$root" || { echo 'Factory source path resolves elsewhere; preserved' >&2; exit 2; }`,
    'if [ ! -e "$root" ]; then',
    `  git clone --filter=blob:none --no-checkout ${shellQuote(remote)} "$root"`,
    'elif [ ! -d "$root" ] || { [ ! -d "$root/.git" ] && [ ! -f "$root/.git" ]; }; then',
    "  echo 'Existing factory source is not a Git checkout; preserved' >&2; exit 2",
    "fi",
    'cd -- "$root"',
    `test "$(git rev-parse --show-toplevel)" = "$root" || { echo 'Factory source is not its declared Git root; preserved' >&2; exit 2; }`,
    "origin=$(git config --get-all remote.origin.url)",
    `case "$origin" in ${normalizedExisting.map(shellQuote).join("|")}) ;; *) echo 'Existing factory origin differs from the declared private repository; preserved' >&2; exit 2 ;; esac`,
    'if [ -f "$(git rev-parse --git-path index)" ]; then',
    `  ${clean}`,
    "else",
    '  test -z "$(find . -mindepth 1 -maxdepth 1 ! -name .git -print -quit)" || { echo "Uninitialized factory checkout contains unowned files; preserved" >&2; exit 2; }',
    "fi",
    `git submodule foreach --quiet --recursive ${shellQuote(clean)}`,
    "git fetch --prune --tags --filter=blob:none origin refs/heads/main:refs/remotes/origin/main",
    `git cat-file -e ${shellQuote(`${revision}^{commit}`)} 2>/dev/null || git fetch --filter=blob:none origin ${shellQuote(revision)}`,
    `git cat-file -e ${shellQuote(`${revision}^{commit}`)}`,
    `git merge-base --is-ancestor ${shellQuote(revision)} refs/remotes/origin/main || { echo 'Requested source revision is not on the declared remote main history' >&2; exit 2; }`,
    `git checkout --detach --no-overwrite-ignore ${shellQuote(revision)}`,
    "git submodule sync --recursive",
    `git submodule foreach --quiet --recursive ${shellQuote(guardedSubmodules)}`,
    "git submodule update --init --recursive --jobs 4 --filter=blob:none",
    `test "$(git rev-parse HEAD)" = ${shellQuote(revision)}`,
    clean,
    `git submodule foreach --quiet --recursive ${shellQuote(clean)}`,
    "echo 'Factory source prepared; no build started'",
  ].join("\n");
  const directoryCommands = [
    base,
    posix.dirname(config.lockPath),
    config.cacheRoot,
    config.artifactRoot,
  ]
    .map(factoryDirectory)
    .join("\n");
  const lock = shellQuote(config.lockPath);
  const remoteCommand = `${directoryCommands}\ntest "$(realpath -m -- ${lock})" = ${lock} || { echo 'Factory lock resolves elsewhere; preserved' >&2; exit 2; }\nflock --close -- ${lock} bash -c ${shellQuote(body)}`;
  return {
    operation: "prepare" as const,
    repository,
    revision,
    target: validation.target,
    workspace: validation.workspace,
    source: { path: resolve(source.path), remote: source.remote, url: remote },
    serialized: true,
    commandTimeoutSeconds: validation.commandTimeoutSeconds,
    transport: ["ssh", "exec", "--host", validation.target, "--cmd", remoteCommand],
  };
}

async function declaredFactorySource(
  root: string,
  repository: string,
  revision: string,
): Promise<FactorySource> {
  const { loadSourceSyncConfig } = await import("../../../../scripts/source-sync.ts");
  const config = await loadSourceSyncConfig(root);
  const source = config.repositories.find((entry) => entry.id === repository);
  if (!source || source.destinationBranch !== "main")
    throw new Error("Factory source must be a declared main repository");
  const git = async (args: string[]): Promise<string> => {
    const child = Bun.spawn(["git", ...args], {
      cwd: source.path,
      stdout: "pipe",
      stderr: "ignore",
      timeout: config.commandTimeoutMs,
    });
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) throw new Error("Cannot inspect declared factory source");
    return output.trim();
  };
  if (resolve(await git(["rev-parse", "--show-toplevel"])) !== resolve(source.path)) {
    throw new Error("Declared factory source must be the repository root");
  }
  await git(["cat-file", "-e", `${revision}^{commit}`]);
  const urls = (await git(["config", "--get-all", `remote.${source.remote}.url`])).split("\n");
  if (urls.length !== 1) throw new Error("Factory source requires one declared remote URL");
  return { path: source.path, remote: source.remote, url: urls[0]!, owners: config.owners };
}

export interface BuildFactoryStatus {
  configured: boolean;
  enabled: boolean;
  target: string | null;
  host: string | null;
  localCargo: boolean;
  route: "factory" | "local";
  reason: string;
}

export async function readFactoryConfig(root: string): Promise<BuildFactoryConfig | null> {
  const file = Bun.file(join(root, "config/build-factory.json"));
  return (await file.exists()) ? ((await file.json()) as BuildFactoryConfig) : null;
}

/** Heavy-work route; `localCargo` honours the scoped cargo-serial diagnostic override only. */
export function heavyBuildStatus(
  config: BuildFactoryConfig | null,
  env: Record<string, string | undefined>,
  honourLocalCargo = true,
): BuildFactoryStatus {
  const host = env.APHRODY_BUILD_HOST || null;
  const localCargo = honourLocalCargo && env.APHRODY_LOCAL_CARGO === "1";
  const status = {
    configured: config !== null,
    enabled: config?.enabled === true,
    target: config?.target ?? null,
    host,
    localCargo,
  };
  const local = (reason: string) => ({ ...status, route: "local" as const, reason });
  if (!config) return local("config/build-factory.json is absent");
  if (config.executionOnlyTargets?.includes(config.target)) {
    if (localCargo && host !== config.target)
      return local("APHRODY_LOCAL_CARGO=1 selects a scoped local diagnostic");
    return {
      ...status,
      route: "factory" as const,
      reason: `${config.target} is execution-only; a new factory host is required`,
    };
  }
  if (host === "vps") return local("running on the factory host");
  if (!status.enabled) return local("build factory disabled");
  if (localCargo) return local("APHRODY_LOCAL_CARGO=1 selects a scoped local diagnostic");
  return { ...status, route: "factory", reason: `heavy work runs on ${config.target}` };
}

/** Source-owner gates use this before heavy work; static/planning callers never dispatch. */
export async function routeHeavyBuild(
  command: string[],
  root: string,
): Promise<number | undefined> {
  const config = await readFactoryConfig(root);
  if (!config || heavyBuildStatus(config, process.env, false).route === "local") return undefined;
  const git = async (args: string[]): Promise<string> => {
    const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "inherit" });
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0)
      throw new Error("Cannot qualify the build factory source revision");
    return output.trim();
  };
  const revision = await git(["rev-parse", "HEAD"]);
  if (await git(["status", "--porcelain", "--untracked-files=normal"]))
    throw new Error(
      "Heavy builds run on vps from committed source. The local checkout is dirty; commit the scoped batch before dispatch, or inspect build-factory plan with an explicit revision. Uncommitted source will not be silently omitted.",
    );
  const plan = buildFactoryPlan(config, "aphrody", revision, command);
  console.error(`Build factory: ${plan.repository} ${revision} on ${plan.target}`);
  return (
    await runInfra({
      args: plan.transport,
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
      env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(plan.commandTimeoutSeconds) },
    })
  ).exitCode;
}

/** Plan by default; run dispatches exclusively through the installed Infra SSH owner. */
async function runBuildFactoryAction(args: string[], root: string): Promise<number> {
  const separator = args.indexOf("--");
  const options = separator === -1 ? args : args.slice(0, separator);
  if (options.includes("--help") || options.includes("-h")) {
    console.log(
      "Usage: aphrody-ops build-factory <plan|run> --repo <aphrody|yolo|iecode|aphrody-py> --revision <full-git-sha> -- <owner command> [arguments...]\n       aphrody-ops build-factory prepare --repo <aphrody|yolo|aphrody-py> --revision <full-git-sha> [--apply]\n       aphrody-ops build-factory status [--route]\nPreparation prints a plan by default; --apply fetches and prepares the declared remote main revision under the shared heavy lock. It starts no build and preserves dirty, unowned and ignored files.",
    );
    return 0;
  }
  const [action = "plan", ...rest] = args;
  if (action === "status") {
    if (rest.some((arg) => arg !== "--route"))
      throw new Error("Usage: build-factory status [--route]");
    const status = heavyBuildStatus(await readFactoryConfig(root), process.env);
    console.log(rest.length ? status.route : JSON.stringify(status, null, 2));
    return 0;
  }
  if (action !== "plan" && action !== "run" && action !== "prepare")
    throw new Error("Expected build-factory plan, run or prepare");
  let repository = "aphrody";
  let revision = "";
  let command: string[] = [];
  let apply = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (action === "prepare" && arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--") {
      if (action === "prepare")
        throw new Error("Factory preparation does not accept a build command");
      command = rest.slice(i + 1);
      break;
    }
    if (arg !== "--repo" && arg !== "--revision") throw new Error(`Unknown argument: ${arg}`);
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    if (arg === "--repo") repository = value;
    else revision = value;
  }
  const config = await readFactoryConfig(root);
  if (!config) throw new Error("config/build-factory.json is absent");
  if (action === "prepare") {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A full pinned Git revision is required");
    const source = await declaredFactorySource(root, repository, revision);
    const plan = buildFactoryPreparePlan(config, repository, revision, source);
    if (!apply) {
      console.log(JSON.stringify({ executed: false, ...plan }, null, 2));
      return 0;
    }
    const result = await runInfra({
      args: plan.transport,
      cwd: root,
      env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(plan.commandTimeoutSeconds) },
    });
    console.log(
      JSON.stringify(
        {
          executed: true,
          success: result.exitCode === 0,
          repository: plan.repository,
          revision: plan.revision,
          target: plan.target,
          workspace: plan.workspace,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        null,
        2,
      ),
    );
    return result.exitCode;
  }
  const plan = buildFactoryPlan(config, repository, revision, command);
  if (action === "plan") {
    console.log(JSON.stringify({ executed: false, ...plan }, null, 2));
    return 0;
  }
  return (
    await runInfra({
      args: plan.transport,
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
      env: { APHRODY_SSH_COMMAND_TIMEOUT_SECS: String(plan.commandTimeoutSeconds) },
    })
  ).exitCode;
}

export async function runBuildFactory(args: string[], root = infraRoot()): Promise<number> {
  try {
    return await runBuildFactoryAction(args, root);
  } catch (error) {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        success: false,
        executed: false,
        error: error instanceof Error ? error.message : "Build factory request failed",
      }),
    );
    return 2;
  }
}

if (import.meta.main) process.exit(await runBuildFactory(process.argv.slice(2)));
