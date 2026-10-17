import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  assertRuntime,
  findModule,
  inspectRuntime,
  listModuleStatus,
  loadConfig,
  repositoryRoot,
  resolveModuleBinary,
  assertRuntimeFacts,
  currentRuntimeFacts,
  hashFile,
  type Config,
  type RuntimePin,
} from "@aphrody/bun-workspace";
import { VideoLibraryError } from "./errors.ts";
import {
  parseNativeJSON,
  stringifyNativeJSON,
  type NativeInteger,
  type NativeJSON,
  type NativeObject,
} from "./json.ts";
import { nativeVideoCapabilities } from "./native.ts";
import { runBounded, type ProcessLimits, type ProcessResult } from "./process.ts";

const buildInstruction = "Build the video engine with bun run workspace build filmcraft";
const maxInputBytes = 16 * 1024 * 1024;
const maxCommands = 10_000;
const nativeFormats = new Set([
  "h264",
  "hevc",
  "prores",
  "dnxhr",
  "apv",
  "mjpeg",
  "mxf-op1a",
  "mxf-opatom",
  "png",
  "tiff",
  "bmp",
  "jpg",
  "tga",
  "dpx",
  "exr",
  "gif",
  "wav",
  "aiff",
  "aac",
  "flac",
]);

export interface VideoLibraryOptions {
  binary?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  dataDir?: string;
  signal?: AbortSignal;
  artifact?: VideoArtifact;
}

/** Verified native payload from the standalone artifact owner. */
export interface VideoArtifact {
  runtime: RuntimePin;
  sourceRevision: string;
  version: "0.7.2";
  sha256: string;
  cwd: string;
}

interface ResolvedOptions extends ProcessLimits {
  binary?: string;
  dataDir: string;
  cwd: string;
}

export interface VideoCommand {
  id: string;
  params?: NativeObject;
}

export interface CommandDescription {
  id: string;
  label: string;
  menu: string[];
  shortcut: string | null;
  shortcuts: string[];
  defaultShortcut: string | null;
  params: string;
  enabled: boolean;
}

export type ProjectInspection = NativeObject & {
  name: string;
  path: string | null;
  dirty: boolean;
  revision: NativeInteger;
  activeSequence: NativeInteger | null;
};

export type SequenceInspection = NativeObject & {
  id: NativeInteger;
  name: string | null;
  settings: NativeObject;
  duration: NativeInteger;
  durationFrames: NativeInteger;
  video: NativeJSON[];
  audio: NativeJSON[];
};

export type CommandOutcome = NativeObject & {
  line: number;
  id: string;
  ok: boolean;
};

export interface RenderOptions {
  output: string;
  seconds: number | string;
  scale?: number;
}

export interface ExportOptions {
  output: string;
  format?: string;
  start?: number | string;
  end?: number | string;
  allowOffline?: boolean;
}

export type ExportReceipt = NativeObject & {
  job: NativeInteger;
  path: string;
  result: NativeObject;
  offlineMedia: NativeJSON[];
};

export interface VideoLibrary {
  commands(filter?: string): Promise<CommandDescription[]>;
  describe(id: string): Promise<CommandDescription>;
  inspect(projectPath: string, kind: "project"): Promise<ProjectInspection>;
  inspect(projectPath: string, kind?: "sequence"): Promise<SequenceInspection>;
  probe(mediaPath: string): Promise<NativeObject>;
  run(projectPath: string, commands: VideoCommand[], options?: { saveAs?: string }): Promise<CommandOutcome[]>;
  render(projectPath: string, options: RenderOptions): Promise<{ output: string }>;
  export(projectPath: string, options: ExportOptions): Promise<ExportReceipt>;
}

function pathArgument(path: string): string {
  if (typeof path !== "string" || !path.trim() || path.length > 32_768 || path.includes("\0")) {
    throw new VideoLibraryError("INVALID_OPTIONS", "A valid file or directory path is required.");
  }
  return resolve(path);
}

function optionsFor(options: VideoLibraryOptions): ResolvedOptions {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new VideoLibraryError("INVALID_OPTIONS", "The video deadline must be between 1 ms and one hour.");
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 64 * 1024 * 1024) {
    throw new VideoLibraryError("INVALID_OPTIONS", "The video output limit must be between 1 byte and 64 MiB.");
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new VideoLibraryError("INVALID_OPTIONS", "signal must be an AbortSignal.");
  }
  return {
    timeoutMs,
    maxOutputBytes,
    signal: options.signal,
    binary: options.binary === undefined ? undefined : pathArgument(options.binary),
    dataDir: pathArgument(
      options.dataDir ?? join(options.artifact?.cwd ?? repositoryRoot, ".local", "video", "presets"),
    ),
    cwd: options.artifact ? pathArgument(options.artifact.cwd) : repositoryRoot,
  };
}

async function rejectProjectOutput(projectPath: string, output: string): Promise<void> {
  const source = pathArgument(projectPath);
  const equal = process.platform === "win32" ? source.toLowerCase() === output.toLowerCase() : source === output;
  if (equal) {
    throw new VideoLibraryError("INVALID_OPTIONS", "Media output must use a separate path from the source project.");
  }
  let sourceFile;
  try {
    sourceFile = await stat(source, { bigint: true });
  } catch {
    throw new VideoLibraryError("INVALID_OPTIONS", "The source project is unavailable.");
  }
  let outputFile;
  try {
    outputFile = await stat(output, { bigint: true });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return;
    throw new VideoLibraryError("INVALID_OPTIONS", "The media destination is unavailable.");
  }
  if (sourceFile.dev === outputFile.dev && sourceFile.ino === outputFile.ino) {
    throw new VideoLibraryError("INVALID_OPTIONS", "Media output must use a separate file from the source project.");
  }
}

function commandId(id: string): string {
  if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new VideoLibraryError("INVALID_OPTIONS", "A native command identifier is required.");
  }
  return id;
}

function secondsArgument(value: string | number): string {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && (value.length > 64 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)))
  ) {
    throw new VideoLibraryError("INVALID_OPTIONS", "Use nonnegative seconds.");
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 10_000_000) {
    throw new VideoLibraryError("INVALID_OPTIONS", "Seconds must be between 0 and 10000000.");
  }
  return seconds.toString();
}

async function sourceConfig(): Promise<Config> {
  let config: Config;
  try {
    config = await loadConfig();
  } catch {
    throw new VideoLibraryError("SOURCE_MISMATCH", "The video workspace configuration is unavailable.");
  }
  try {
    assertRuntime(config);
  } catch {
    throw new VideoLibraryError("RUNTIME_MISMATCH", "Use the pinned Aphrody Bun 1.4.4 runtime.");
  }
  const source = (await listModuleStatus(config)).find(module => module.id === "filmcraft");
  if (!source || source.error || !source.initialized || !source.pointerMatches || !source.revisionMatches) {
    throw new VideoLibraryError("SOURCE_MISMATCH", "The video library differs from its pinned source.");
  }
  return config;
}

async function validatedBinary(path: string, options: ResolvedOptions): Promise<string> {
  const expected = process.platform === "win32" ? "filmcraft-cli.exe" : "filmcraft-cli";
  if (basename(path).toLowerCase() !== expected.toLowerCase()) {
    throw new VideoLibraryError("INVALID_OPTIONS", "Select the native video library CLI artifact.");
  }
  if (!(await Bun.file(path).exists())) throw new VideoLibraryError("ENGINE_MISSING", buildInstruction);
  const version = await runBounded([path, "--version"], options.cwd, {
    timeoutMs: Math.min(options.timeoutMs, 5_000),
    maxOutputBytes: Math.min(options.maxOutputBytes, 4_096),
    signal: options.signal,
  });
  if (version.code !== 0 || version.stdout.trim() !== "filmcraft-cli 0.7.2") {
    throw new VideoLibraryError("SOURCE_MISMATCH", "The native video artifact differs from its pinned version.");
  }
  return path;
}

async function resolveBinary(config: Config, options: ResolvedOptions): Promise<string> {
  const binary = await resolveModuleBinary(config, "filmcraft", {
    binary: options.binary,
    timeoutMs: Math.min(options.timeoutMs, 20_000),
    maxOutputBytes: options.maxOutputBytes,
    signal: options.signal,
  });
  return validatedBinary(binary, options);
}

function nativeResult(result: ProcessResult, failureKind?: "json" | "jsonl" | null): void {
  if (result.code !== 0) {
    let receipt: NativeJSON | undefined;
    if (failureKind && result.stdout.trim()) {
      try {
        receipt =
          failureKind === "json"
            ? parseNativeJSON(result.stdout)
            : result.stdout
                .split(/\r?\n/)
                .filter(line => line.trim())
                .map(line => parseNativeJSON<NativeJSON>(line));
      } catch {
        // Invalid native output does not replace the original failure status.
      }
    }
    throw new VideoLibraryError("NATIVE_FAILED", "The native video operation failed.", result.code, receipt);
  }
}

/** Resolve an existing native artifact. This API never builds or reconstructs project formats. */
export async function createVideoLibrary(options: VideoLibraryOptions = {}): Promise<VideoLibrary> {
  const resolved = optionsFor(options);
  let binary: string;
  try {
    if (options.artifact) {
      const artifact = options.artifact;
      if (
        !resolved.binary ||
        artifact.version !== "0.7.2" ||
        !/^[0-9a-f]{40}$/.test(artifact.sourceRevision) ||
        !/^[0-9a-f]{64}$/.test(artifact.sha256)
      )
        throw new VideoLibraryError("INVALID_OPTIONS", "A verified native video artifact is required.");
      try {
        assertRuntimeFacts(artifact.runtime, currentRuntimeFacts());
      } catch {
        throw new VideoLibraryError("RUNTIME_MISMATCH", "The compiled Aphrody Bun runtime differs from its manifest.");
      }
      if ((await hashFile(resolved.binary)) !== artifact.sha256) {
        throw new VideoLibraryError("SOURCE_MISMATCH", "The native video artifact digest differs from its manifest.");
      }
      binary = await validatedBinary(resolved.binary, resolved);
    } else {
      binary = await resolveBinary(await sourceConfig(), resolved);
    }
  } catch (error) {
    if (error instanceof VideoLibraryError) throw error;
    throw new VideoLibraryError("ENGINE_MISSING", buildInstruction);
  }

  const invoke = async (
    args: string[],
    projectPath?: string,
    input?: Uint8Array,
    saveAs?: string,
    failureKind: "json" | "jsonl" | null = "json",
  ) => {
    try {
      await mkdir(resolved.dataDir, { recursive: true });
    } catch {
      throw new VideoLibraryError("NATIVE_START_FAILED", "The isolated video resource directory is unavailable.");
    }
    const argv = [binary, "--compact", "--data-dir", resolved.dataDir];
    if (projectPath !== undefined) argv.push("--project", pathArgument(projectPath));
    if (saveAs !== undefined) argv.push("--save-as", pathArgument(saveAs));
    const result = await runBounded([...argv, ...args], resolved.cwd, resolved, input);
    nativeResult(result, failureKind);
    return result.stdout;
  };

  const library: VideoLibrary = {
    async commands(filter) {
      if (filter !== undefined && (typeof filter !== "string" || filter.length > 128 || filter.includes("\0"))) {
        throw new VideoLibraryError("INVALID_OPTIONS", "The command filter must be at most 128 characters.");
      }
      const args = ["commands", "--json"];
      if (filter !== undefined) args.push("--", filter);
      return parseNativeJSON<CommandDescription[]>(await invoke(args));
    },
    async describe(id) {
      return parseNativeJSON<CommandDescription>(await invoke(["describe", "--", commandId(id)]));
    },
    async inspect(projectPath: string, kind: "project" | "sequence" = "sequence") {
      if (kind !== "project" && kind !== "sequence") {
        throw new VideoLibraryError("INVALID_OPTIONS", "Inspect project or sequence.");
      }
      return parseNativeJSON(await invoke(["inspect", kind], projectPath)) as ProjectInspection & SequenceInspection;
    },
    async probe(mediaPath) {
      return parseNativeJSON<NativeObject>(await invoke(["probe", "--", pathArgument(mediaPath)]));
    },
    async run(projectPath, commands, runOptions = {}) {
      if (!Array.isArray(commands) || commands.length < 1 || commands.length > maxCommands) {
        throw new VideoLibraryError("INVALID_OPTIONS", "Supply between 1 and 10000 video commands.");
      }
      const encoder = new TextEncoder();
      const lines: string[] = [];
      let inputBytes = 0;
      for (const command of commands) {
        if (!command || typeof command !== "object") {
          throw new VideoLibraryError("INVALID_OPTIONS", "Each video command requires an identifier and parameters.");
        }
        const id = commandId(command.id);
        if (id.startsWith("file.save")) {
          throw new VideoLibraryError("INVALID_OPTIONS", "Persist project edits with the saveAs option.");
        }
        const params = command.params ?? {};
        if (typeof params !== "object" || params === null || Array.isArray(params)) {
          throw new VideoLibraryError("INVALID_OPTIONS", "Command parameters must be a JSON object.");
        }
        const line = `${stringifyNativeJSON({ id, params })}\n`;
        inputBytes += encoder.encode(line).byteLength;
        if (inputBytes > maxInputBytes) {
          throw new VideoLibraryError("INVALID_OPTIONS", "Video commands must fit within 16 MiB.");
        }
        lines.push(line);
      }
      const stdout = await invoke(
        ["run", "-"],
        projectPath,
        encoder.encode(lines.join("")),
        runOptions.saveAs,
        "jsonl",
      );
      return stdout
        .split(/\r?\n/)
        .filter(line => line.trim())
        .map(line => parseNativeJSON<CommandOutcome>(line));
    },
    async render(projectPath, renderOptions) {
      const output = pathArgument(renderOptions.output);
      await rejectProjectOutput(projectPath, output);
      if (!output.toLowerCase().endsWith(".png")) {
        throw new VideoLibraryError("INVALID_OPTIONS", "Render output must be a PNG path.");
      }
      const args = ["render", "--seconds", secondsArgument(renderOptions.seconds), "--out", output];
      if (renderOptions.scale !== undefined) {
        if (!Number.isFinite(renderOptions.scale) || renderOptions.scale <= 0 || renderOptions.scale > 1) {
          throw new VideoLibraryError("INVALID_OPTIONS", "Render scale must be greater than 0 and at most 1.");
        }
        args.push("--scale", renderOptions.scale.toString());
      }
      await invoke(args, projectPath, undefined, undefined, null);
      return { output };
    },
    async export(projectPath, exportOptions) {
      const output = pathArgument(exportOptions.output);
      await rejectProjectOutput(projectPath, output);
      const args = ["export"];
      if (exportOptions.format !== undefined) {
        if (!nativeFormats.has(exportOptions.format)) {
          throw new VideoLibraryError("INVALID_OPTIONS", "Select a supported native export format.");
        }
        args.push("--format", exportOptions.format);
      }
      if (exportOptions.start !== undefined) args.push("--start", secondsArgument(exportOptions.start));
      if (exportOptions.end !== undefined) args.push("--end", secondsArgument(exportOptions.end));
      if (
        exportOptions.start !== undefined &&
        exportOptions.end !== undefined &&
        Number(exportOptions.end) <= Number(exportOptions.start)
      ) {
        throw new VideoLibraryError("INVALID_OPTIONS", "Export end must follow its start.");
      }
      if (exportOptions.allowOffline !== undefined && typeof exportOptions.allowOffline !== "boolean") {
        throw new VideoLibraryError("INVALID_OPTIONS", "allowOffline must be a boolean.");
      }
      if (exportOptions.allowOffline) args.push("--allow-offline");
      args.push("--", output);
      // Native formats derive sibling filenames; a fresh directory protects every destination.
      try {
        await mkdir(dirname(output));
      } catch {
        throw new VideoLibraryError("INVALID_OPTIONS", "Export into a new directory inside an existing parent.");
      }
      return parseNativeJSON<ExportReceipt>(await invoke(args, projectPath));
    },
  };
  return library;
}

/** Report source/runtime pins and artifact discovery without starting a media operation. */
export async function videoLibraryDoctor(options: VideoLibraryOptions = {}) {
  const resolved = optionsFor(options);
  const config = await loadConfig();
  const runtime = inspectRuntime(config);
  const source = (await listModuleStatus(config)).find(module => module.id === "filmcraft");
  let engine: { available: boolean; reason?: string };
  try {
    await resolveBinary(config, resolved);
    engine = { available: true };
  } catch (error) {
    engine = {
      available: false,
      reason: error instanceof VideoLibraryError ? error.code : "ENGINE_MISSING",
    };
  }
  return {
    identity: "Aphrody / Bun",
    runtime: {
      version: runtime.version,
      revision: runtime.revision,
      recognizedFork: runtime.recognizedFork,
      versionMatches: runtime.versionMatches,
      revisionMatches: runtime.revisionMatches,
    },
    source: {
      revision: source?.revision ?? null,
      expectedRevision: findModule(config, "filmcraft").revision,
      initialized: source?.initialized ?? false,
      pointerMatches: source?.pointerMatches ?? false,
      revisionMatches: source?.revisionMatches ?? false,
      modified: source?.clean === false,
    },
    engine,
    nativeVideo: await nativeVideoCapabilities(),
    limits: {
      timeoutMs: resolved.timeoutMs,
      maxOutputBytes: resolved.maxOutputBytes,
    },
  };
}
