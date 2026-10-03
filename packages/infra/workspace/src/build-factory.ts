// SPDX-License-Identifier: Apache-2.0
import { join, posix } from "node:path";
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
  // IECODE packaging consumes its canonical target/ layout; retain it while sharing sccache.
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
    "test -z \"$(git status --porcelain --untracked-files=normal)\" || { echo 'Build factory source checkout is dirty' >&2; exit 2; }",
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
      "Usage: aphrody-ops build-factory <plan|run> --repo <aphrody|iecode|aphrody-py> --revision <full-git-sha> -- <owner command> [arguments...]\n       aphrody-ops build-factory status [--route]",
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
  if (action !== "plan" && action !== "run") throw new Error("Expected build-factory plan or run");
  let repository = "aphrody";
  let revision = "";
  let command: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--") {
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
