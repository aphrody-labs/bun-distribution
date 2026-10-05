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
import { join, relative, resolve } from "node:path";

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
    Record<string, { readonly sha256: string; readonly bytes: number; readonly mode?: number }>
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
  | { readonly state: "invalid"; readonly dir: string; readonly problems: readonly string[] };

type Env = Readonly<Record<string, string | undefined>>;

/** The Rust target triple of this host, or null when no runtime is built for it. */
export function hostTarget(
  arch: string = process.arch,
  platform: string = process.platform,
): string | null {
  if (platform !== "linux") return null;
  if (arch === "x64") return "x86_64-unknown-linux-gnu";
  if (arch === "arm64") return "aarch64-unknown-linux-gnu";
  return null;
}

export function vuHome(env: Env = process.env, home: string = homedir()): string {
  const fromEnv = env["VU_HOME"];
  return fromEnv !== undefined && fromEnv !== "" ? resolve(fromEnv) : join(home, ".vu");
}

/** The directory the `current` link of this host points to, or null. */
export function activeArtifact(env: Env = process.env, home: string = homedir()): string | null {
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function readManifest(dir: string): VuManifest | string {
  const path = join(dir, MANIFEST_PATH);
  if (!existsSync(path)) return `no ${MANIFEST_PATH} in ${dir}`;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as VuManifest;
  } catch (error) {
    return `${MANIFEST_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
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
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) listFiles(root, path, out);
    else if (entry.isFile()) out.push(relative(root, path));
  }
}

/** Verifies an artifact directory; never throws for a damaged artifact. */
export async function verifyVuArtifact(
  dir: string,
  options: { full?: boolean; target?: string | null } = {},
): Promise<VuState> {
  const manifest = readManifest(dir);
  if (typeof manifest === "string") return { state: "absent", reason: manifest };
  const problems: string[] = [];
  if (manifest.schema !== 1 || manifest.name !== "vu-runtime")
    problems.push("unsupported manifest schema or name");
  const target = options.target === undefined ? hostTarget() : options.target;
  if (target === null || manifest.target !== target) {
    problems.push(`artifact targets ${manifest.target}, this host is ${target ?? "unsupported"}`);
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
      : [...REQUIRED_BINARIES];
  const checked = await mapLimit(toCheck, 32, async (file): Promise<string | null> => {
    const entry = manifest.files?.[file];
    if (entry === undefined) return `not listed: ${file}`;
    const path = join(dir, file);
    if (!existsSync(path)) return `missing: ${file}`;
    if (lstatSync(path).size !== entry.bytes) return `size: ${file}`;
    const digest = sha256(new Uint8Array(await Bun.file(path).arrayBuffer()));
    return digest === entry.sha256 ? null : `sha256: ${file}`;
  });
  problems.push(...checked.filter((problem): problem is string => problem !== null));
  if (options.full === true) {
    const present: string[] = [];
    listFiles(dir, dir, present);
    for (const file of present) {
      if (file !== MANIFEST_PATH && !isDerivedPath(file) && !(file in manifest.files)) {
        problems.push(`unlisted: ${file}`);
      }
    }
    for (const [link, linkTarget] of Object.entries(manifest.links ?? {})) {
      try {
        if (readlinkSync(join(dir, link)) !== linkTarget) problems.push(`link target: ${link}`);
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
    : `${join(dir, "bin")}:${existing}`;
}
