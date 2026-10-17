// SPDX-License-Identifier: Apache-2.0
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const NATIVE_ABI_VERSIONS = {
  aphrody_abi_version: 1,
  aphrody_web_bridge_abi_version: 5,
  bun_rs_abi_version: 1,
  node2bun_abi_version: 2,
  aphrody_oxc_abi_version: 1,
} as const;

export interface NativeArtifactManifest {
  schemaVersion: 1;
  package: "@aphrody/bun";
  crate: "aphrody-ffi";
  version: string | null;
  packageVersion: string;
  target: string;
  libc: "gnu" | "musl" | null;
  profile: "debug" | "release";
  features: string[] | null;
  artifact: string;
  sha256: string;
  bytes: number;
  abi: typeof NATIVE_ABI_VERSIONS;
  provenance: "cargo-build" | "existing-debug";
  buildSourceHead: string | null;
  observedSourceHead: string;
  observedSourceDirty: boolean;
  cargoLockSha256: string;
  rustc: string;
  consumerSmoke: "pending" | "passed";
}

export function nativeHostTriple(): string | undefined {
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : undefined;
  if (!arch) return undefined;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "linux") {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    return `${arch}-unknown-linux-${report?.header?.glibcVersionRuntime ? "gnu" : "musl"}`;
  }
  return undefined;
}

export function nativeTargetLibc(target: string): "gnu" | "musl" | null {
  if (target.endsWith("-linux-gnu")) return "gnu";
  if (target.endsWith("-linux-musl")) return "musl";
  return null;
}

export function nativeDevelopmentEnabled(): boolean {
  return process.env.APHRODY_FFI_DEV === "1";
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export function parseNativeArtifactManifest(
  value: unknown,
  artifact: string,
  packageVersion: string,
  target: string,
  development = nativeDevelopmentEnabled(),
): NativeArtifactManifest {
  const fail = (reason: string): never => {
    throw new Error(`Invalid native manifest for ${artifact}: ${reason}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object");
  const data = value as Record<string, unknown>;
  if (data.schemaVersion !== 1 || data.package !== "@aphrody/bun" || data.crate !== "aphrody-ffi")
    fail("unsupported artifact contract");
  if (data.packageVersion !== packageVersion) fail("package version mismatch");
  if (data.target !== target || data.libc !== nativeTargetLibc(target)) fail("host triple/libc mismatch");
  if (data.artifact !== basename(artifact)) fail("artifact filename mismatch");
  if (typeof data.sha256 !== "string" || !SHA256.test(data.sha256)) fail("invalid SHA-256");
  if (typeof data.bytes !== "number" || !Number.isSafeInteger(data.bytes) || data.bytes <= 0)
    fail("invalid artifact size");
  if (data.profile !== "debug" && data.profile !== "release") fail("invalid build profile");
  if (data.provenance !== "cargo-build" && data.provenance !== "existing-debug") fail("invalid build provenance");
  if (data.provenance === "existing-debug" && data.profile !== "debug")
    fail("existing artifacts are restricted to debug development");
  const unknownBuild = data.provenance === "existing-debug";
  if (typeof data.version !== "string" && !(unknownBuild && data.version === null)) fail("invalid crate version");
  if (
    !(Array.isArray(data.features) && data.features.every(feature => typeof feature === "string")) &&
    !(unknownBuild && data.features === null)
  )
    fail("invalid build features");
  if (!data.abi || typeof data.abi !== "object" || Array.isArray(data.abi)) fail("missing ABI versions");
  const abi = data.abi as Record<string, unknown>;
  for (const [symbol, expected] of Object.entries(NATIVE_ABI_VERSIONS)) {
    if (abi[symbol] !== expected) fail(`${symbol} ABI mismatch`);
  }
  if (
    data.buildSourceHead !== null &&
    (typeof data.buildSourceHead !== "string" || !GIT_SHA.test(data.buildSourceHead))
  )
    fail("invalid build source revision");
  if (
    typeof data.observedSourceHead !== "string" ||
    !GIT_SHA.test(data.observedSourceHead) ||
    typeof data.observedSourceDirty !== "boolean"
  )
    fail("invalid observed source revision");
  if (
    typeof data.cargoLockSha256 !== "string" ||
    !SHA256.test(data.cargoLockSha256) ||
    typeof data.rustc !== "string" ||
    !data.rustc.trim()
  )
    fail("missing build toolchain/lock provenance");
  if (data.consumerSmoke !== "passed" && !(development && data.consumerSmoke === "pending"))
    fail("consumer smoke has not passed");
  if (
    !development &&
    (data.profile !== "release" ||
      data.buildSourceHead === null ||
      data.observedSourceDirty ||
      data.buildSourceHead !== data.observedSourceHead)
  )
    fail("a clean release is required; use APHRODY_FFI_DEV=1 for development artifacts");
  return data as unknown as NativeArtifactManifest;
}

/** Hash large debug libraries without allocating a buffer the size of the artifact. */
export function hashNativeArtifact(path: string): {
  sha256: string;
  bytes: number;
} {
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error(`Native artifact is not a regular file: ${path}`);
    const hash = new Bun.CryptoHasher("sha256");
    const chunk = new Uint8Array(1024 * 1024);
    let bytes = 0;
    let count: number;
    while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, count));
      bytes += count;
    }
    const after = fstatSync(fd);
    const named = statSync(path);
    if (
      bytes !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      named.dev !== after.dev ||
      named.ino !== after.ino
    )
      throw new Error(`Native artifact changed during verification: ${path}`);
    return { sha256: hash.digest("hex"), bytes };
  } finally {
    closeSync(fd);
  }
}

/** Overrides without manifests remain available only in explicit development mode. */
export function verifyNativeArtifact(path: string, packageVersion: string): NativeArtifactManifest | undefined {
  const manifestPath = join(dirname(path), "manifest.json");
  if (!existsSync(manifestPath)) {
    if (nativeDevelopmentEnabled()) return undefined;
    throw new Error(`Native manifest missing at ${manifestPath}; use APHRODY_FFI_DEV=1 for development artifacts`);
  }
  const target = nativeHostTriple();
  if (!target) throw new Error(`Unsupported native host: ${process.platform}/${process.arch}`);
  const manifest = parseNativeArtifactManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    path,
    packageVersion,
    target,
  );
  const actual = hashNativeArtifact(path);
  if (actual.bytes !== manifest.bytes || actual.sha256 !== manifest.sha256)
    throw new Error(`Native artifact hash/size mismatch at ${path}`);
  return manifest;
}
