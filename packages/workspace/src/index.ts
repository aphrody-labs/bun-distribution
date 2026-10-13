import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Resolve from this checkout; no workstation or host path is embedded. */
export const repositoryRoot = Bun.fileURLToPath(new URL("../../../", import.meta.url));

export interface Module {
  id: string;
  path: string;
  upstream: string;
  fork: string;
  branch: string;
  revision: string;
  upstreamRevision: string;
  license: string;
  kind: "library";
  role?: "engine" | "shared" | "fonts";
  description: string;
  binary?: string;
  cargoPackage?: string;
  manifestPath?: string;
}

export interface Config {
  schemaVersion: 1;
  runtime: { version: string; repository: string; revision: string };
  modules: Module[];
  desktop: Record<string, unknown> & { source?: Source };
}

export interface Source {
  path: string;
  repository: string;
  revision: string;
}

export interface Runtime {
  version: string;
  revision: string;
  sourceUrl: string | null;
  executable: string;
  recognizedFork: boolean;
  versionMatches: boolean;
  revisionMatches: boolean;
  expected: Config["runtime"];
}

export interface ModuleStatus {
  id: string;
  path: string;
  initialized: boolean;
  revision: string | null;
  expectedRevision: string;
  indexRevision: string | null;
  pointerMatches: boolean;
  revisionMatches: boolean;
  clean: boolean | null;
  launchable: boolean;
  launchReason: string;
  error?: string;
}

export interface ExecutionOptions {
  root?: string;
  timeoutMs?: number;
}

export interface NativeExecutionOptions extends ExecutionOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  serialize?: boolean;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const shortDeadline = 20_000;
const syncDeadline = 300_000;
const cargoDeadline = 1_800_000;
const runDeadline = 43_200_000;
const revisionPattern = /^[0-9a-f]{40}$/;

/** A lexical path guard for trusted checkout files and manifest arguments. */
export function checkoutPath(root: string, path: string): string {
  if (!path || isAbsolute(path)) throw new Error(`Relative path required: ${path}`);
  const target = resolve(root, path);
  const local = relative(resolve(root), target);
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`Path outside checkout: ${path}`);
  }
  return target;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function loadConfig(root = repositoryRoot): Promise<Config> {
  const value: unknown = await Bun.file(join(root, "aphrody.config.json")).json();
  if (!object(value) || value.schemaVersion !== 1 || !object(value.runtime)) {
    throw new Error("aphrody.config.json: schemaVersion 1 and runtime required.");
  }
  if (
    value.runtime.version !== "1.4.4" ||
    value.runtime.repository !== "aphrody-labs/bun" ||
    typeof value.runtime.revision !== "string" ||
    !revisionPattern.test(value.runtime.revision)
  ) {
    throw new Error("aphrody.config.json: Aphrody Bun 1.4.4 and full revision required.");
  }
  if (!Array.isArray(value.modules) || !object(value.desktop)) {
    throw new Error("aphrody.config.json: modules and desktop required.");
  }
  if (value.desktop.source !== undefined) {
    const source = value.desktop.source;
    if (
      !object(source) ||
      typeof source.path !== "string" ||
      source.repository !== "aphrody-labs/bun" ||
      typeof source.revision !== "string" ||
      !revisionPattern.test(source.revision)
    ) {
      throw new Error("aphrody.config.json: invalid pinned Bun SDK source.");
    }
    checkoutPath(root, source.path);
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const entry of value.modules) {
    if (!object(entry) || typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
      throw new Error("aphrody.config.json: invalid library identifier.");
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate library: ${entry.id}`);
    ids.add(entry.id);
    if (typeof entry.path !== "string") throw new Error(`Path required: ${entry.id}`);
    const modulePath = checkoutPath(root, entry.path);
    if (paths.has(modulePath)) throw new Error(`Duplicate path: ${entry.path}`);
    paths.add(modulePath);
    if (entry.upstream !== `storytold/${entry.id}` || entry.fork !== `aphrody-labs/${entry.id}`) {
      throw new Error(`Invalid source owners: ${entry.id}`);
    }
    for (const key of ["revision", "upstreamRevision"] as const) {
      if (typeof entry[key] !== "string" || !revisionPattern.test(entry[key])) {
        throw new Error(`Full revision required: ${entry.id}.${key}`);
      }
    }
    if (
      typeof entry.branch !== "string" ||
      !entry.branch ||
      typeof entry.license !== "string" ||
      !entry.license ||
      typeof entry.description !== "string" ||
      entry.kind !== "library" ||
      (entry.role !== undefined && !["engine", "shared", "fonts"].includes(String(entry.role)))
    ) {
      throw new Error(`Invalid library metadata: ${entry.id}`);
    }
    for (const key of ["binary", "cargoPackage"] as const) {
      if (entry[key] !== undefined && (typeof entry[key] !== "string" || !/^[a-zA-Z0-9_-]+$/.test(entry[key]))) {
        throw new Error(`Invalid Cargo name: ${entry.id}.${key}`);
      }
    }
    if (entry.binary !== undefined && (entry.role !== "engine" || entry.binary !== `${entry.id}-cli`)) {
      throw new Error(`Only an explicit headless engine CLI is allowed: ${entry.id}`);
    }
    if (entry.manifestPath !== undefined) {
      if (typeof entry.manifestPath !== "string") throw new Error(`Invalid manifest: ${entry.id}`);
      checkoutPath(modulePath, entry.manifestPath);
    }
  }
  return value as unknown as Config;
}

function runtimeFromFacts(
  config: Config,
  facts: Pick<Runtime, "version" | "revision" | "sourceUrl" | "executable">,
): Runtime {
  const { version, revision, sourceUrl, executable } = facts;
  let recognizedFork = false;
  if (sourceUrl) {
    try {
      const source = new URL(sourceUrl);
      const tag = source.pathname.split("/")[5];
      const stableTag = tag === `bun-v${config.runtime.version}`;
      const revisionTag = tag?.startsWith(`${config.runtime.version}+`)
        ? tag.slice(config.runtime.version.length + 1)
        : null;
      const pinnedTag =
        revisionTag !== null && /^[0-9a-f]{7,40}$/.test(revisionTag) && revision.startsWith(revisionTag);
      recognizedFork =
        source.protocol === "https:" &&
        source.hostname === "github.com" &&
        source.pathname.startsWith("/aphrody-labs/bun/releases/download/") &&
        revisionPattern.test(revision) &&
        (stableTag || pinnedTag);
    } catch {
      recognizedFork = false;
    }
  }
  return {
    version,
    revision,
    sourceUrl,
    executable,
    recognizedFork,
    versionMatches: version === config.runtime.version,
    revisionMatches: revision === config.runtime.revision,
    expected: config.runtime,
  };
}

export function inspectRuntime(config: Config): Runtime {
  const release = process.release as typeof process.release & { sourceUrl?: string };
  return runtimeFromFacts(config, {
    version: Bun.version,
    revision: Bun.revision,
    sourceUrl: release.sourceUrl ?? null,
    executable: process.execPath,
  });
}

/** All commands require the declared release fork; SHA drift is explicit. */
export function assertRuntime(config: Config, allowRevisionDrift = false): Runtime {
  const runtime = inspectRuntime(config);
  if (!runtime.recognizedFork || !runtime.versionMatches || (!allowRevisionDrift && !runtime.revisionMatches)) {
    throw new Error(
      `Required runtime: ${config.runtime.repository} ${config.runtime.version}+${config.runtime.revision}. Observed: ${runtime.version}+${runtime.revision}; provenance ${runtime.recognizedFork ? "valid" : "invalid"}.`,
    );
  }
  return runtime;
}

/** Compiled sidecars must use a separate, verified Bun executable. */
export async function resolveBunExecutable(config: Config, options: ExecutionOptions = {}): Promise<string> {
  const root = options.root ?? repositoryRoot;
  const configured = Bun.env.APHRODY_BUN_BINARY;
  let candidate = Bun.which("bun");
  if (configured) {
    if (isAbsolute(configured)) candidate = configured;
    else if (configured.includes("/") || configured.includes("\\")) candidate = checkoutPath(root, configured);
    else candidate = Bun.which(configured);
  }
  if (!candidate || !(await Bun.file(candidate).exists())) {
    throw new Error("Native Bun missing; set APHRODY_BUN_BINARY or provide bun on PATH.");
  }
  const probe = await command(
    [
      candidate,
      "--no-env-file",
      "-e",
      "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,sourceUrl:process.release.sourceUrl??null}))",
    ],
    root,
    Math.min(options.timeoutMs ?? 5_000, 5_000),
  );
  if (probe.code !== 0) throw new Error("Native Bun provenance probe failed.");
  let facts: unknown;
  try {
    facts = JSON.parse(probe.stdout.trim());
  } catch {
    throw new Error("Native Bun returned invalid provenance metadata.");
  }
  if (
    !object(facts) ||
    typeof facts.version !== "string" ||
    typeof facts.revision !== "string" ||
    (facts.sourceUrl !== null && typeof facts.sourceUrl !== "string")
  ) {
    throw new Error("Native Bun returned invalid provenance metadata.");
  }
  const runtime = runtimeFromFacts(config, {
    version: facts.version,
    revision: facts.revision,
    sourceUrl: facts.sourceUrl as string | null,
    executable: candidate,
  });
  if (!runtime.recognizedFork || !runtime.versionMatches || !runtime.revisionMatches) {
    throw new Error("Native Bun does not match the pinned Aphrody runtime.");
  }
  return candidate;
}

async function command(
  argv: string[],
  cwd: string,
  timeoutMs = shortDeadline,
  inherit = false,
  env: Record<string, string | undefined> = Bun.env,
  captureStdout = false,
): Promise<CommandResult> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > runDeadline) {
    throw new Error("Invalid command deadline.");
  }
  const controller = new AbortController();
  const child = Bun.spawn(argv, {
    cwd,
    env,
    stdin: inherit ? "inherit" : "ignore",
    stdout: captureStdout ? "pipe" : inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
    signal: controller.signal,
    killSignal: "SIGTERM",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* The owned group may already have exited. */
      }
      controller.abort();
      return;
    }
    // Stop the native owner's children before terminating its wrapper.
    try {
      const taskkill = Bun.which("taskkill");
      if (!taskkill) {
        controller.abort();
        return;
      }
      const killer = Bun.spawn([taskkill, "/PID", String(child.pid), "/T", "/F"], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        windowsHide: true,
        signal: AbortSignal.timeout(5_000),
      });
      void killer.exited.then(
        () => controller.abort(),
        () => controller.abort(),
      );
    } catch {
      controller.abort();
    }
  };
  const timer = setTimeout(stop, timeoutMs);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      inherit && !captureStdout ? Promise.resolve("") : new Response(child.stdout).text(),
      inherit ? Promise.resolve("") : new Response(child.stderr).text(),
    ]);
    if (stopping || controller.signal.aborted)
      throw new Error(`Command interrupted or deadline exceeded (${timeoutMs} ms).`);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function git(args: string[], root: string): Promise<string> {
  const result = await command(["git", ...args], root);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `Git failed (${result.code}).`);
  return result.stdout.trim();
}

export function findModule(config: Config, id: string): Module {
  const module = config.modules.find(entry => entry.id === id);
  if (!module) throw new Error(`Unknown library: ${id}`);
  return module;
}

interface Pin {
  id: string;
  path: string;
  fork: string;
  revision: string;
}

function pinnedSources(config: Config): Pin[] {
  const pins: Pin[] = [...config.modules];
  if (config.desktop.source) {
    pins.push({
      id: "bun-sdk",
      path: config.desktop.source.path,
      fork: config.desktop.source.repository,
      revision: config.desktop.source.revision,
    });
  }
  return pins;
}

/** Owner-selected local artifacts stay outside Git in .local/config.json. */
export async function localBinaries(config: Config, root = repositoryRoot): Promise<Record<string, string>> {
  const file = Bun.file(join(root, ".local", "config.json"));
  if (!(await file.exists())) return {};
  const value: unknown = await file.json();
  if (!object(value) || (value.binaries !== undefined && !object(value.binaries))) {
    throw new Error(".local/config.json: binaries must map library IDs to paths.");
  }
  const binaries: Record<string, string> = {};
  for (const [id, entry] of Object.entries(value.binaries ?? {})) {
    const module = findModule(config, id);
    if (
      module.role !== "engine" ||
      !module.binary ||
      module.binary !== `${id}-cli` ||
      typeof entry !== "string" ||
      !entry
    ) {
      throw new Error(`Invalid local headless CLI: ${id}`);
    }
    const path = isAbsolute(entry) ? resolve(entry) : checkoutPath(root, entry);
    const expected = `${module.binary}${process.platform === "win32" ? ".exe" : ""}`;
    if (basename(path).toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Local CLI ${id} must be named ${expected}.`);
    }
    if (!(await Bun.file(path).exists())) throw new Error(`Local CLI missing: ${id}`);
    binaries[id] = path;
  }
  return binaries;
}

export async function listModuleStatus(config: Config, root = repositoryRoot): Promise<ModuleStatus[]> {
  const result: ModuleStatus[] = [];
  const binaries = await localBinaries(config, root);
  // Keep process and signal ownership bounded, even for a large catalogue.
  for (const module of pinnedSources(config)) {
    const library = config.modules.find(entry => entry.id === module.id);
    const hasHeadlessBinary = library?.role === "engine" && library.binary === `${module.id}-cli`;
    const status: ModuleStatus = {
      id: module.id,
      path: module.path,
      initialized: false,
      revision: null,
      expectedRevision: module.revision,
      indexRevision: null,
      pointerMatches: false,
      revisionMatches: false,
      clean: null,
      launchable: false,
      launchReason: hasHeadlessBinary ? "Library source not initialized." : "Library has no headless CLI.",
    };
    try {
      const index = await git(["ls-files", "--stage", "--", module.path], root);
      const match = /^160000 ([0-9a-f]{40}) 0\t/.exec(index);
      status.indexRevision = match?.[1] ?? null;
      status.pointerMatches = status.indexRevision === module.revision;
      const directory = checkoutPath(root, module.path);
      status.initialized = await Bun.file(join(directory, ".git")).exists();
      if (status.initialized) {
        status.revision = await git(["rev-parse", "HEAD"], directory);
        status.revisionMatches = status.revision === module.revision;
        status.clean = (await git(["status", "--porcelain=v1", "--untracked-files=all"], directory)) === "";
        const manifestExists = library
          ? await Bun.file(checkoutPath(directory, library.manifestPath ?? "Cargo.toml")).exists()
          : false;
        status.launchable = Boolean(
          hasHeadlessBinary &&
          (manifestExists || binaries[module.id]) &&
          status.pointerMatches &&
          status.revisionMatches,
        );
        if (hasHeadlessBinary)
          status.launchReason = status.launchable
            ? binaries[module.id]
              ? "Headless artifact selected in .local/config.json."
              : "Headless CLI; native build may be required."
            : !manifestExists
              ? "Cargo manifest missing."
              : "Revision differs from catalog.";
      }
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
    }
    result.push(status);
  }
  return result;
}

async function requireModule(config: Config, id: string, root: string): Promise<Module> {
  const module = findModule(config, id);
  const status = (await listModuleStatus(config, root)).find(entry => entry.id === id)!;
  if (status.error || !status.initialized || !status.pointerMatches || !status.revisionMatches) {
    throw new Error(
      `${id} differs from the pinned source. Run aphrody-bun status and sync from a clean checkout. ${status.error ?? ""}`.trim(),
    );
  }
  return module;
}

export async function syncModules(config: Config, root = repositoryRoot): Promise<void> {
  assertRuntime(config);
  const states = await listModuleStatus(config, root);
  for (const state of states) {
    if (
      state.error ||
      !state.pointerMatches ||
      state.clean === false ||
      (state.initialized && !state.revisionMatches)
    ) {
      throw new Error(
        `Sync refused: ${state.id}; local changes or revision differs from catalog. ${state.error ?? ""}`.trim(),
      );
    }
  }
  if (await git(["status", "--porcelain=v1", "--untracked-files=all"], root)) {
    throw new Error("Sync refused: monorepo has local changes.");
  }
  const paths = await git(["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"], root);
  for (const module of pinnedSources(config)) {
    const line = paths.split("\n").find(entry => entry.endsWith(` ${module.path}`));
    if (!line) throw new Error(`Source missing from .gitmodules: ${module.id}`);
    const key = line.slice(0, line.indexOf(" ")).replace(/\.path$/, ".url");
    const url = await git(["config", "--file", ".gitmodules", "--get", key], root);
    const accepted = [
      `https://github.com/${module.fork}.git`,
      `https://github.com/${module.fork}`,
      `git@github.com:${module.fork}.git`,
    ];
    if (!accepted.includes(url)) throw new Error(`Unexpected fork URL: ${module.id}`);
  }
  for (const module of pinnedSources(config)) {
    const current = (await listModuleStatus(config, root)).find(entry => entry.id === module.id)!;
    if (
      current.error ||
      !current.pointerMatches ||
      current.clean === false ||
      (current.initialized && !current.revisionMatches)
    ) {
      throw new Error(`Sync stopped: ${module.id} changed during the operation.`);
    }
    if (current.initialized) continue;
    if (await git(["status", "--porcelain=v1", "--untracked-files=all"], root)) {
      throw new Error("Sync stopped: monorepo received local changes.");
    }
    const result = await command(
      ["git", "submodule", "update", "--init", "--checkout", "--", module.path],
      root,
      syncDeadline,
      true,
    );
    if (result.code !== 0) throw new Error(`Source initialization failed: ${module.id} (${result.code}).`);
  }
  const initialized = await listModuleStatus(config, root);
  if (
    initialized.some(
      state => state.error || !state.initialized || !state.revisionMatches || !state.pointerMatches || !state.clean,
    )
  ) {
    throw new Error("Initialized sources differ from the pinned catalog.");
  }
}

interface CargoModule {
  directory: string;
  manifest: string;
  cargoPackage: string | null;
  binary: string | null;
}

export async function resolveCargoModule(module: Module, root = repositoryRoot): Promise<CargoModule> {
  if (module.binary && (module.role !== "engine" || module.binary !== `${module.id}-cli`)) {
    throw new Error(`Only an explicit headless engine CLI is allowed: ${module.id}`);
  }
  const directory = checkoutPath(root, module.path);
  const manifest = checkoutPath(directory, module.manifestPath ?? "Cargo.toml");
  if (!(await Bun.file(manifest).exists())) throw new Error(`Cargo manifest missing: ${module.id}`);
  const value = Bun.TOML.parse(await Bun.file(manifest).text()) as {
    package?: { name?: string };
  };
  const cargoPackage = module.cargoPackage ?? value.package?.name ?? null;
  if (!cargoPackage && module.binary) throw new Error(`cargoPackage required for the headless CLI: ${module.id}`);
  const binary = module.binary ?? null;
  return { directory, manifest, cargoPackage, binary };
}

/** Serialize a native build owner, including the Tauri CLI, without a shell. */
async function runNativeResult(
  config: Config,
  nativeArguments: string[],
  options: NativeExecutionOptions = {},
  captureStdout = false,
): Promise<CommandResult> {
  assertRuntime(config);
  if (!nativeArguments.length || nativeArguments.some(arg => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("Invalid native arguments.");
  }
  const root = options.root ?? repositoryRoot;
  const cwd = options.cwd ?? root;
  const timeoutMs = options.timeoutMs ?? cargoDeadline;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > runDeadline) {
    throw new Error("Invalid native deadline; maximum 12 hours.");
  }
  const env: Record<string, string | undefined> = {
    ...Bun.env,
    ...options.env,
    CARGO_BUILD_JOBS: "1",
  };
  // Preserve valid owner wrappers; an unavailable sccache path must not break builds.
  if (env.RUSTC_WRAPPER && !Bun.which(env.RUSTC_WRAPPER)) {
    const sccache = Bun.which("sccache");
    if (sccache) env.RUSTC_WRAPPER = sccache;
    else {
      delete env.RUSTC_WRAPPER;
      console.error("Optional Rust cache unavailable; using a direct build.");
    }
  }
  if (options.serialize === false) {
    return command(nativeArguments, cwd, timeoutMs, true, env, captureStdout);
  }
  let argv: string[];
  if (process.platform === "win32") {
    const powershell = Bun.which("pwsh") ?? Bun.which("powershell");
    if (!powershell) throw new Error("Native PowerShell missing on this host.");
    // JSON travels in the environment, avoiding PowerShell's native argv re-quoting.
    env.APHRODY_NATIVE_ARGUMENTS = JSON.stringify(nativeArguments.slice(1));
    env.APHRODY_NATIVE_EXECUTABLE = Bun.which(nativeArguments[0]!) ?? nativeArguments[0];
    const wrapperSeconds = Math.max(1, Math.ceil(Math.min(timeoutMs, runDeadline - 5_000) / 1000));
    argv = [
      powershell,
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(root, "scripts", "cargo-serial.ps1"),
      "-WorkingDirectory",
      cwd,
      "-TimeoutSeconds",
      String(wrapperSeconds),
    ];
  } else {
    const flock = Bun.which("flock");
    if (!flock) throw new Error("Native flock required for build serialization on this Unix host.");
    const temporaryDirectory = Bun.env.TMPDIR ?? "/tmp";
    const identity = process.getuid?.() ?? "user";
    argv = [flock, "--nonblock", join(temporaryDirectory, `aphrody-bun-native-${identity}.lock`), ...nativeArguments];
  }
  // The wrapper kills its process tree before the outer Bun deadline.
  return command(
    argv,
    cwd,
    Math.min(runDeadline, timeoutMs + (process.platform === "win32" ? 5_000 : 0)),
    true,
    env,
    captureStdout,
  );
}

export async function runNative(config: Config, argv: string[], options: NativeExecutionOptions = {}): Promise<number> {
  return (await runNativeResult(config, argv, options)).code;
}

/** Resolve Bun's existing native MSVC owner, with an explicit checkout override. */
async function serializedCargo(
  config: Config,
  args: string[],
  cwd: string,
  root: string,
  timeoutMs: number,
  captureStdout = false,
): Promise<CommandResult> {
  const cargo = Bun.which("cargo");
  if (!cargo) throw new Error("Native Cargo missing on this host.");
  let argv = [cargo, ...args];
  if (process.platform === "win32") {
    const bun = await resolveBunExecutable(config, { root });
    argv = [bun, "msvc", "exec", "--", cargo, ...args];
    if (Bun.env.APHRODY_BUN_CHECKOUT) {
      const owner = join(resolve(Bun.env.APHRODY_BUN_CHECKOUT), "scripts", "build", "rust", "cargo-serial.ts");
      if (!(await Bun.file(owner).exists()))
        throw new Error("Cargo owner wrapper missing from the configured APHRODY_BUN_CHECKOUT.");
      argv = [bun, owner, "--msvc", ...args];
    }
  }
  return runNativeResult(config, argv, { root, cwd, timeoutMs }, captureStdout);
}

export async function cargoModule(
  config: Config,
  id: string,
  action: "check" | "build" | "run",
  args: string[] = [],
  options: ExecutionOptions = {},
): Promise<number> {
  assertRuntime(config);
  const root = options.root ?? repositoryRoot;
  const module = await requireModule(config, id, root);
  const cargo = await resolveCargoModule(module, root);
  const flags = [action, "--locked", "--manifest-path", cargo.manifest];
  if (cargo.cargoPackage) flags.push("--package", cargo.cargoPackage);
  else flags.push("--workspace");
  if (action === "run") {
    if (!cargo.binary) throw new Error(`Library has no headless CLI: ${id}`);
    flags.push("--bin", cargo.binary, "--", ...args);
  } else {
    if (args.length) throw new Error(`${action} accepts only a library ID.`);
    if (action === "build") flags.push("--release");
  }
  return (await serializedCargo(config, flags, cargo.directory, root, options.timeoutMs ?? cargoDeadline)).code;
}

export async function runModule(
  config: Config,
  id: string,
  args: string[] = [],
  options: ExecutionOptions = {},
): Promise<number> {
  assertRuntime(config);
  const root = options.root ?? repositoryRoot;
  const module = await requireModule(config, id, root);
  const selected = (await localBinaries(config, root))[id];
  if (selected) {
    return (await command([selected, ...args], checkoutPath(root, module.path), options.timeoutMs ?? runDeadline, true))
      .code;
  }
  const cargo = await resolveCargoModule(module, root);
  if (!cargo.binary || module.role !== "engine" || cargo.binary !== `${id}-cli`)
    throw new Error(`Library has no headless CLI: ${id}`);
  const build = await serializedCargo(
    config,
    [
      "build",
      "--release",
      "--locked",
      "--manifest-path",
      cargo.manifest,
      "--package",
      cargo.cargoPackage!,
      "--bin",
      cargo.binary,
      "--message-format=json",
    ],
    cargo.directory,
    root,
    Math.min(cargoDeadline, options.timeoutMs ?? cargoDeadline),
    true,
  );
  let binary: string | null = null;
  for (const line of build.stdout.split("\n")) {
    try {
      const artifact = JSON.parse(line) as {
        reason?: string;
        executable?: string;
        target?: { name?: string; kind?: string[] };
        message?: { rendered?: string };
      };
      if (artifact.reason === "compiler-message" && artifact.message?.rendered) {
        console.error(artifact.message.rendered);
      }
      if (
        artifact.reason === "compiler-artifact" &&
        artifact.target?.name === cargo.binary &&
        artifact.target.kind?.includes("bin") &&
        typeof artifact.executable === "string"
      ) {
        binary = artifact.executable;
      }
    } catch {
      // Native owner diagnostics may accompany Cargo's JSON output.
    }
  }
  if (build.code !== 0) return build.code;
  if (!binary || !(await Bun.file(binary).exists())) {
    throw new Error(`Cargo did not report a headless CLI artifact: ${id}`);
  }
  // Release the build mutex before starting the headless CLI.
  return (await command([binary, ...args], cargo.directory, options.timeoutMs ?? runDeadline, true)).code;
}
