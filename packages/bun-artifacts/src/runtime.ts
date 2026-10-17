import { chmod, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertRuntimeFacts, checkoutPath, currentRuntimeFacts, hashFile } from "@aphrody/bun-workspace";
import { hostMatchesTarget, maxFileBytes, nativeBundleDigest, validateAppManifest } from "./manifest.ts";
import { ArtifactError, type AppManifest, type AppRuntime, type NativeFile } from "./types.ts";

export interface PrepareAppOptions {
  embeddedRoot?: string;
  embeddedFiles?: Readonly<Record<string, string>>;
  cacheRoot?: string;
  appDataDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function absolutePath(path: string): string {
  if (!path || path.includes("\0") || path.length > 32_768 || !isAbsolute(path)) {
    throw new ArtifactError("INVALID_OPTIONS", "Select an absolute artifact directory.");
  }
  return resolve(path);
}

function defaultPaths(appId: string): { cache: string; data: string } {
  if (process.platform === "win32") {
    const local = Bun.env.LOCALAPPDATA;
    if (!local) throw new ArtifactError("INVALID_OPTIONS", "LOCALAPPDATA is required for the application cache.");
    return {
      cache: join(local, "Aphrody", "cache", "artifacts"),
      data: join(local, "Aphrody", "apps", appId),
    };
  }
  const home = homedir();
  if (process.platform === "darwin") {
    return {
      cache: join(home, "Library", "Caches", "Aphrody", "artifacts"),
      data: join(home, "Library", "Application Support", "Aphrody", "apps", appId),
    };
  }
  return {
    cache: join(Bun.env.XDG_CACHE_HOME ?? join(home, ".cache"), "aphrody", "artifacts"),
    data: join(Bun.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "aphrody", "apps", appId),
  };
}

async function privateRoot(path: string): Promise<string> {
  const target = absolutePath(path);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const entry = await lstat(target);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Invalid artifact directory.");
  const actual = await realpath(target);
  if (relative(target, actual) !== "") throw new Error("Artifact directory redirects outside its selected path.");
  return actual;
}

async function directoryWithin(root: string, path: string): Promise<string> {
  if (path === "") return root;
  const target = checkoutPath(root, path);
  const parts = relative(root, target).split(sep);
  let cursor = root;
  for (const part of parts) {
    cursor = join(cursor, part);
    try {
      await mkdir(cursor, { mode: 0o700 });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    const entry = await lstat(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Invalid artifact subdirectory.");
    if (relative(cursor, await realpath(cursor)) !== "") throw new Error("Artifact subdirectory redirects.");
  }
  return target;
}

async function verifyFile(path: string, asset: NativeFile, signal: AbortSignal): Promise<boolean> {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return false;
    throw error;
  }
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size !== asset.size) {
    throw new ArtifactError("INTEGRITY_FAILED", "A cached native payload differs from its manifest.");
  }
  if ((await hashFile(path, { signal, maxBytes: asset.size })) !== asset.sha256) {
    throw new ArtifactError("INTEGRITY_FAILED", "A cached native payload differs from its manifest.");
  }
  return true;
}

async function writePayload(
  source: string,
  temporary: string,
  asset: NativeFile,
  signal: AbortSignal,
  created: () => void,
): Promise<void> {
  const file = Bun.file(source);
  if (file.size !== asset.size)
    throw new ArtifactError("INTEGRITY_FAILED", "An embedded native payload has an invalid size.");
  const handle = await open(temporary, "wx", 0o600);
  created();
  const reader = file.stream().getReader();
  let total = 0;
  let completed = false;
  let rejectRead: ((reason?: unknown) => void) | undefined;
  const interrupt = () => rejectRead?.(signal.reason);
  signal.addEventListener("abort", interrupt, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const interrupted = new Promise<never>((_resolve, reject) => {
        rejectRead = reject;
      });
      const chunk = await Promise.race([reader.read(), interrupted]);
      rejectRead = undefined;
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > asset.size || total > maxFileBytes)
        throw new ArtifactError("INTEGRITY_FAILED", "An embedded payload exceeded its size.");
      let written = 0;
      while (written < chunk.value.byteLength) {
        signal.throwIfAborted();
        const result = await handle.write(chunk.value.subarray(written));
        if (!result.bytesWritten) throw new Error("Native payload write made no progress.");
        written += result.bytesWritten;
      }
    }
    if (total !== asset.size) throw new ArtifactError("INTEGRITY_FAILED", "An embedded native payload is incomplete.");
    await handle.sync();
    completed = true;
  } finally {
    signal.removeEventListener("abort", interrupt);
    if (!completed) void reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      /* An interrupted pending read still owns its reader. */
    }
    await handle.close();
  }
}

async function extractFile(root: string, source: string, asset: NativeFile, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const target = checkoutPath(root, asset.path);
  await directoryWithin(root, relative(root, dirname(target)));
  if (await verifyFile(target, asset, signal)) return target;
  const temporary = checkoutPath(root, `${asset.path}.${crypto.randomUUID()}.partial`);
  let ownsTemporary = false;
  try {
    await writePayload(source, temporary, asset, signal, () => {
      ownsTemporary = true;
    });
    if (!(await verifyFile(temporary, asset, signal))) throw new Error("Native payload missing after extraction.");
    if (process.platform !== "win32") await chmod(temporary, asset.kind === "engine" ? 0o700 : 0o600);
    signal.throwIfAborted();
    if (await verifyFile(target, asset, signal)) return target;
    try {
      await rename(temporary, target);
    } catch (error) {
      // Another application can have completed this exact immutable payload concurrently.
      if (!(await verifyFile(target, asset, signal))) throw error;
    }
    if (!(await verifyFile(target, asset, signal))) throw new Error("Extracted native payload is unavailable.");
    return target;
  } finally {
    // Only this invocation's exclusive staging file is removed.
    if (ownsTemporary) {
      await unlink(temporary).catch(error => {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      });
    }
  }
}

export function assertAppRuntime(value: unknown): AppManifest {
  const manifest = validateAppManifest(value);
  try {
    assertRuntimeFacts(manifest.runtime, currentRuntimeFacts());
  } catch {
    throw new ArtifactError("RUNTIME_MISMATCH", "The application requires its pinned Aphrody Bun runtime.");
  }
  if (!hostMatchesTarget(manifest.target)) {
    throw new ArtifactError("TARGET_MISMATCH", "The application artifact does not match this native host.");
  }
  return manifest;
}

/** No checkout, Git, Cargo, provider stores or implicit network downloads at runtime. */
export async function prepareAppRuntime(value: unknown, options: PrepareAppOptions): Promise<AppRuntime> {
  const manifest = assertAppRuntime(value);
  if (Boolean(options.embeddedRoot) === Boolean(options.embeddedFiles)) {
    throw new ArtifactError("INVALID_OPTIONS", "Supply embedded files or one embedded payload directory.");
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000 ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  ) {
    throw new ArtifactError("INVALID_OPTIONS", "Select a bounded artifact extraction deadline.");
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const timer = setTimeout(interrupt, timeoutMs);
  options.signal?.addEventListener("abort", interrupt, { once: true });
  if (options.signal?.aborted) interrupt();
  const signal = controller.signal;
  const defaults = defaultPaths(manifest.app.id);
  try {
    signal.throwIfAborted();
    const cacheRoot = await privateRoot(options.cacheRoot ?? Bun.env.APHRODY_ARTIFACT_CACHE ?? defaults.cache);
    const appDataDir = await privateRoot(options.appDataDir ?? Bun.env.APHRODY_APP_DATA ?? defaults.data);
    const bundle = await directoryWithin(cacheRoot, `native/${nativeBundleDigest(manifest.native)}`);
    const resources: Record<string, string> = {};
    let next = 0;
    const worker = async () => {
      for (;;) {
        signal.throwIfAborted();
        const asset = manifest.native[next++];
        if (!asset) return;
        const source =
          options.embeddedFiles?.[asset.path] ??
          (options.embeddedRoot ? checkoutPath(options.embeddedRoot, asset.path) : undefined);
        if (!source || typeof source !== "string" || source.includes("\0")) {
          throw new ArtifactError("INTEGRITY_FAILED", "An application payload is unavailable.");
        }
        resources[asset.path] = await extractFile(bundle, source, asset, signal);
      }
    };
    const workers = [worker(), worker()];
    try {
      await Promise.all(workers);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(workers);
      throw error;
    }
    return {
      appId: manifest.app.id,
      libraryId: manifest.app.libraryId,
      target: manifest.target,
      runtime: {
        version: manifest.runtime.version,
        repository: manifest.runtime.repository,
        revision: manifest.runtime.revision,
      },
      nativeBinary: resources[manifest.engine.path]!,
      engine: {
        version: manifest.engine.version,
        sourceRevision: manifest.source.revision,
      },
      resources: Object.freeze(resources),
      cacheRoot,
      appDataDir,
      cwd: appDataDir,
    };
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    if (signal.aborted) throw new ArtifactError("INTERRUPTED", "Application payload extraction was interrupted.");
    throw new ArtifactError("EXTRACTION_FAILED", "Application payload extraction failed.");
  } finally {
    options.signal?.removeEventListener("abort", interrupt);
    clearTimeout(timer);
  }
}

export function artifactDoctor(manifest: AppManifest, runtime: AppRuntime) {
  return {
    identity: manifest.identity,
    app: manifest.app.id,
    target: manifest.target,
    runtime: runtime.runtime,
    engine: {
      available: true,
      version: runtime.engine.version,
      sourceRevision: runtime.engine.sourceRevision,
    },
    embeddedFiles: manifest.native.length,
    nativeBytes: manifest.native.reduce((total, file) => total + file.size, 0),
    sharedAssets: manifest.sharedAssets ?? null,
    qualification: "Payload integrity and runtime identity; native operations require separate qualification.",
  };
}
