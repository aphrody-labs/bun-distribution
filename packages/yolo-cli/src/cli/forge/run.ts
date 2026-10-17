// SPDX-License-Identifier: Apache-2.0
//! Side effects of bun-forge: probing and installing the toolchain, the commit mirror, scratch space, the build itself,
//! smoke checks, artifacts and the watch loop.
/* oxlint-disable eslint/no-await-in-loop -- scratch commands, builds and watch rounds run one after another on purpose */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { withFactoryResource } from "@aphrody/bun-workspace/automation/build-factory-cleanup.ts";
import { readFactoryConfig } from "@aphrody/bun-workspace/automation/build-factory.ts";
import { auditGlibc, lowerGlibcCeiling } from "./glibc.ts";
import { availableParallelism, totalmem, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { COMPILE_FLAGS } from "@aphrody/yolo-core/src/compiler/flags.ts";
import {
  type Arch,
  type Options,
  type Paths,
  type Receipt,
  type State,
  type StepRecord,
  buildCommand,
  buildEnv,
  commitQueue,
  compareVersions,
  fail,
  hostArch,
  llvmAccepted,
  paths,
  recordBuild,
  remoteHead,
  rustChannel,
  scratchPlan,
  artifactLayout,
  BINARY,
  compileCommand,
  SMOKE_SCRIPT,
  YOLO_CLI,
  systemdUnit,
  toolUrl,
  versionIn,
} from "./plan.ts";

/** First-party test files a release build can run: `bun:internal-for-testing` only exists in debug and ASAN builds. */
export function firstPartyTests(tree: string): string[] {
  const root = join(tree, "test/js/first_party");
  const files: string[] = [];
  for (const file of new Bun.Glob("**/*.test.{ts,tsx,js,mjs}").scanSync({
    cwd: root,
  }))
    if (!readFileSync(join(root, file), "utf8").includes("bun:internal-for-testing"))
      files.push(`test/js/first_party/${file}`);
  return files.toSorted();
}

const log = (message: string) => console.error(`\x1b[36m[bun-forge]\x1b[0m ${message}`);

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

function capture(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Captured {
  try {
    const r = Bun.spawnSync(cmd, {
      windowsHide: true,
      cwd: opts.cwd,
      env: opts.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: r.exitCode ?? 1,
      stdout: r.stdout.toString(),
      stderr: r.stderr.toString(),
    };
  } catch (e) {
    return { code: 127, stdout: "", stderr: (e as Error).message };
  }
}

/** Runs a command with output streamed to the terminal and appended to `logFile`. */
async function run(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string>; logFile?: string } = {},
): Promise<void> {
  log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    windowsHide: true,
    cwd: opts.cwd,
    env: opts.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const sink = opts.logFile ? Bun.file(opts.logFile).writer() : undefined;
  const pump = async (stream: ReadableStream<Uint8Array>, out: NodeJS.WriteStream) => {
    for await (const chunk of stream) {
      out.write(chunk);
      sink?.write(chunk);
    }
  };
  await Promise.all([pump(proc.stdout, process.stdout), pump(proc.stderr, process.stderr)]);
  const code = await proc.exited;
  await sink?.end();
  if (code !== 0) fail(`${cmd[0]} exited with ${code}`);
}

let rootPrefixCache: string[] | null | undefined;
/** `[]` as root, `["sudo", "-n"]` with passwordless sudo, otherwise null. */
function rootPrefix(): string[] | null {
  if (rootPrefixCache !== undefined) return rootPrefixCache;
  if (process.getuid?.() === 0) rootPrefixCache = [];
  else rootPrefixCache = capture(["sudo", "-n", "true"]).code === 0 ? ["sudo", "-n"] : null;
  return rootPrefixCache;
}

async function asRoot(cmd: string[], logFile?: string): Promise<void> {
  const prefix = rootPrefix();
  if (prefix === null) fail(`needs root or passwordless sudo: ${cmd.join(" ")}`);
  await run([...prefix, ...cmd], {
    logFile,
    env: {
      ...(process.env as Record<string, string>),
      DEBIAN_FRONTEND: "noninteractive",
    },
  });
}

const which = (name: string) => Bun.which(name) ?? undefined;

async function download(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  log(`download ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) fail(`download failed (${response.status}): ${url}`);
  const part = `${dest}.part`;
  await Bun.write(part, response);
  renameSync(part, dest);
}

async function extract(archive: string, dest: string): Promise<void> {
  const staging = `${dest}.staging`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  await run(["tar", "-xf", archive, "-C", staging, "--strip-components=1"]);
  rmSync(dest, { recursive: true, force: true });
  renameSync(staging, dest);
}

// ── Toolchain ──────────────────────────────────────────────────────────────

export interface Toolchain {
  arch: Arch;
  llvmDir?: string;
  llvmVersion?: string;
  llvmSystem: boolean;
  cmakeDir?: string;
  cmakeVersion?: string;
  rustup?: string;
  missingApt: string[];
  missingBinaries: string[];
  root: boolean;
}

function systemLlvm(major: number): { dir: string; version: string } | undefined {
  for (const dir of [`/usr/lib/llvm-${major}`, "/usr/lib/llvm", `/usr/lib/llvm${major}`]) {
    const clang = join(dir, "bin/clang");
    if (!existsSync(clang)) continue;
    const version = versionIn(capture([clang, "--version"]).stdout);
    if (llvmAccepted(version, major) && existsSync(join(dir, "bin/ld.lld"))) return { dir, version: version! };
  }
  return undefined;
}

export function probe(options: Options): Toolchain {
  const p = paths(options);
  const tc = options.config.toolchain;
  const arch = hostArch(process.arch);
  const sys = systemLlvm(tc.llvm.major);
  const cachedLlvm = existsSync(join(p.llvm, "bin/clang")) ? p.llvm : undefined;
  const llvmDir = sys?.dir ?? cachedLlvm;
  const llvmVersion =
    sys?.version ?? (cachedLlvm ? versionIn(capture([join(cachedLlvm, "bin/clang"), "--version"]).stdout) : undefined);
  const systemCmake = which("cmake");
  const systemCmakeVersion = systemCmake ? versionIn(capture([systemCmake, "--version"]).stdout) : undefined;
  const cmakeOk = systemCmakeVersion !== undefined && compareVersions(systemCmakeVersion, tc.cmake.minimum) >= 0;
  const cachedCmake = existsSync(join(p.cmake, "bin/cmake")) ? p.cmake : undefined;
  const hasDpkg = which("dpkg-query") !== undefined;
  const missingApt = hasDpkg
    ? tc.apt.filter(pkg => !capture(["dpkg-query", "-W", "-f=${Status}", pkg]).stdout.includes("install ok installed"))
    : [];
  const rustup = existsSync(join(p.cargoHome, "bin/rustup")) ? join(p.cargoHome, "bin/rustup") : which("rustup");
  return {
    arch,
    llvmDir,
    llvmVersion,
    llvmSystem: sys !== undefined,
    cmakeDir: cmakeOk ? undefined : cachedCmake,
    cmakeVersion: cmakeOk ? systemCmakeVersion : cachedCmake ? tc.cmake.version : undefined,
    rustup,
    missingApt,
    missingBinaries: tc.binaries.filter(b => which(b) === undefined),
    root: rootPrefix() !== null,
  };
}

export function doctor(options: Options): boolean {
  const t = probe(options);
  const rows: [string, string, boolean][] = [
    ["arch", t.arch, true],
    ["llvm", t.llvmDir ? `${t.llvmVersion} (${t.llvmDir})` : "missing", !!t.llvmDir],
    ["cmake", t.cmakeVersion ?? "missing", !!t.cmakeVersion],
    ["rustup", t.rustup ?? "missing", !!t.rustup],
    ["apt", t.missingApt.length ? `missing: ${t.missingApt.join(" ")}` : "ok", t.missingApt.length === 0],
    [
      "binaries",
      t.missingBinaries.length ? `missing: ${t.missingBinaries.join(" ")}` : "ok",
      t.missingBinaries.length === 0,
    ],
    ["root", t.root ? "yes (loop/tmpfs scratch, apt)" : "no (dir scratch only)", true],
    ["cpus", String(availableParallelism()), true],
    ["memory", `${(totalmem() / 2 ** 30).toFixed(1)} GiB`, true],
  ];
  for (const [name, value, ok] of rows) console.log(`${ok ? "ok  " : "MISS"} ${name.padEnd(9)} ${value}`);
  return rows.every(([, , ok]) => ok);
}

export async function bootstrap(options: Options, logFile?: string): Promise<Toolchain> {
  const p = paths(options);
  const tc = options.config.toolchain;
  for (const dir of [p.home, p.bin, p.toolchains, p.downloads, p.logs]) mkdirSync(dir, { recursive: true });
  let t = probe(options);
  if (t.missingApt.length) {
    log(`apt: ${t.missingApt.join(" ")}`);
    await asRoot(["apt-get", "update", "-q"], logFile);
    await asRoot(["apt-get", "install", "-y", "-q", "--no-install-recommends", ...t.missingApt], logFile);
  }
  if (!t.llvmDir) {
    const url = toolUrl(tc.llvm.url, tc.llvm.version, "llvm", t.arch);
    const archive = join(p.downloads, url.split("/").pop()!);
    await download(url, archive);
    await extract(archive, p.llvm);
  }
  if (!t.cmakeVersion) {
    const url = toolUrl(tc.cmake.url, tc.cmake.version, "cmake", t.arch);
    const archive = join(p.downloads, url.split("/").pop()!);
    await download(url, archive);
    await extract(archive, p.cmake);
  }
  if (!t.rustup) {
    const url = toolUrl(tc.rustup.url, tc.rustup.version, "rustup", t.arch);
    const init = join(p.downloads, `rustup-init-${tc.rustup.version}-${t.arch}`);
    await download(url, init);
    await run(["chmod", "+x", init]);
    await run([init, "-y", "--no-modify-path", "--profile", "minimal", "--default-toolchain", "none"], {
      env: {
        ...(process.env as Record<string, string>),
        CARGO_HOME: p.cargoHome,
        RUSTUP_HOME: p.rustupHome,
      },
      logFile,
    });
  }
  writeBunShim(p);
  t = probe(options);
  if (t.missingBinaries.length)
    fail(`missing tools: ${t.missingBinaries.join(" ")} (install them with the system package manager)`);
  if (!t.llvmDir || !t.cmakeVersion || !t.rustup) fail("toolchain incomplete after bootstrap; run `yolo forge doctor`");
  return t;
}

/** `bun` on the build PATH: this executable itself (a compiled Bun program acts as `bun` with BUN_BE_BUN=1). */
function writeBunShim(p: Paths): void {
  const shim = join(p.bin, "bun");
  const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/");
  const target = compiled ? process.execPath : (Bun.which("bun") ?? process.execPath);
  writeFileSync(shim, `#!/bin/sh\n${compiled ? "BUN_BE_BUN=1 " : ""}exec '${target.replaceAll("'", "'\\''")}' "$@"\n`, {
    mode: 0o755,
  });
}

// ── Mirror ─────────────────────────────────────────────────────────────────

function git(args: string[], cwd?: string): string {
  const r = capture(["git", ...args], { cwd });
  if (r.code !== 0) fail(`git ${args[0]} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

function ensureMirror(options: Options): string {
  const p = paths(options);
  if (!existsSync(join(p.mirror, "HEAD"))) {
    mkdirSync(p.mirror, { recursive: true });
    git(["init", "-q", "--bare", p.mirror]);
    git(["-C", p.mirror, "remote", "add", "origin", options.config.repository]);
    git(["-C", p.mirror, "config", "remote.origin.promisor", "true"]);
    git(["-C", p.mirror, "config", "remote.origin.partialclonefilter", "blob:none"]);
    git(["-C", p.mirror, "config", "extensions.partialClone", "origin"]);
  } else {
    git(["-C", p.mirror, "remote", "set-url", "origin", options.config.repository]);
  }
  return p.mirror;
}

function fetchBranch(options: Options): string[] {
  const mirror = ensureMirror(options);
  const { branch, watch: watchConfig } = options.config;
  git([
    "-C",
    mirror,
    "fetch",
    "-q",
    "--filter=blob:none",
    `--depth=${watchConfig.historyDepth}`,
    "origin",
    `+refs/heads/${branch}:refs/heads/${branch}`,
  ]);
  return git([
    "-C",
    mirror,
    "rev-list",
    "--first-parent",
    `--max-count=${watchConfig.historyDepth}`,
    `refs/heads/${branch}`,
  ])
    .split("\n")
    .filter(Boolean);
}

function fetchRevision(options: Options, sha: string): void {
  const mirror = ensureMirror(options);
  if (capture(["git", "-C", mirror, "cat-file", "-e", `${sha}^{commit}`]).code === 0) return;
  git(["-C", mirror, "fetch", "-q", "--filter=blob:none", "--depth=1", "origin", sha]);
}

// ── Lock and state ─────────────────────────────────────────────────────────

function withLock<T>(p: Paths, body: () => Promise<T>): Promise<T> {
  mkdirSync(p.home, { recursive: true });
  try {
    const fd = openSync(p.lock, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    const holder = Number(readFileSync(p.lock, "utf8"));
    let alive = false;
    try {
      process.kill(holder, 0);
      alive = true;
    } catch {}
    if (alive) fail(`another bun-forge (pid ${holder}) holds ${p.lock}`);
    writeFileSync(p.lock, String(process.pid));
  }
  const runLeased = async () => {
    const factoryRoot =
      process.env.APHRODY_ROOT?.trim() ||
      process.env.APHRODY_WORKSPACE_ROOT?.trim() ||
      resolve(import.meta.dir, "../../../../../docs/aphrody");
    const factoryPolicy = await readFactoryConfig(factoryRoot);
    if (factoryPolicy && existsSync(factoryPolicy.lockPath)) {
      return withFactoryResource(factoryPolicy, body);
    }
    return body();
  };
  return runLeased().finally(() => rmSync(p.lock, { force: true }));
}

function readState(p: Paths): State {
  try {
    return JSON.parse(readFileSync(p.state, "utf8"));
  } catch {
    return { builds: [] };
  }
}

// ── Build ──────────────────────────────────────────────────────────────────

async function step<T>(steps: StepRecord[], name: string, body: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  log(`── ${name}`);
  try {
    const value = await body();
    steps.push({
      name,
      ok: true,
      seconds: Math.round((performance.now() - start) / 100) / 10,
    });
    return value;
  } catch (e) {
    steps.push({
      name,
      ok: false,
      seconds: Math.round((performance.now() - start) / 100) / 10,
      detail: (e as Error).message,
    });
    throw e;
  }
}

export async function buildRevision(options: Options, sha: string): Promise<Receipt> {
  const p = paths(options);
  if (process.env.APHRODY_FACTORY_RESOURCE) p.scratch = join(process.env.APHRODY_FACTORY_RESOURCE, "forge");
  const startedAt = new Date().toISOString();
  const steps: StepRecord[] = [];
  mkdirSync(p.logs, { recursive: true });
  const logFile = join(p.logs, `${sha}.log`);
  writeFileSync(logFile, "");
  const receipt: Receipt = {
    schema: "aphrody.bun-forge/1",
    repository: options.config.repository,
    branch: options.config.branch,
    revision: sha,
    profile: options.config.profile,
    lto: options.config.lto,
    scratch: options.config.scratch.mode,
    host: {
      arch: process.arch,
      cpus: availableParallelism(),
      memoryBytes: totalmem(),
    },
    toolchain: {},
    steps,
    ok: false,
    startedAt,
    finishedAt: startedAt,
  };
  const out = join(options.artifacts, sha);
  let plan: ReturnType<typeof scratchPlan> | undefined;
  let worktree: string | undefined;
  try {
    const t = await step(steps, "toolchain", () => bootstrap(options, logFile));
    receipt.toolchain = {
      llvm: `${t.llvmVersion} ${t.llvmDir}`,
      cmake: t.cmakeVersion ?? "",
      bun: Bun.version,
    };
    await step(steps, "fetch", () => fetchRevision(options, sha));
    const info = userInfo();
    mkdirSync(p.scratch, { recursive: true });
    plan = scratchPlan(
      process.env.APHRODY_FACTORY_RESOURCE ? "dir" : options.config.scratch.mode,
      options.config.scratch.size,
      p.scratch,
      sha,
      {
        root: t.root,
        freeBytes: Number(statfsSync(p.scratch).bavail) * Number(statfsSync(p.scratch).bsize),
        uid: info.uid,
        gid: info.gid,
      },
    );
    receipt.scratch = plan.mode;
    const scratch = plan;
    await step(steps, `scratch (${scratch.mode})`, async () => {
      for (const cmd of scratch.setup) await (scratch.mode === "dir" ? run(cmd) : asRoot(cmd, logFile));
    });
    worktree = join(plan.dir, "src");
    const tree = worktree;
    await step(steps, "checkout", () =>
      git(["-C", p.mirror, "worktree", "add", "-q", "--detach", "--force", tree, sha]),
    );
    const channel = rustChannel(readFileSync(join(tree, "rust-toolchain.toml"), "utf8"));
    const env = buildEnv({
      paths: p,
      baseEnv: process.env,
      rustChannel: channel,
      llvmDir: t.llvmSystem ? undefined : t.llvmDir,
      cmakeDir: t.cmakeDir,
    });
    receipt.toolchain.rust = channel;
    await step(steps, `rust ${channel}`, () =>
      run(
        [
          t.rustup!,
          "toolchain",
          "install",
          channel,
          "--profile",
          "minimal",
          "--component",
          "rust-src",
          "--no-self-update",
        ],
        { env, logFile },
      ),
    );
    await step(steps, "build", () =>
      run(buildCommand(options.config, options.jobs), {
        cwd: tree,
        env,
        logFile,
      }),
    );
    const built = join(tree, "build", options.config.profile, "bun");
    if (!existsSync(built)) fail(`build produced no ${built}`);
    await step(steps, "artifact", async () => {
      mkdirSync(out, { recursive: true });
      const dest = artifactLayout(out).binary;
      if (options.yoloRoot) {
        // One executable: the yolo CLI compiled onto the engine just built, so the engine is not copied twice.
        const root = resolve(options.yoloRoot);
        const entry = join(root, YOLO_CLI.entry);
        if (!existsSync(entry)) fail(`no yolo CLI at ${entry} (--yolo-root)`);
        const version = readFileSync(join(root, YOLO_CLI.versionFile), "utf8").trim();
        await Bun.write(dest, Bun.file(built));
        await run(["chmod", "+x", dest]);
        const flags = [...COMPILE_FLAGS];
        await run(compileCommand(built, dest, version, flags, options.yoloAsset), {
          cwd: root,
          env,
          logFile,
        });
        receipt.compiled = {
          entry: YOLO_CLI.entry,
          version,
          flags,
          asset: options.yoloAsset ?? null,
        };
      } else {
        await Bun.write(dest, Bun.file(built));
      }
      await run(["chmod", "+x", dest]);
      let bytes = await Bun.file(dest).bytes();
      const ceiling = options.config.glibcCeiling;
      if (ceiling) {
        const maxBefore = auditGlibc(bytes, ceiling).maxGlibc;
        const result = lowerGlibcCeiling(bytes, ceiling);
        if (result.patched.length > 0) {
          await Bun.write(dest, bytes);
          bytes = await Bun.file(dest).bytes();
        }
        receipt.glibc = {
          ceiling,
          maxBefore,
          maxAfter: result.maxGlibc,
          patched: result.patched,
        };
      }
      receipt.aliases = [];
      for (const [name, path] of Object.entries(artifactLayout(out).aliases)) {
        rmSync(path, { force: true });
        symlinkSync(BINARY.name, path);
        receipt.aliases.push({ name, path, target: BINARY.name });
      }
      receipt.artifact = {
        path: dest,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
    });
    await step(steps, "smoke", () => {
      const aliasPath = (name: string) => receipt.aliases!.find(alias => alias.name === name)!.path;
      const engine = aliasPath("bun");
      // The engine answers to the `bun` alias whether or not the CLI is compiled onto it.
      const viaBun = capture([engine, "-e", SMOKE_SCRIPT], { env });
      if (viaBun.code !== 0) fail(`smoke through the bun alias failed: ${viaBun.stderr.trim()}`);
      receipt.smoke = JSON.parse(viaBun.stdout.trim().split("\n").pop()!);
      const engineSmoke = receipt.smoke as { argv0: string; revision: string };
      if (engineSmoke.argv0 !== "bun") fail(`bun alias argv0 is ${engineSmoke.argv0}`);
      if (!receipt.compiled) {
        // Bare engine: `yolo` is the same file as `bun`.
        const viaYolo = capture([receipt.artifact!.path, "-e", SMOKE_SCRIPT], {
          env,
        });
        if (viaYolo.code !== 0) fail(`smoke through yolo failed: ${viaYolo.stderr.trim()}`);
        receipt.smokeAlias = JSON.parse(viaYolo.stdout.trim().split("\n").pop()!);
        const second = receipt.smokeAlias as {
          argv0: string;
          revision: string;
        };
        if (second.argv0 !== BINARY.name || second.revision !== engineSmoke.revision)
          fail(`argv0 check failed: ${second.argv0}`);
        return;
      }
      // Compiled: `yolo` runs the CLI, `vu` delegates to the vu runtime artifact (absent here: exit 127).
      const yolo = capture([receipt.artifact!.path, "version"], { env });
      if (yolo.code !== 0 || !yolo.stdout.startsWith("yolo "))
        fail(`yolo version failed: ${(yolo.stderr || yolo.stdout).trim()}`);
      receipt.smokeYolo = yolo.stdout.trim();
      const emptyHome = join(out, ".vu-none");
      mkdirSync(emptyHome, { recursive: true });
      const vu = capture([aliasPath("vu"), "--version"], {
        env: { ...env, VU_HOME: emptyHome },
      });
      rmSync(emptyHome, { recursive: true, force: true });
      if (vu.code !== 127 || !vu.stderr.includes("vu: runtime not installed"))
        fail(`vu alias did not dispatch by argv0: exit ${vu.code} ${vu.stderr.trim()}`);
      receipt.smokeVu = { exit: vu.code, message: vu.stderr.trim() };
    });
    if (options.tests) {
      await step(steps, "tests (first_party)", async () => {
        // The engine as built (argv0 bun): a compiled yolo would run its CLI when the tests spawn process.execPath.
        await run([built, "install", "--ignore-scripts"], {
          cwd: join(tree, "test"),
          env,
          logFile,
        });
        const suites = firstPartyTests(tree);
        await run([built, "test", ...suites], {
          cwd: tree,
          env: {
            ...env,
            BUN_DEBUG_QUIET_LOGS: "1",
            BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
          },
          logFile,
        });
      });
    }
    receipt.ok = true;
  } catch (e) {
    log(`\x1b[31mFAILED\x1b[0m ${sha.slice(0, 12)}: ${(e as Error).message}`);
  } finally {
    receipt.finishedAt = new Date().toISOString();
    if (worktree && !options.keep) capture(["git", "-C", p.mirror, "worktree", "remove", "--force", worktree]);
    if (plan && !options.keep) {
      for (const cmd of plan.teardown) {
        const prefix = plan.mode === "dir" ? [] : (rootPrefix() ?? []);
        capture([...prefix, ...cmd]);
      }
    }
    capture(["git", "-C", p.mirror, "worktree", "prune"]);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.ok) {
      rmSync(join(options.artifacts, "latest"), { force: true });
      capture(["ln", "-s", sha, join(options.artifacts, "latest")]);
    }
    writeFileSync(p.state, `${JSON.stringify(recordBuild(readState(p), receipt), null, 2)}\n`);
  }
  log(`${receipt.ok ? "\x1b[32mOK\x1b[0m" : "\x1b[31mFAILED\x1b[0m"} ${sha} -> ${join(out, "receipt.json")}`);
  return receipt;
}

export async function build(options: Options): Promise<boolean> {
  const p = paths(options);
  return withLock(p, async () => {
    let sha = options.revision;
    if (!sha) {
      const head = remoteHead(
        git(["ls-remote", options.config.repository, `refs/heads/${options.config.branch}`]),
        options.config.branch,
      );
      if (!head) fail(`branch ${options.config.branch} not found on ${options.config.repository}`);
      sha = head;
    }
    if (options.dryRun) {
      console.log(
        JSON.stringify(
          {
            revision: sha,
            command: buildCommand(options.config, options.jobs),
            paths: p,
          },
          null,
          2,
        ),
      );
      return true;
    }
    return (await buildRevision(options, sha)).ok;
  });
}

export async function watch(options: Options): Promise<void> {
  const p = paths(options);
  for (;;) {
    try {
      await withLock(p, async () => {
        const history = fetchBranch(options);
        const queue = commitQueue(history, readState(p).last, options.config.watch.everyCommit);
        if (queue.length === 0) log(`${options.config.branch} @ ${history[0]?.slice(0, 12)}: up to date`);
        for (const sha of queue) {
          await buildRevision(options, sha);
        }
      });
    } catch (e) {
      log(`watch: ${(e as Error).message}`);
    }
    if (options.once) return;
    await Bun.sleep(options.config.watch.intervalSeconds * 1000);
  }
}

export function status(options: Options): void {
  const p = paths(options);
  const state = readState(p);
  console.log(
    JSON.stringify(
      {
        home: p.home,
        artifacts: options.artifacts,
        last: state.last,
        recent: state.builds.slice(-10),
      },
      null,
      2,
    ),
  );
}

/** Prints the systemd unit; `command` is how this forge is invoked (`yolo forge` or the standalone executable). */
export function unit(options: Options, command: string): void {
  console.log(systemdUnit(command, options.home, userInfo().username));
}
