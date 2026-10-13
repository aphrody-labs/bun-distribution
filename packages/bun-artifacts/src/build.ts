import { link, lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  appCapabilities,
  appHostname,
  assertRuntimeFacts,
  checkoutPath,
  currentRuntimeFacts,
  findModule,
  hashContent,
  hashFile,
  listModuleStatus,
  loadConfig,
  repositoryRoot,
  resolveCargoModule,
  runProcess,
  type Config,
  type RuntimeFacts,
  type RuntimePin,
} from "@aphrody/bun-workspace";
import {
  hostMatchesTarget,
  isObject,
  maxFileBytes,
  maxNativeBytes,
  parseArtifactTarget,
  validPayloadPath,
  validateAppManifest,
} from "./manifest.ts";
import {
  ArtifactError,
  type AppManifest,
  type ArtifactTarget,
  type NativeArtifactReceipt,
  type NativeFile,
  type NativeFileInput,
  type RuntimeArtifactReceipt,
  type SharedAssetsReference,
} from "./types.ts";

export interface BuildAppOptions {
  appId: string;
  target: ArtifactTarget;
  expectedRuntime: RuntimePin;
  builderRuntime?: RuntimePin;
  bunExecutable: string;
  nativeBinary: string;
  nativeReceipt: NativeArtifactReceipt;
  nativeFiles?: readonly NativeFileInput[];
  engineProtocol?: AppManifest["engine"]["protocol"];
  targetRuntimeReceipt?: RuntimeArtifactReceipt;
  sharedAssets?: SharedAssetsReference;
  root?: string;
  output?: string;
  entrypoint?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BuiltAppArtifact {
  appId: string;
  target: ArtifactTarget;
  path: string;
  sha256: string;
  size: number;
  manifestPath: string;
  manifestSha256: string;
  manifest: AppManifest;
  qualification: "built";
}

/** Source planning does not start Cargo or manufacture unavailable engine backends. */
export function planAppArtifacts(config: Config) {
  return appCapabilities(config).map(app => {
    const module = findModule(config, app.libraryId);
    return {
      ...app,
      hostname: appHostname(app.id, config),
      sourceRevision: module.revision,
      binary: module.binary ?? null,
      availability: module.binary ? "native-artifact-required" : "native-owner-unavailable",
      buildCommand: module.binary ? `bun run workspace build ${module.id}` : null,
    };
  });
}

function qualification(value: RuntimeArtifactReceipt["qualification"]): void {
  if (
    !isObject(value) ||
    typeof value.host !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(value.host) ||
    !["native", "ssh", "docker"].includes(value.mode) ||
    !Number.isFinite(Date.parse(value.observedAt))
  ) {
    throw new ArtifactError("INVALID_OPTIONS", "A native target qualification receipt is required.");
  }
}

async function inputFile(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0"))
    throw new ArtifactError("INVALID_OPTIONS", "Select an absolute native artifact file.");
  const resolved = resolve(path);
  const entry = await lstat(resolved);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > maxFileBytes) {
    throw new ArtifactError("INVALID_OPTIONS", "Select a bounded regular native artifact file.");
  }
  return realpath(resolved);
}

async function targetRuntime(options: BuildAppOptions, config: Config, root: string): Promise<AppManifest["runtime"]> {
  const path = await inputFile(options.bunExecutable);
  const sha256 = await hashFile(path, { signal: options.signal, maxBytes: 200 * 1024 * 1024 });
  let facts: RuntimeFacts;
  if (hostMatchesTarget(options.target)) {
    const probe = await runProcess(
      [
        path,
        "--no-env-file",
        "-e",
        "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,sourceUrl:process.release.sourceUrl??null,standalone:Bun.isStandaloneExecutable}))",
      ],
      root,
      {
        timeoutMs: 5_000,
        maxOutputBytes: 4096,
        signal: options.signal,
        stderr: "discard",
        env: { ...Bun.env, BUN_BE_BUN: undefined },
      },
    );
    const value: unknown = probe.code === 0 ? JSON.parse(probe.stdout.trim()) : undefined;
    if (
      !isObject(value) ||
      value.standalone !== false ||
      typeof value.version !== "string" ||
      typeof value.revision !== "string" ||
      typeof value.sourceUrl !== "string"
    ) {
      throw new ArtifactError("RUNTIME_MISMATCH", "The selected native Bun executable could not prove its provenance.");
    }
    facts = { version: value.version, revision: value.revision, sourceUrl: value.sourceUrl, executable: path };
  } else {
    const receipt = options.targetRuntimeReceipt;
    if (!receipt || receipt.target !== options.target || receipt.sha256 !== sha256) {
      throw new ArtifactError("TARGET_MISMATCH", "Supply the verified Aphrody Bun receipt for this target.");
    }
    qualification(receipt.qualification);
    facts = receipt.facts;
  }
  const verified = assertRuntimeFacts(options.expectedRuntime, facts);
  if (config.runtime.version !== verified.version || !verified.sourceUrl) {
    throw new ArtifactError("RUNTIME_MISMATCH", "The target runtime requires Aphrody Bun 1.4.4.");
  }
  return { ...options.expectedRuntime, sha256, sourceUrl: verified.sourceUrl };
}

function importPath(path: string): string {
  return JSON.stringify(path.replaceAll("\\", "/"));
}

function launcher(manifest: AppManifest, sources: ReadonlyMap<string, string>, entrypoint: string): string {
  const runtime = join(import.meta.dir, "runtime.ts");
  const lines = [
    `import { assertAppRuntime, prepareAppRuntime, artifactDoctor } from ${importPath(runtime)};`,
    `import { startApp } from ${importPath(entrypoint)};`,
  ];
  const map: string[] = [];
  let index = 0;
  for (const [path, source] of sources) {
    lines.push(`import payload${index} from ${importPath(source)} with { type: "file" };`);
    map.push(`${JSON.stringify(path)}: payload${index++}`);
  }
  lines.push(`const manifest = assertAppRuntime(${JSON.stringify(manifest)});`);
  lines.push('if (process.argv[2] === "--version") {');
  lines.push("  console.log(`Aphrody ${manifest.app.title} / Bun ${manifest.runtime.version}`);");
  lines.push("} else {");
  lines.push(`  const runtime = await prepareAppRuntime(manifest, { embeddedFiles: {${map.join(",")}} });`);
  lines.push('  if (process.argv[2] === "--doctor") console.log(JSON.stringify(artifactDoctor(manifest, runtime)));');
  lines.push("  else await startApp(manifest, runtime);");
  lines.push("}");
  return lines.join("\n");
}

/** Build only from supplied, pinned native artifacts; the existing workspace owns Cargo. */
async function buildArtifact(options: BuildAppOptions): Promise<BuiltAppArtifact> {
  const root = resolve(options.root ?? repositoryRoot);
  const config = await loadConfig(root);
  assertRuntimeFacts(options.builderRuntime ?? options.expectedRuntime, currentRuntimeFacts());
  const target = parseArtifactTarget(options.target);
  const app = appCapabilities(config).find(entry => entry.id === options.appId);
  if (!app) throw new ArtifactError("INVALID_OPTIONS", "Select a configured application capability.");
  const module = findModule(config, app.libraryId);
  if (!module.binary)
    throw new ArtifactError("OWNER_UNAVAILABLE", "This application has no existing native engine CLI.");
  const source = (await listModuleStatus(config, root)).find(entry => entry.id === module.id);
  if (
    !source ||
    source.error ||
    !source.initialized ||
    !source.revisionMatches ||
    !source.pointerMatches ||
    source.clean !== true
  ) {
    throw new ArtifactError("SOURCE_MISMATCH", "The application source must match its clean pinned library.");
  }
  await resolveCargoModule(module, root);
  const nativeBinary = await inputFile(options.nativeBinary);
  const filename = module.binary + (target.startsWith("bun-windows-") ? ".exe" : "");
  if (basename(nativeBinary) !== filename)
    throw new ArtifactError("INVALID_OPTIONS", "Select the existing headless engine artifact.");
  const nativeHash = await hashFile(nativeBinary, { signal: options.signal, maxBytes: maxFileBytes });
  const receipt = options.nativeReceipt;
  if (
    !receipt ||
    receipt.target !== target ||
    receipt.sourceRevision !== module.revision ||
    receipt.sha256 !== nativeHash
  ) {
    throw new ArtifactError("INTEGRITY_FAILED", "The native engine differs from its target/source receipt.");
  }
  qualification(receipt.qualification);
  const runtime = await targetRuntime(options, config, root);
  const sources = new Map<string, string>([[`native/${filename}`, nativeBinary]]);
  const native: NativeFile[] = [
    { path: `native/${filename}`, sha256: nativeHash, size: Bun.file(nativeBinary).size, kind: "engine" },
  ];
  if (options.nativeFiles !== undefined && !Array.isArray(options.nativeFiles)) {
    throw new ArtifactError("INVALID_OPTIONS", "Native resources must be an explicit file list.");
  }
  const inputs: NativeFileInput[] = [...(options.nativeFiles ?? [])];
  for (const name of ["LICENSE-MIT", "LICENSE-APACHE", "NOTICE", "ATTRIBUTION.md"]) {
    const path = checkoutPath(checkoutPath(root, module.path), name);
    if (await Bun.file(path).exists()) inputs.push({ source: path, path: `notices/engine/${name}`, kind: "notice" });
  }
  if (!config.desktop.source) throw new ArtifactError("SOURCE_MISMATCH", "The pinned Bun source license is required.");
  const sdkLicense = checkoutPath(checkoutPath(root, config.desktop.source.path), "LICENSE.md");
  if (await Bun.file(sdkLicense).exists())
    inputs.push({ source: sdkLicense, path: "notices/bun/LICENSE.md", kind: "notice" });
  if (inputs.length > 63)
    throw new ArtifactError("INVALID_OPTIONS", "An application supports at most 64 embedded native files.");
  let nativeBytes = native[0]!.size;
  const names = new Set(native.map(file => file.path.toLowerCase()));
  for (const input of inputs) {
    if (!input || !validPayloadPath(input.path) || !["library", "resource", "notice"].includes(input.kind)) {
      throw new ArtifactError("INVALID_OPTIONS", "Select portable native resource paths and kinds.");
    }
    const name = input.path.toLowerCase();
    if (names.has(name)) throw new ArtifactError("INVALID_OPTIONS", "Embedded payload paths must be unique.");
    names.add(name);
    const path = await inputFile(input.source);
    nativeBytes += Bun.file(path).size;
    if (nativeBytes > maxNativeBytes) {
      throw new ArtifactError("INVALID_OPTIONS", "Native resources exceed the application size limit.");
    }
    sources.set(input.path, path);
    native.push({
      path: input.path,
      kind: input.kind,
      size: Bun.file(path).size,
      sha256: await hashFile(path, { signal: options.signal, maxBytes: maxFileBytes }),
    });
  }
  const manifest = validateAppManifest({
    schemaVersion: 1,
    identity: "Aphrody / Bun",
    app,
    hostname: appHostname(app.id, config),
    target,
    runtime,
    source: { revision: module.revision, license: module.license, upstream: module.upstream, fork: module.fork },
    engine: {
      path: `native/${filename}`,
      version: receipt.version,
      protocol: options.engineProtocol ?? module.protocol ?? "cli",
    },
    native,
    ...(options.sharedAssets ? { sharedAssets: options.sharedAssets } : {}),
  });
  const output = options.output
    ? resolve(root, options.output)
    : join(root, "build/apps", app.id, target, `aphrody-${app.id}${target.startsWith("bun-windows-") ? ".exe" : ""}`);
  const entrypoint = options.entrypoint
    ? resolve(root, options.entrypoint)
    : checkoutPath(root, "packages/bun-app-host/src/server.ts");
  if (!(await Bun.file(entrypoint).exists()))
    throw new ArtifactError("OWNER_UNAVAILABLE", "The application server owner is unavailable.");
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new ArtifactError("INVALID_OPTIONS", "Select a compilation deadline up to ten minutes.");
  }
  await mkdir(dirname(output), { recursive: true });
  for (const path of [output, `${output}.manifest.json`]) {
    let present = false;
    try {
      await lstat(path);
      present = true;
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
    if (present) throw new ArtifactError("INVALID_OPTIONS", "Select a fresh artifact output path.");
  }
  const lockPath = `${output}.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  const stage = join(root, "build/staging/artifacts", crypto.randomUUID());
  const entry = join(stage, "entry.ts");
  const plan = join(stage, "compile.json");
  const stagedOutput = `${output}.${crypto.randomUUID()}.partial${target.startsWith("bun-windows-") ? ".exe" : ""}`;
  const stagedManifest = `${stagedOutput}.manifest.json`;
  let published = false;
  let publishedManifest = false;
  let completed = false;
  try {
    await mkdir(stage, { recursive: true });
    await Bun.write(entry, launcher(manifest, sources, entrypoint));
    await Bun.write(
      plan,
      JSON.stringify({ entry, output: stagedOutput, target, executablePath: await inputFile(options.bunExecutable) }),
    );
    const result = await runProcess(
      [process.execPath, "--no-env-file", join(import.meta.dir, "compile.ts"), plan],
      root,
      {
        timeoutMs,
        maxOutputBytes: 1024 * 1024,
        signal: options.signal,
        stderr: "discard",
        env: { ...Bun.env, BUN_BE_BUN: undefined },
      },
    );
    if (result.code !== 0 || !(await Bun.file(stagedOutput).exists()))
      throw new ArtifactError("BUILD_FAILED", "The Bun application compilation failed.");
    // Native owner outputs can be replaced by another build while compilation runs.
    for (const file of native) {
      if ((await hashFile(sources.get(file.path)!, { signal: options.signal, maxBytes: file.size })) !== file.sha256) {
        throw new ArtifactError("INTEGRITY_FAILED", "A native input changed during compilation.");
      }
    }
    if (
      (await hashFile(options.bunExecutable, { signal: options.signal, maxBytes: 200 * 1024 * 1024 })) !==
      runtime.sha256
    ) {
      throw new ArtifactError("INTEGRITY_FAILED", "The target Bun executable changed during compilation.");
    }
    const manifestPath = `${output}.manifest.json`;
    const body = JSON.stringify(manifest, null, 2) + "\n";
    const size = Bun.file(stagedOutput).size;
    const sha256 = await hashFile(stagedOutput, { signal: options.signal, maxBytes: 2 * maxFileBytes });
    await Bun.write(stagedManifest, body);
    options.signal?.throwIfAborted();
    // Same-directory links publish complete bytes atomically and refuse replacement.
    await link(stagedOutput, output);
    published = true;
    await link(stagedManifest, manifestPath);
    publishedManifest = true;
    completed = true;
    return {
      appId: app.id,
      target,
      path: output,
      size,
      sha256,
      manifestPath,
      manifestSha256: hashContent(body),
      manifest,
      qualification: "built",
    };
  } finally {
    await Promise.all([entry, plan, stagedOutput, stagedManifest].map(path => unlink(path).catch(() => {})));
    await rmdir(stage).catch(() => {});
    if (!completed && published) await unlink(output).catch(() => {});
    if (!completed && publishedManifest) await unlink(`${output}.manifest.json`).catch(() => {});
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

export async function buildAppArtifact(options: BuildAppOptions): Promise<BuiltAppArtifact> {
  try {
    return await buildArtifact(options);
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    if (options.signal?.aborted) throw new ArtifactError("INTERRUPTED", "Application compilation was interrupted.");
    throw new ArtifactError("BUILD_FAILED", "The application artifact could not be built.");
  }
}
