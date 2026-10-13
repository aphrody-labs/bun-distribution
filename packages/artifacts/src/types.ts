import type { AppCapability, RuntimeFacts, RuntimePin } from "@aphrody/bun-workspace";
import type { AssetReference } from "@aphrody/bun-workspace/assets";

export type ArtifactTarget =
  | "bun-windows-x64"
  | "bun-windows-arm64"
  | "bun-linux-x64"
  | "bun-linux-arm64"
  | "bun-linux-x64-musl"
  | "bun-linux-arm64-musl"
  | "bun-darwin-x64"
  | "bun-darwin-arm64";

export interface NativeFile {
  path: string;
  sha256: string;
  size: number;
  kind: "engine" | "library" | "resource" | "notice";
}

export type SharedAssetsReference = AssetReference;

/** A build manifest records supplied native payloads; release qualification is separate. */
export interface AppManifest {
  schemaVersion: 1;
  identity: "Aphrody / Bun";
  app: AppCapability;
  hostname: string;
  target: ArtifactTarget;
  runtime: RuntimePin & { sha256: string; sourceUrl: string };
  source: { revision: string; license: string; upstream: string; fork: string };
  engine: { path: string; version: string; protocol: "cli" | "cli-json" | "jsonl" | "mcp-stdio" };
  native: NativeFile[];
  sharedAssets?: SharedAssetsReference;
}

export interface RuntimeArtifactReceipt {
  target: ArtifactTarget;
  sha256: string;
  facts: RuntimeFacts;
  qualification: { host: string; mode: "native" | "ssh" | "docker"; observedAt: string };
}

export interface NativeArtifactReceipt {
  target: ArtifactTarget;
  sourceRevision: string;
  sha256: string;
  version: string;
  qualification: { host: string; mode: "native" | "ssh" | "docker"; observedAt: string };
}

export interface NativeFileInput {
  source: string;
  path: string;
  kind: "library" | "resource" | "notice";
}

export interface AppRuntime {
  appId: string;
  libraryId: string;
  target: ArtifactTarget;
  runtime: RuntimePin;
  nativeBinary: string;
  engine: { version: string; sourceRevision: string };
  resources: Readonly<Record<string, string>>;
  cacheRoot: string;
  appDataDir: string;
  cwd: string;
}

export type ArtifactErrorCode =
  | "INVALID_MANIFEST"
  | "INVALID_OPTIONS"
  | "RUNTIME_MISMATCH"
  | "TARGET_MISMATCH"
  | "OWNER_UNAVAILABLE"
  | "SOURCE_MISMATCH"
  | "INTEGRITY_FAILED"
  | "EXTRACTION_FAILED"
  | "INTERRUPTED"
  | "BUILD_FAILED";

export class ArtifactError extends Error {
  constructor(
    readonly code: ArtifactErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}
