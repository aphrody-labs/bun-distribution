/**
 * Artifact verification and the installed-artifact layout:
 *
 *   $YOLO_RUNTIME_HOME (default ~/.yolo/runtime)/<target>/<version>-<hash8>/{library,header,manifest.json}
 *   $YOLO_RUNTIME_HOME/<target>/current    -> active artifact directory
 *   $YOLO_RUNTIME_HOME/<target>/previous   -> artifact active before the last install (rollback)
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Runtime, EXPECTED_ABI_MAJOR, RuntimeError, Status, type LoadOptions } from "./index";
import { SUPPORTED_TARGETS, hostTarget } from "./target";

export { SUPPORTED_TARGETS, hostTarget };

export function runtimeHome(): string {
  const fromEnv = process.env["YOLO_RUNTIME_HOME"];
  if (fromEnv !== undefined && fromEnv !== "") return resolve(fromEnv);
  const home = process.env["YOLO_HOME"];
  if (home !== undefined && home !== "") return join(resolve(home), "runtime");
  return join(homedir(), ".yolo", "runtime");
}

export interface ArtifactManifest {
  readonly schema: number;
  readonly name: string;
  readonly version: string;
  readonly target: string;
  readonly abi: string;
  readonly toolchain?: string;
  readonly compatibility: { readonly abiMajor: number };
  readonly files: Readonly<Record<string, { readonly sha256: string; readonly bytes: number }>>;
  readonly capabilities: readonly string[];
}

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export function libraryFileName(manifest: ArtifactManifest): string {
  const name = Object.keys(manifest.files).find((f) => /\.(so|dylib|dll)$/.test(f));
  if (name === undefined) throw new Error("manifest lists no shared library");
  return name;
}

/**
 * Verifies an artifact directory: manifest schema, target, ABI major and the SHA-256 of every
 * listed file. Throws before any native code is loaded.
 */
export function verifyArtifact(dir: string): ArtifactManifest {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`No manifest.json in ${dir}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ArtifactManifest;
  if (manifest.schema !== 1) throw new Error(`Unsupported manifest schema ${manifest.schema}`);
  if (manifest.compatibility.abiMajor !== EXPECTED_ABI_MAJOR) {
    throw new RuntimeError(
      Status.AbiMismatch,
      `artifact ABI major ${manifest.compatibility.abiMajor}, SDK needs ${EXPECTED_ABI_MAJOR}`,
    );
  }
  if (manifest.target !== hostTarget()) {
    throw new Error(`Artifact targets ${manifest.target}, this host is ${hostTarget()}`);
  }
  for (const [file, expected] of Object.entries(manifest.files)) {
    const path = join(dir, file);
    if (!existsSync(path)) throw new Error(`Artifact file missing: ${file}`);
    const actual = sha256(new Uint8Array(readFileSync(path)));
    if (actual !== expected.sha256) {
      throw new Error(`Hash mismatch for ${file}: expected ${expected.sha256}, got ${actual}`);
    }
  }
  return manifest;
}

/** Loads a verified artifact directory. */
export function loadArtifact(dir: string, options: Omit<LoadOptions, "libraryPath"> = {}): Runtime {
  const manifest = verifyArtifact(dir);
  return Runtime.load({ ...options, libraryPath: join(dir, libraryFileName(manifest)) });
}

/** The active installed artifact directory of this host, if any. */
export function installedArtifactDir(): string | undefined {
  const current = join(runtimeHome(), hostTarget(), "current");
  return existsSync(current) ? current : undefined;
}
