/**
 * The vu runtime artifact as seen by `yolo py` (docs/plans/vu/PLAN.md, section 3.6): where it lives and the checks
 * that must pass before any tool of it is used. Installation and activation are not done here.
 *
 *   $VU_HOME (default ~/.vu)/runtime/<target>/<version>-<revision8>/   the artifact (CPython prefix + bin/vu, uv, ruff)
 *   $VU_HOME/runtime/<target>/current                                  link to the active artifact
 *
 * The manifest (`share/vu/manifest.json`, schema 1, name `vu-runtime`) lists every file with its sha256, size and
 * mode and the symlinks. A quick check verifies the manifest, the target, the CLI major and the three executables; a
 * full check verifies every file.
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  delimiter,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { SUPPORTED_TARGETS } from "@aphrody/runtime-sdk/src/target.ts";

export const MANIFEST_PATH = "share/vu/manifest.json";
/** The CLI major version of the runtime this consumer understands (`compatibility.cliMajor`). */
export const EXPECTED_CLI_MAJOR = 0;
export const REQUIRED_BINARIES = ["bin/vu", "bin/uv", "bin/ruff"] as const;

export interface VuManifest {
  readonly schema: number;
  readonly name: string;
  readonly version: string;
  readonly target: string;
  readonly toolchain: string;
  readonly revision: string;
  readonly pins: Readonly<Record<string, unknown>>;
  readonly compatibility: { readonly cliMajor: number };
  readonly capabilities: readonly string[];
  readonly files: Readonly<
    Record<
      string,
      {
        readonly sha256: string;
        readonly bytes: number;
        readonly mode?: number;
      }
    >
  >;
  readonly links: Readonly<Record<string, string>>;
}

export type VuState =
  | {
      readonly state: "verified";
      readonly dir: string;
      readonly manifest: VuManifest;
      readonly full: boolean;
    }
  | { readonly state: "absent"; readonly reason: string }
  | {
      readonly state: "invalid";
      readonly dir: string;
      readonly problems: readonly string[];
    };

type Env = Readonly<Record<string, string | undefined>>;

/** The Rust target triple of this host, or null when no runtime is built for it. */
export function hostTarget(
  arch: string = process.arch,
  platform: string = process.platform,
): string | null {
  return SUPPORTED_TARGETS[`${platform}-${arch}`] ?? null;
}

export function vuExecutable(
  name: "vu" | "uv" | "ruff" | "python",
  target: string | null = hostTarget(),
): string {
  const windows = target?.endsWith("-windows-msvc") === true;
  return `bin/${name === "python" && !windows ? "python3" : name}${windows ? ".exe" : ""}`;
}

export function vuHome(
  env: Env = process.env,
  home: string = homedir(),
): string {
  const fromEnv = env["VU_HOME"];
  return fromEnv !== undefined && fromEnv !== ""
    ? resolve(fromEnv)
    : join(home, ".vu");
}

/** The directory the `current` link of this host points to, or null. */
export function activeArtifact(
  env: Env = process.env,
  home: string = homedir(),
): string | null {
  const target = hostTarget();
  if (target === null) return null;
  const link = join(vuHome(env, home), "runtime", target, "current");
  try {
    return realpathSync(link);
  } catch {
    return null;
  }
}

/** Maps with at most `limit` calls in flight: a full check must not open thousands of files at once. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      // The workers are the concurrency: each one runs its items in sequence.
      // eslint-disable-next-line no-await-in-loop
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeManifestPath(path: string): boolean {
  return (
    !/[\\:\0]/.test(path) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function manifestProblem(value: unknown): string | null {
  if (!isRecord(value)) return "the manifest must be an object";
  for (const field of ["name", "version", "target", "toolchain", "revision"]) {
    if (typeof value[field] !== "string" || value[field] === "")
      return `invalid manifest ${field}`;
  }
  if (!/^[a-f0-9]{40}$/.test(value.revision as string))
    return "invalid manifest revision";
  if (!isRecord(value.pins)) return "invalid manifest pins";
  if (
    !isRecord(value.compatibility) ||
    !Number.isSafeInteger(value.compatibility.cliMajor) ||
    (value.compatibility.cliMajor as number) < 0
  )
    return "invalid manifest compatibility";
  if (
    !Array.isArray(value.capabilities) ||
    value.capabilities.some((item) => typeof item !== "string")
  )
    return "invalid manifest capabilities";
  if (!isRecord(value.files) || !isRecord(value.links))
    return "invalid manifest files or links";
  for (const [path, entry] of Object.entries(value.files)) {
    if (!safeManifestPath(path)) return `invalid manifest file path: ${path}`;
    if (
      !isRecord(entry) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      (entry.bytes as number) < 0 ||
      (entry.mode !== undefined &&
        (!Number.isSafeInteger(entry.mode) || (entry.mode as number) < 0))
    )
      return `invalid manifest file entry: ${path}`;
  }
  for (const [path, target] of Object.entries(value.links)) {
    if (
      !safeManifestPath(path) ||
      typeof target !== "string" ||
      target === "" ||
      /[\\:\0]/.test(target) ||
      target.startsWith("/")
    )
      return `invalid manifest link: ${path}`;
    const destination = posix.normalize(
      posix.join(posix.dirname(path), target),
    );
    if (destination === ".." || destination.startsWith("../"))
      return `outside artifact link: ${path}`;
  }
  return null;
}

function readManifest(dir: string): { manifest: VuManifest } | VuState {
  const path = join(dir, MANIFEST_PATH);
  if (!existsSync(path))
    return { state: "absent", reason: `no ${MANIFEST_PATH} in ${dir}` };
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    const problem = manifestProblem(value);
    return problem === null
      ? { manifest: value as VuManifest }
      : { state: "invalid", dir, problems: [problem] };
  } catch (error) {
    return {
      state: "invalid",
      dir,
      problems: [
        `cannot read ${MANIFEST_PATH}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

/**
 * Bytecode caches are derived data: CPython writes them into the runtime when it runs, so the manifest does not list
 * them and a check neither requires nor flags them (the sources and binaries they derive from are checked).
 */
export function isDerivedPath(path: string): boolean {
  return /(^|\/)__pycache__\//.test(path);
}

function listFiles(root: string, directory: string, out: string[]): void {
  const actual = relative(root, realpathSync(directory));
  if (actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual))
    throw new Error("directory is outside artifact");
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (!stat.isSymbolicLink() && stat.isDirectory())
      listFiles(root, path, out);
    else out.push(relative(root, path).split(sep).join("/"));
  }
}

/** Verifies an artifact directory; never throws for a damaged artifact. */
export async function verifyVuArtifact(
  dir: string,
  options: { full?: boolean; target?: string | null } = {},
): Promise<VuState> {
  try {
    return await verifyArtifact(dir, options);
  } catch (error) {
    return {
      state: "invalid",
      dir,
      problems: [
        `cannot verify artifact: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

async function verifyArtifact(
  dir: string,
  options: { full?: boolean; target?: string | null },
): Promise<VuState> {
  const loaded = readManifest(dir);
  if ("state" in loaded) return loaded;
  const manifest = loaded.manifest;
  const problems: string[] = [];
  if (manifest.schema !== 1 || manifest.name !== "vu-runtime")
    problems.push("unsupported manifest schema or name");
  const target = options.target === undefined ? hostTarget() : options.target;
  if (target === null || manifest.target !== target) {
    problems.push(
      `artifact targets ${manifest.target}, this host is ${target ?? "unsupported"}`,
    );
  }
  if (manifest.compatibility?.cliMajor !== EXPECTED_CLI_MAJOR) {
    problems.push(
      `runtime CLI major ${manifest.compatibility?.cliMajor}, this yolo needs ${EXPECTED_CLI_MAJOR}`,
    );
  }
  for (const capability of ["uv", "ruff", "python"]) {
    if (!manifest.capabilities?.includes(capability))
      problems.push(`the manifest lacks the capability ${capability}`);
  }
  const toCheck =
    options.full === true
      ? Object.keys(manifest.files ?? {}).filter((file) => !isDerivedPath(file))
      : [
          vuExecutable("vu", manifest.target),
          vuExecutable("uv", manifest.target),
          vuExecutable("ruff", manifest.target),
        ];
  for (const name of ["vu", "uv", "ruff"] as const) {
    const executable = vuExecutable(name, manifest.target);
    if (!Object.hasOwn(manifest.files, executable))
      problems.push(`not listed: ${executable}`);
  }
  const root = realpathSync(dir);
  const checked = await mapLimit(
    toCheck,
    32,
    async (file): Promise<string | null> => {
      const entry = manifest.files?.[file];
      if (entry === undefined) return `not listed: ${file}`;
      const path = join(dir, file);
      if (!existsSync(path)) return `missing: ${file}`;
      const stat = lstatSync(path);
      if (!stat.isFile()) return `not a regular file: ${file}`;
      const actual = relative(root, realpathSync(path));
      if (
        actual === ".." ||
        actual.startsWith(`..${sep}`) ||
        isAbsolute(actual)
      )
        return `outside artifact: ${file}`;
      if (stat.size !== entry.bytes) return `size: ${file}`;
      const digest = sha256(new Uint8Array(await Bun.file(path).arrayBuffer()));
      return digest === entry.sha256 ? null : `sha256: ${file}`;
    },
  );
  problems.push(
    ...checked.filter((problem): problem is string => problem !== null),
  );
  if (options.full === true) {
    const present: string[] = [];
    listFiles(root, root, present);
    for (const file of present) {
      if (
        file !== MANIFEST_PATH &&
        !isDerivedPath(file) &&
        !Object.hasOwn(manifest.files, file) &&
        !Object.hasOwn(manifest.links, file)
      ) {
        problems.push(`unlisted: ${file}`);
      }
    }
    for (const [link, linkTarget] of Object.entries(manifest.links ?? {})) {
      try {
        const path = join(dir, link);
        if (readlinkSync(path).split(sep).join("/") !== linkTarget)
          problems.push(`link target: ${link}`);
        const actual = relative(root, realpathSync(path));
        if (
          actual === ".." ||
          actual.startsWith(`..${sep}`) ||
          isAbsolute(actual)
        )
          problems.push(`outside artifact link: ${link}`);
      } catch {
        problems.push(`missing link: ${link}`);
      }
    }
  }
  return problems.length > 0
    ? { state: "invalid", dir, problems }
    : { state: "verified", dir, manifest, full: options.full === true };
}

/**
 * The artifact `yolo py` would use: an explicit directory, else the active artifact of `$VU_HOME`. `absent` is the
 * normal state of a host where the runtime is not installed.
 */
export async function resolveVu(
  options: { artifact?: string; env?: Env; home?: string; full?: boolean } = {},
): Promise<VuState> {
  const env = options.env ?? process.env;
  const dir =
    options.artifact !== undefined
      ? resolve(options.artifact)
      : activeArtifact(env, options.home ?? homedir());
  if (dir === null) {
    return {
      state: "absent",
      reason: `no active artifact under ${vuHome(env, options.home ?? homedir())}`,
    };
  }
  return verifyVuArtifact(dir, { full: options.full });
}

/** `PATH` with the artifact's bin/ first, so nested tool invocations find the pinned uv, ruff and python. */
export function pathWithVu(dir: string, existing: string | undefined): string {
  return existing === undefined || existing === ""
    ? join(dir, "bin")
    : `${join(dir, "bin")}${delimiter}${existing}`;
}

/** argv0 names the Python alias of the single `yolo` executable (`vu` or `vu.exe`, any directory). */
export function isVuArgv0(argv0: string): boolean {
  const name = argv0.split(/[\\/]/).pop() ?? argv0;
  return name === "vu" || name === "vu.exe";
}

/**
 * `vu …` and `yolo vu …`: hands the command line to the verified `vu` runtime artifact (`<artifact>/bin/vu`), which
 * owns Python, uv and ruff. The artifact is loaded, never linked into this executable; the dependency is one way
 * (yolo -> vu). Returns the exit code of the artifact, 127 when none is installed, 1 when it fails verification.
 */
export async function runVu(
  args: readonly string[],
  options: { env?: Env; home?: string; artifact?: string } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const state = await resolveVu({
    artifact: options.artifact,
    env,
    home: options.home,
  });
  if (state.state === "absent") {
    console.error(
      `vu: runtime not installed (${state.reason}); set VU_HOME or install the vu artifact`,
    );
    return 127;
  }
  if (state.state === "invalid") {
    console.error(
      `vu: the runtime ${state.dir} failed verification: ${state.problems.slice(0, 3).join("; ")}`,
    );
    return 1;
  }
  const child = Bun.spawn(
    [join(state.dir, vuExecutable("vu", state.manifest.target)), ...args],
    {
      windowsHide: true,
      env: { ...env, PATH: pathWithVu(state.dir, env["PATH"]) },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  return child.exited;
}
