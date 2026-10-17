import { appCapabilityFor, hashContent, isObject, runtimeFromFacts } from "@aphrody/bun-workspace";
import { validateAssetReference } from "@aphrody/bun-workspace/assets";
import { ArtifactError, type AppManifest, type ArtifactTarget, type NativeFile } from "./types.ts";

export const maxNativeFiles = 64;
export const maxFileBytes = 1024 * 1024 * 1024;
export const maxNativeBytes = 2 * maxFileBytes;
const sha256Pattern = /^[0-9a-f]{64}$/;
const revisionPattern = /^[0-9a-f]{40}$/;

function invalid(): never {
  throw new ArtifactError("INVALID_MANIFEST", "The application artifact manifest is invalid.");
}

export { isObject } from "@aphrody/bun-workspace";

export function validDigest(value: unknown): value is string {
  return typeof value === "string" && sha256Pattern.test(value);
}

/** Portable relative file names, including on a different build host. */
export function validPayloadPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  const parts = value.split("/");
  return (
    parts.length <= 16 &&
    parts.every(
      part =>
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part) &&
        !part.endsWith(".") &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  );
}

export function parseArtifactTarget(value: string): ArtifactTarget {
  if (!/^bun-(?:(?:windows|darwin)-(?:x64|arm64)|linux-(?:x64|arm64)(?:-musl)?)$/.test(value)) {
    throw new ArtifactError("INVALID_OPTIONS", "Select a supported Bun application target.");
  }
  return value as ArtifactTarget;
}

export function hostMatchesTarget(target: ArtifactTarget): boolean {
  const [, os, arch, libc] = target.split("-");
  const platform = os === "windows" ? "win32" : os;
  if (process.platform !== platform || process.arch !== arch) return false;
  if (platform !== "linux") return true;
  // ELF architecture alone cannot distinguish glibc and musl.
  const report = process.report.getReport() as {
    header?: { glibcVersionRuntime?: string };
  };
  return Boolean(report.header?.glibcVersionRuntime) === (libc !== "musl");
}

/** Structural validation delegates identity and runtime provenance to their existing owners. */
export function validateAppManifest(value: unknown): AppManifest {
  if (!isObject(value) || value.schemaVersion !== 1 || value.identity !== "Aphrody / Bun") invalid();
  if (!isObject(value.app) || typeof value.app.id !== "string") invalid();
  const app = value.app;
  const capability = appCapabilityFor(app.id as string);
  if (!capability || Object.entries(capability).some(([key, entry]) => app[key] !== entry)) invalid();
  if (
    typeof value.hostname !== "string" ||
    value.hostname.length > 253 ||
    !value.hostname.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
  )
    invalid();
  if (typeof value.target !== "string") invalid();
  const target = parseArtifactTarget(value.target);
  if (!isObject(value.runtime) || !validDigest(value.runtime.sha256)) invalid();
  const runtime = value.runtime;
  if (
    typeof runtime.version !== "string" ||
    typeof runtime.repository !== "string" ||
    typeof runtime.revision !== "string" ||
    typeof runtime.sourceUrl !== "string"
  )
    invalid();
  try {
    if (
      !runtimeFromFacts(
        {
          version: runtime.version,
          repository: runtime.repository,
          revision: runtime.revision,
        },
        {
          version: runtime.version,
          revision: runtime.revision,
          sourceUrl: runtime.sourceUrl,
          executable: "",
        },
      ).recognizedFork
    )
      invalid();
  } catch {
    invalid();
  }
  if (
    !isObject(value.source) ||
    typeof value.source.revision !== "string" ||
    !revisionPattern.test(value.source.revision) ||
    typeof value.source.license !== "string" ||
    !value.source.license ||
    value.source.license.length > 128 ||
    value.source.upstream !== `storytold/${capability.libraryId}` ||
    value.source.fork !== `aphrody-labs/${capability.libraryId}`
  )
    invalid();
  if (
    !isObject(value.engine) ||
    !validPayloadPath(value.engine.path) ||
    typeof value.engine.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(value.engine.version) ||
    value.engine.version.length > 64 ||
    !["cli", "cli-json", "jsonl", "mcp-stdio"].includes(String(value.engine.protocol))
  )
    invalid();
  if (!Array.isArray(value.native) || value.native.length < 1 || value.native.length > maxNativeFiles) invalid();
  const paths = new Set<string>();
  let bytes = 0;
  let engines = 0;
  for (const asset of value.native) {
    if (
      !isObject(asset) ||
      !validPayloadPath(asset.path) ||
      !validDigest(asset.sha256) ||
      typeof asset.size !== "number" ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      asset.size > maxFileBytes ||
      !["engine", "library", "resource", "notice"].includes(String(asset.kind))
    )
      invalid();
    const key = asset.path.toLowerCase();
    if (paths.has(key)) invalid();
    paths.add(key);
    bytes += asset.size;
    if (bytes > maxNativeBytes) invalid();
    if (asset.kind === "engine") {
      engines++;
      if (asset.path !== value.engine.path) invalid();
      const name = target.startsWith("bun-windows-")
        ? `${capability.libraryId}-cli.exe`
        : `${capability.libraryId}-cli`;
      if (asset.path !== `native/${name}`) invalid();
    }
  }
  if (engines !== 1) invalid();
  if (value.sharedAssets !== undefined) {
    try {
      validateAssetReference(value.sharedAssets);
    } catch {
      invalid();
    }
  }
  const manifest = value as unknown as AppManifest;
  // Keep only artifact fields, including when a caller supplied additional metadata.
  return {
    schemaVersion: 1,
    identity: "Aphrody / Bun",
    app: capability,
    hostname: manifest.hostname,
    target,
    runtime: {
      version: manifest.runtime.version,
      repository: manifest.runtime.repository,
      revision: manifest.runtime.revision,
      sha256: manifest.runtime.sha256,
      sourceUrl: manifest.runtime.sourceUrl,
    },
    source: {
      revision: manifest.source.revision,
      license: manifest.source.license,
      upstream: manifest.source.upstream,
      fork: manifest.source.fork,
    },
    engine: {
      path: manifest.engine.path,
      version: manifest.engine.version,
      protocol: manifest.engine.protocol,
    },
    native: manifest.native.map(({ path, sha256, size, kind }) => ({
      path,
      sha256,
      size,
      kind,
    })),
    ...(manifest.sharedAssets ? { sharedAssets: validateAssetReference(manifest.sharedAssets) } : {}),
  };
}

export function nativeBundleDigest(files: readonly NativeFile[]): string {
  return hashContent(
    JSON.stringify(
      files.map(({ path, sha256, size, kind }) => ({
        path,
        sha256,
        size,
        kind,
      })),
    ),
  );
}
