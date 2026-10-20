// SPDX-License-Identifier: Apache-2.0
//! Pure planning for bun-forge: configuration, arguments, versions, scratch space, commit queue and receipts.
//! Everything here is deterministic and covered by test/forge.test.ts; side effects live in run.ts.

import { join } from "node:path";
import defaults from "./defaults.json";

export type ScratchMode = "auto" | "loop" | "tmpfs" | "dir";
export type Command = "doctor" | "bootstrap" | "build" | "watch" | "status" | "unit" | "help" | "version";

export interface ForgeConfig {
  repository: string;
  branch: string;
  profile: string;
  lto: boolean;
  /** Highest GLIBC version the artifact may require (hosts that install it run an older glibc than the build host); null disables the step. */
  glibcCeiling: string | null;
  scratch: { mode: ScratchMode; size: string };
  watch: {
    intervalSeconds: number;
    everyCommit: boolean;
    historyDepth: number;
  };
  toolchain: {
    llvm: { major: number; version: string; url: string };
    cmake: { minimum: string; version: string; url: string };
    rustup: { version: string; url: string };
    apt: string[];
    binaries: string[];
  };
}

export interface Options {
  command: Command;
  /** Monorepo root holding the yolo CLI sources: when set, the artifact is the CLI compiled onto the fork engine. */
  yoloRoot?: string;
  /** Native tooling library embedded with the CLI (`--asset`), as `scripts/release/tooling-asset.ts` qualifies it. */
  yoloAsset?: string;
  config: ForgeConfig;
  home: string;
  artifacts: string;
  revision?: string;
  jobs?: number;
  keep: boolean;
  tests: boolean;
  once: boolean;
  dryRun: boolean;
}

export const DEFAULT_CONFIG: ForgeConfig = defaults as ForgeConfig;

const COMMANDS: Command[] = ["doctor", "bootstrap", "build", "watch", "status", "unit", "help", "version"];

const ALIASES: Record<string, Command> = {
  "-h": "help",
  "--help": "help",
  "--version": "version",
};

export function parseArgs(argv: string[], env: Record<string, string | undefined>): Options {
  const config: ForgeConfig = structuredClone(DEFAULT_CONFIG);
  const first = argv[0];
  const command: Command =
    first === undefined
      ? "help"
      : (COMMANDS.find(c => c === first) ??
        (Object.hasOwn(ALIASES, first) ? ALIASES[first]! : fail(`unknown command: ${first}`)));
  const home = env.BUN_FORGE_HOME ?? join(env.XDG_CACHE_HOME ?? join(env.HOME ?? "/tmp", ".cache"), "bun-forge");
  const options: Options = {
    command,
    config,
    home,
    artifacts: env.BUN_FORGE_ARTIFACTS ?? join(home, "artifacts"),
    keep: false,
    tests: false,
    once: false,
    dryRun: false,
  };
  if (env.BUN_FORGE_REPOSITORY) config.repository = env.BUN_FORGE_REPOSITORY;
  if (env.BUN_FORGE_BRANCH) config.branch = env.BUN_FORGE_BRANCH;
  if (env.BUN_FORGE_YOLO_ROOT) options.yoloRoot = env.BUN_FORGE_YOLO_ROOT;
  if (env.BUN_FORGE_YOLO_ASSET) options.yoloAsset = env.BUN_FORGE_YOLO_ASSET;
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    const [flag, inline] = arg.includes("=")
      ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg, undefined];
    const value = () => inline ?? rest[++i] ?? fail(`${flag} needs a value`);
    switch (flag) {
      case "--repository":
        config.repository = value();
        break;
      case "--branch":
        config.branch = value();
        break;
      case "--rev":
        options.revision = value();
        if (!/^[0-9a-f]{40}$/.test(options.revision)) fail("--rev needs a full 40-character commit SHA");
        break;
      case "--profile":
        config.profile = value();
        break;
      case "--lto":
        config.lto = parseSwitch(value(), "--lto");
        break;
      case "--scratch": {
        const mode = value();
        if (!["auto", "loop", "tmpfs", "dir"].includes(mode)) fail(`--scratch must be auto, loop, tmpfs or dir`);
        config.scratch.mode = mode as ScratchMode;
        break;
      }
      case "--scratch-size": {
        const size = value();
        parseSize(size);
        config.scratch.size = size;
        break;
      }
      case "--jobs":
        options.jobs = Number(value());
        if (!Number.isInteger(options.jobs) || options.jobs < 1) fail("--jobs must be a positive integer");
        break;
      case "--interval":
        config.watch.intervalSeconds = Number(value());
        if (!(config.watch.intervalSeconds >= 10)) fail("--interval must be at least 10 seconds");
        break;
      case "--latest":
        config.watch.everyCommit = false;
        break;
      case "--home":
        options.home = value();
        options.artifacts = env.BUN_FORGE_ARTIFACTS ?? join(options.home, "artifacts");
        break;
      case "--artifacts":
        options.artifacts = value();
        break;
      case "--keep":
        options.keep = true;
        break;
      case "--yolo-root":
        options.yoloRoot = value();
        break;
      case "--yolo-asset":
        options.yoloAsset = value();
        break;
      case "--tests":
        options.tests = true;
        break;
      case "--once":
        options.once = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return options;
}

function parseSwitch(value: string, flag: string): boolean {
  if (value === "on" || value === "true") return true;
  if (value === "off" || value === "false") return false;
  return fail(`${flag} must be on or off`);
}

export function fail(message: string): never {
  throw new ForgeError(message);
}

export class ForgeError extends Error {}

/** Bytes from "96G", "512M", "1T" or a plain byte count. */
export function parseSize(size: string): number {
  const match = /^(\d+)([KMGT]?)$/i.exec(size.trim());
  if (!match) fail(`invalid size: ${size}`);
  const unit = { "": 1, K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40 }[
    match[2]!.toUpperCase() as "" | "K" | "M" | "G" | "T"
  ];
  return Number(match[1]) * unit;
}

/** Numeric comparison of dotted versions: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** First dotted version in a tool's `--version` output. */
export function versionIn(output: string): string | undefined {
  return /(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1];
}

/** scripts/aphrody/build/tools.ts accepts clang/lld `>=MAJOR.1.0 <MAJOR.1.99`. */
export function llvmAccepted(version: string | undefined, major: number): boolean {
  if (!version) return false;
  return compareVersions(version, `${major}.1.0`) >= 0 && compareVersions(version, `${major}.1.99`) < 0;
}

/** The `channel` of the checkout's rust-toolchain.toml. */
export function rustChannel(toml: string): string {
  const parsed = Bun.TOML.parse(toml) as { toolchain?: { channel?: unknown } };
  const channel = parsed.toolchain?.channel;
  if (typeof channel !== "string" || channel.length === 0) fail("rust-toolchain.toml has no toolchain.channel");
  return channel;
}

export type Arch = "x64" | "arm64";

export function hostArch(arch: string): Arch {
  if (arch === "x64" || arch === "arm64") return arch;
  return fail(`unsupported architecture: ${arch}`);
}

export function toolUrl(template: string, version: string, name: "llvm" | "cmake" | "rustup", arch: Arch): string {
  const archName = {
    llvm: { x64: "X64", arm64: "ARM64" },
    cmake: { x64: "x86_64", arm64: "aarch64" },
    rustup: { x64: "x86_64", arm64: "aarch64" },
  }[name][arch];
  return template.replaceAll("{version}", version).replaceAll("{arch}", archName);
}

export interface Paths {
  home: string;
  bin: string;
  toolchains: string;
  llvm: string;
  cmake: string;
  cargoHome: string;
  rustupHome: string;
  mirror: string;
  scratch: string;
  buildCache: string;
  ccache: string;
  bunInstallCache: string;
  downloads: string;
  state: string;
  lock: string;
  logs: string;
}

export function paths(options: Pick<Options, "home" | "config">): Paths {
  const h = options.home;
  const t = join(h, "toolchains");
  return {
    home: h,
    bin: join(h, "bin"),
    toolchains: t,
    llvm: join(t, `llvm-${options.config.toolchain.llvm.version}`),
    cmake: join(t, `cmake-${options.config.toolchain.cmake.version}`),
    cargoHome: join(t, "cargo"),
    rustupHome: join(t, "rustup"),
    mirror: join(h, "mirror.git"),
    scratch: join(h, "scratch"),
    buildCache: join(h, "build-cache"),
    ccache: join(h, "ccache"),
    bunInstallCache: join(h, "bun-install"),
    downloads: join(h, "downloads"),
    state: join(h, "state.json"),
    lock: join(h, "forge.lock"),
    logs: join(h, "logs"),
  };
}

export interface ScratchPlan {
  mode: Exclude<ScratchMode, "auto">;
  dir: string;
  image?: string;
  setup: string[][];
  teardown: string[][];
}

/** Commands creating and removing the per-commit scratch space. `root` commands are run through sudo by run.ts. */
export function scratchPlan(
  mode: ScratchMode,
  size: string,
  base: string,
  sha: string,
  host: { root: boolean; freeBytes: number; uid: number; gid: number },
): ScratchPlan {
  const bytes = parseSize(size);
  const resolved: Exclude<ScratchMode, "auto"> =
    mode === "auto" ? (host.root && host.freeBytes > bytes * 1.05 ? "loop" : "dir") : mode;
  if ((resolved === "loop" || resolved === "tmpfs") && !host.root)
    fail(`--scratch ${resolved} needs root or passwordless sudo`);
  const dir = join(base, sha.slice(0, 12));
  if (resolved === "dir")
    return {
      mode: resolved,
      dir,
      setup: [["mkdir", "-p", dir]],
      teardown: [["rm", "-rf", dir]],
    };
  if (resolved === "tmpfs") {
    return {
      mode: resolved,
      dir,
      setup: [
        ["mkdir", "-p", dir],
        ["mount", "-t", "tmpfs", "-o", `size=${bytes},mode=0755,uid=${host.uid},gid=${host.gid}`, "tmpfs", dir],
      ],
      teardown: [
        ["umount", dir],
        ["rmdir", dir],
      ],
    };
  }
  const image = `${dir}.img`;
  return {
    mode: resolved,
    dir,
    image,
    setup: [
      ["mkdir", "-p", dir],
      ["fallocate", "-l", String(bytes), image],
      ["mkfs.ext4", "-q", "-F", "-m", "0", "-O", "^has_journal", image],
      ["mount", "-o", "loop,noatime", image, dir],
      ["chown", `${host.uid}:${host.gid}`, dir],
    ],
    teardown: [
      ["umount", dir],
      ["rm", "-f", image],
      ["rmdir", dir],
    ],
  };
}

/** `git ls-remote` output -> SHA of `refs/heads/<branch>`. */
export function remoteHead(lsRemote: string, branch: string): string | undefined {
  for (const line of lsRemote.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === `refs/heads/${branch}` && sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  return undefined;
}

/**
 * Commits to build, oldest first. `history` is `git rev-list --first-parent <head>` (newest first). Every commit after
 * `last` when `everyCommit`, otherwise only the head; just the head when `last` is unknown or out of the history.
 */
export function commitQueue(history: string[], last: string | undefined, everyCommit: boolean): string[] {
  const head = history[0];
  if (!head || head === last) return [];
  if (!everyCommit || !last) return [head];
  const index = history.indexOf(last);
  if (index < 0) return [head];
  return history.slice(0, index).toReversed();
}

export interface BuildEnvInput {
  paths: Paths;
  baseEnv: Record<string, string | undefined>;
  rustChannel: string;
  llvmDir?: string;
  cmakeDir?: string;
}

export function buildEnv(input: BuildEnvInput): Record<string, string> {
  const p = input.paths;
  const pathEntries = [p.bin, join(p.cargoHome, "bin")];
  if (input.llvmDir) pathEntries.push(join(input.llvmDir, "bin"));
  if (input.cmakeDir) pathEntries.push(join(input.cmakeDir, "bin"));
  pathEntries.push(input.baseEnv.PATH ?? "/usr/local/bin:/usr/bin:/bin");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.baseEnv)) if (v !== undefined) env[k] = v;
  delete env.BUN_BE_BUN;
  Object.assign(env, {
    PATH: pathEntries.join(":"),
    CARGO_HOME: p.cargoHome,
    RUSTUP_HOME: p.rustupHome,
    RUSTUP_TOOLCHAIN: input.rustChannel,
    BUN_BUILD_CACHE_DIR: p.buildCache,
    BUN_INSTALL_CACHE_DIR: p.bunInstallCache,
    CCACHE_DIR: p.ccache,
    CCACHE_MAXSIZE: "40G",
    CARGO_INCREMENTAL: "0",
    CARGO_TERM_COLOR: "never",
  });
  if (input.llvmDir) env.BUN_TOOLCHAIN_LLVM = input.llvmDir;
  return env;
}

export function buildCommand(config: ForgeConfig, jobs?: number): string[] {
  const command = ["bun", "scripts/build.ts", `--profile=${config.profile}`];
  if (!config.lto) command.push("--lto=off");
  if (jobs) command.push(`-j${jobs}`);
  return command;
}

/** Specifiers the aphrody-labs/bun runtime serves natively (tools/config/bun-absorb.json, status "fork"). */
export const ABSORBED = ["picocolors", "tiny-invariant", "dotenv", "dotenv/config", "uuid"] as const;

/** The fork build is one product: the binary is `yolo`; `bun` (the engine) and `vu` (Python) are aliases of the same file, selected by argv0. */
export const BINARY = { name: "yolo", aliases: ["bun", "vu"] } as const;

/** CLI entry and version file of the monorepo, relative to `--yolo-root`. */
export const YOLO_CLI = {
  entry: "packages/yolo-cli/src/index.ts",
  versionFile: "packages/yolo-cli/VERSION",
} as const;

/** `bun build --compile` arguments that put the yolo CLI on the engine that runs them. */
export function compileCommand(
  engine: string,
  outfile: string,
  version: string,
  flags: readonly string[],
  asset?: string,
): string[] {
  return [
    engine,
    "build",
    "--compile",
    ...flags,
    ...(asset ? ["--asset", asset] : []),
    "--define",
    `YOLO_VERSION=${JSON.stringify(version)}`,
    YOLO_CLI.entry,
    "--outfile",
    outfile,
  ];
}

export function artifactLayout(out: string): {
  binary: string;
  aliases: Record<string, string>;
} {
  return {
    binary: `${out}/${BINARY.name}`,
    aliases: Object.fromEntries(BINARY.aliases.map(name => [name, `${out}/${name}`])),
  };
}

export const SMOKE_SCRIPT = `const out = {};
for (const s of ${JSON.stringify(ABSORBED)}) { try { out[s] = require.resolve(s) === s; } catch { out[s] = false; } }
console.log(JSON.stringify({ version: Bun.version, revision: Bun.revision, argv0: process.argv0.split("/").pop(), absorbed: out }));`;

export interface StepRecord {
  name: string;
  ok: boolean;
  seconds: number;
  detail?: string;
}

export interface Receipt {
  schema: "aphrody.bun-forge/1";
  repository: string;
  branch: string;
  revision: string;
  profile: string;
  lto: boolean;
  scratch: string;
  host: { arch: string; cpus: number; memoryBytes: number };
  toolchain: Record<string, string>;
  steps: StepRecord[];
  ok: boolean;
  artifact?: { path: string; sha256: string; bytes: number };
  /** Aliases of the artifact (symlinks to the binary), each smoked through its own argv0. */
  aliases?: { name: string; path: string; target: string }[];
  smokeAlias?: unknown;
  /** Set when the artifact is the yolo CLI compiled onto the engine (otherwise it is the bare engine). */
  compiled?: {
    entry: string;
    version: string;
    flags: string[];
    asset: string | null;
  };
  smokeYolo?: unknown;
  smokeVu?: unknown;
  glibc?: {
    ceiling: string;
    maxBefore: string | null;
    maxAfter: string | null;
    patched: string[];
  };
  smoke?: unknown;
  startedAt: string;
  finishedAt: string;
}

export interface State {
  last?: string;
  builds: { revision: string; ok: boolean; finishedAt: string }[];
}

export function recordBuild(state: State, receipt: Pick<Receipt, "revision" | "ok" | "finishedAt">, keep = 100): State {
  const builds = [
    ...state.builds,
    {
      revision: receipt.revision,
      ok: receipt.ok,
      finishedAt: receipt.finishedAt,
    },
  ].slice(-keep);
  // `last` is the last attempted commit: a failed commit keeps its receipt and the queue moves on.
  return { last: receipt.revision, builds };
}

/** The unit running `<command> watch`; `command` is the forge invocation (`yolo forge` or the standalone executable). */
export function systemdUnit(command: string, home: string, user: string): string {
  return `[Unit]
Description=bun-forge: build aphrody-labs/bun on every commit of the watched branch
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
Environment=BUN_FORGE_HOME=${home}
ExecStart=${command} watch
Restart=on-failure
RestartSec=60
Nice=10
IOSchedulingClass=idle

[Install]
WantedBy=multi-user.target
`;
}
