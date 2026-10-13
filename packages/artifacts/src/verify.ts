import { lstat, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { hashContent, hashFile, isObject, runProcess, type RuntimePin } from "@aphrody/bun-workspace";
import { validateAssetReference } from "@aphrody/bun-workspace/assets";
import { hostMatchesTarget, validDigest, validateAppManifest } from "./manifest.ts";
import { ArtifactError, type AppManifest, type ArtifactTarget, type SharedAssetsReference } from "./types.ts";

const maxMetadataBytes = 1024 * 1024;
const maxExecutableBytes = 2 * 1024 * 1024 * 1024;

export interface VerifyAppArtifactOptions {
  appId: string;
  /** Recheck caller-owned staging bytes against the unchanged build receipt. */
  binary?: string;
  manifestPath?: string;
  /** Metadata verification alone does not qualify service activation. */
  execute?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface VerifiedAppArtifact {
  schemaVersion: 1;
  identity: "Aphrody / Bun";
  appId: string;
  libraryId: string;
  hostname: string;
  target: ArtifactTarget;
  binary: string;
  sha256: string;
  size: number;
  manifestPath: string;
  manifestSha256: string;
  sourceRevision: string;
  runtime: RuntimePin;
  engine: AppManifest["engine"];
  sharedAssets?: SharedAssetsReference;
  qualification: "metadata" | "native-doctor";
  observedAt: string;
}

function invalid(): never {
  throw new ArtifactError("VERIFICATION_FAILED", "The application build receipt does not match its artifact.");
}

function matchesRuntime(value: unknown, expected: RuntimePin): boolean {
  return (
    isObject(value) &&
    value.version === expected.version &&
    value.repository === expected.repository &&
    value.revision === expected.revision
  );
}

function matchesAssets(value: unknown, expected: SharedAssetsReference | undefined): boolean {
  if (value === undefined || value === null) return expected === undefined;
  try {
    const reference = validateAssetReference(value);
    return reference.sha256 === expected?.sha256 && reference.url === expected.url;
  } catch {
    return false;
  }
}

async function regularFile(path: unknown, maximum: number): Promise<{ path: string; size: number }> {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) invalid();
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum) invalid();
  return { path: await realpath(path), size: metadata.size };
}

async function metadataBytes(path: string, signal: AbortSignal): Promise<Uint8Array> {
  const reader = Bun.file(path).stream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const interrupt = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", interrupt, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > maxMetadataBytes) invalid();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", interrupt);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Verify one successful result without requiring unrelated applications to have built. */
export async function verifyAppArtifact(
  report: unknown,
  options: VerifyAppArtifactOptions,
): Promise<VerifiedAppArtifact> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (
    typeof options.appId !== "string" ||
    !options.appId ||
    options.appId.length > 128 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000 ||
    (options.execute !== undefined && typeof options.execute !== "boolean") ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  ) {
    throw new ArtifactError("INVALID_OPTIONS", "Select an application and a bounded verification deadline.");
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const timer = setTimeout(interrupt, timeoutMs);
  options.signal?.addEventListener("abort", interrupt, { once: true });
  if (options.signal?.aborted) interrupt();
  const signal = controller.signal;
  try {
    signal.throwIfAborted();
    if (
      !isObject(report) ||
      report.schemaVersion !== 1 ||
      report.identity !== "Aphrody / Bun" ||
      report.action !== "build" ||
      !Array.isArray(report.results) ||
      report.results.length > 14
    )
      invalid();
    const selected = report.results.filter(result => isObject(result) && result.appId === options.appId);
    if (selected.length !== 1) invalid();
    const result = selected[0];
    if (
      !isObject(result) ||
      result.status !== "built" ||
      result.stage !== "extract" ||
      result.extraction !== "qualified" ||
      !isObject(result.artifact) ||
      !isObject(result.nativeReceipt)
    )
      invalid();
    const artifact = result.artifact;
    const manifest = validateAppManifest(artifact.manifest);
    const engine = manifest.native.find(file => file.kind === "engine")!;
    const native = result.nativeReceipt;
    if (
      artifact.qualification !== "built" ||
      artifact.appId !== options.appId ||
      manifest.app.id !== options.appId ||
      artifact.target !== manifest.target ||
      report.target !== manifest.target ||
      result.libraryId !== manifest.app.libraryId ||
      result.hostname !== manifest.hostname ||
      result.protocol !== manifest.engine.protocol ||
      result.sourceRevision !== manifest.source.revision ||
      native.target !== manifest.target ||
      native.sourceRevision !== manifest.source.revision ||
      native.sha256 !== engine.sha256 ||
      native.version !== manifest.engine.version ||
      !matchesRuntime(report.expectedRuntime, manifest.runtime) ||
      !matchesAssets(report.sharedAssets, manifest.sharedAssets) ||
      !validDigest(artifact.sha256) ||
      !validDigest(artifact.manifestSha256) ||
      typeof artifact.size !== "number" ||
      !Number.isSafeInteger(artifact.size)
    )
      invalid();
    if (report.runtimeReceipt !== undefined) {
      const runtime = report.runtimeReceipt;
      if (
        !isObject(runtime) ||
        runtime.target !== manifest.target ||
        runtime.sha256 !== manifest.runtime.sha256 ||
        !isObject(runtime.facts) ||
        runtime.facts.version !== manifest.runtime.version ||
        runtime.facts.revision !== manifest.runtime.revision ||
        runtime.facts.sourceUrl !== manifest.runtime.sourceUrl
      )
        invalid();
    }
    if (typeof artifact.path !== "string" || typeof artifact.manifestPath !== "string") invalid();
    const binary = await regularFile(options.binary ?? artifact.path, maxExecutableBytes);
    const sidecar = await regularFile(options.manifestPath ?? artifact.manifestPath, maxMetadataBytes);
    if (binary.size !== artifact.size) invalid();
    const bytes = await metadataBytes(sidecar.path, signal);
    if (hashContent(bytes) !== artifact.manifestSha256) invalid();
    const saved = validateAppManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (JSON.stringify(saved) !== JSON.stringify(manifest)) invalid();
    if ((await hashFile(binary.path, { signal, maxBytes: artifact.size })) !== artifact.sha256) invalid();
    const execute = options.execute !== false;
    if (execute) {
      if (!hostMatchesTarget(manifest.target)) {
        throw new ArtifactError("TARGET_MISMATCH", "Native verification requires the application's target host.");
      }
      // Discovery receives platform paths only, never injected provider credentials.
      const env: Record<string, string | undefined> = {};
      for (const key of [
        "PATH",
        "HOME",
        "USERPROFILE",
        "LOCALAPPDATA",
        "APPDATA",
        "TEMP",
        "TMP",
        "TMPDIR",
        "SystemRoot",
        "WINDIR",
        "APHRODY_ARTIFACT_CACHE",
        "APHRODY_APP_DATA",
      ])
        env[key] = Bun.env[key];
      const processResult = await runProcess([binary.path, "--doctor"], process.cwd(), {
        timeoutMs,
        maxOutputBytes: 256 * 1024,
        signal,
        stderr: "discard",
        env,
      });
      if (processResult.code !== 0) invalid();
      const doctor: unknown = JSON.parse(processResult.stdout.trim());
      if (
        !isObject(doctor) ||
        doctor.identity !== manifest.identity ||
        doctor.app !== manifest.app.id ||
        doctor.target !== manifest.target ||
        !matchesRuntime(doctor.runtime, manifest.runtime) ||
        !isObject(doctor.engine) ||
        doctor.engine.available !== true ||
        doctor.engine.version !== manifest.engine.version ||
        doctor.engine.sourceRevision !== manifest.source.revision ||
        doctor.embeddedFiles !== manifest.native.length ||
        doctor.nativeBytes !== manifest.native.reduce((total, file) => total + file.size, 0) ||
        !matchesAssets(doctor.sharedAssets, manifest.sharedAssets)
      )
        invalid();
      if ((await hashFile(binary.path, { signal, maxBytes: artifact.size })) !== artifact.sha256) invalid();
      if ((await hashFile(sidecar.path, { signal, maxBytes: maxMetadataBytes })) !== artifact.manifestSha256) invalid();
    }
    signal.throwIfAborted();
    return {
      schemaVersion: 1,
      identity: manifest.identity,
      appId: manifest.app.id,
      libraryId: manifest.app.libraryId,
      hostname: manifest.hostname,
      target: manifest.target,
      binary: binary.path,
      sha256: artifact.sha256,
      size: binary.size,
      manifestPath: sidecar.path,
      manifestSha256: artifact.manifestSha256,
      sourceRevision: manifest.source.revision,
      runtime: {
        version: manifest.runtime.version,
        repository: manifest.runtime.repository,
        revision: manifest.runtime.revision,
      },
      engine: manifest.engine,
      ...(manifest.sharedAssets ? { sharedAssets: manifest.sharedAssets } : {}),
      qualification: execute ? "native-doctor" : "metadata",
      observedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    if (signal.aborted) throw new ArtifactError("INTERRUPTED", "Application artifact verification was interrupted.");
    throw new ArtifactError("VERIFICATION_FAILED", "Application artifact verification failed.");
  } finally {
    options.signal?.removeEventListener("abort", interrupt);
    clearTimeout(timer);
  }
}
