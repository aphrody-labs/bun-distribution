// SPDX-License-Identifier: MIT AND Apache-2.0
/**
 * Bun-native entry point for the configured Craft engine libraries.
 *
 * This package resolves the existing engine owners and preserves their CLI contracts. It does not
 * translate commands into a shared wire format: `cli`, `cli-json`, `jsonl`, and `mcp-stdio` remain
 * distinct owner protocols. Callers pass the arguments documented by that engine's CLI and receive
 * bounded process output.
 */
import { resolve } from "node:path";
import { appCapabilities, type AppCapability } from "./capabilities.ts";
import {
  findModule,
  repositoryRoot,
  resolveModuleBinary,
  type Config,
  type Module,
} from "./index.ts";
import { ProcessError, runProcess, type ProcessErrorCode, type ProcessResult } from "./process.ts";

export type CraftProtocol = "cli" | "cli-json" | "jsonl" | "mcp-stdio";

export interface CraftLibrary {
  /** Engine/library ID from aphrody.config.json. */
  id: string;
  /** Common product identity and capability from the canonical catalog. */
  capability: AppCapability;
  /** Original module descriptor; source pins and protocol stay owned by the config. */
  module: Module;
  protocol: CraftProtocol;
  binary: string;
}

export type CraftLibraryErrorCode =
  | "UNKNOWN_CAPABILITY"
  | "INVALID_ENGINE_CONFIG"
  | "BINARY_UNAVAILABLE"
  | ProcessErrorCode;

export class CraftLibraryError extends Error {
  constructor(
    readonly code: CraftLibraryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CraftLibraryError";
  }
}

export interface CraftResolutionOptions {
  /** Workspace checkout that owns aphrody.config.json and its native artifacts. */
  root?: string;
  /** Explicit already-qualified CLI path, useful to an embedding Bun application. */
  binary?: string;
}

export interface CraftRunOptions extends CraftResolutionOptions {
  /** Defaults to two minutes; maximum is twelve hours for long exports. */
  timeoutMs?: number;
  /** Defaults to 8 MiB; maximum is 64 MiB per captured process output. */
  maxOutputBytes?: number;
  signal?: AbortSignal;
  input?: Uint8Array;
  env?: Record<string, string | undefined>;
}

const protocols = new Set<CraftProtocol>(["cli", "cli-json", "jsonl", "mcp-stdio"]);
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 43_200_000;
const DEFAULT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function configuredCapabilities(config: Config): AppCapability[] {
  if (!config || typeof config !== "object" || !Array.isArray(config.modules)) {
    throw new CraftLibraryError("INVALID_ENGINE_CONFIG", "A loaded Aphrody configuration with a modules list is required.");
  }
  try {
    return appCapabilities(config);
  } catch (cause) {
    throw new CraftLibraryError("INVALID_ENGINE_CONFIG", "Aphrody engine modules do not match the common Craft capability catalog.", {
      cause,
    });
  }
}

function capabilityForLibrary(config: Config, id: string): AppCapability {
  const capability = configuredCapabilities(config).find(entry => entry.libraryId === id);
  if (!capability) throw new CraftLibraryError("UNKNOWN_CAPABILITY", `No Craft product capability is configured for ${id}.`);
  return capability;
}

function configuredEngine(config: Config, id: string): { capability: AppCapability; module: Module; protocol: CraftProtocol } {
  const capability = capabilityForLibrary(config, id);
  let module: Module;
  try {
    module = findModule(config, id);
  } catch (cause) {
    throw new CraftLibraryError("INVALID_ENGINE_CONFIG", `Craft capability ${id} has no configured module.`, { cause });
  }
  if (
    module.role !== "engine" ||
    module.kind !== "library" ||
    module.binary !== `${id}-cli` ||
    !module.protocol ||
    !protocols.has(module.protocol as CraftProtocol)
  ) {
    throw new CraftLibraryError(
      "INVALID_ENGINE_CONFIG",
      `Craft capability ${id} must declare its engine role, ${id}-cli binary, and a supported owner protocol.`,
    );
  }
  return { capability, module, protocol: module.protocol as CraftProtocol };
}

/** Product-visible Craft engines selected by the canonical Aphrody module configuration. */
export function listCraftLibraries(config: Config): Array<Omit<CraftLibrary, "binary">> {
  return configuredCapabilities(config).map(capability => {
    const engine = configuredEngine(config, capability.libraryId);
    return { id: engine.module.id, capability: engine.capability, module: engine.module, protocol: engine.protocol };
  });
}

/** Resolve an engine's configured module, capability, protocol, and existing CLI artifact. */
export async function resolveCraftLibrary(
  config: Config,
  id: string,
  options: CraftResolutionOptions = {},
): Promise<CraftLibrary> {
  const engine = configuredEngine(config, id);
  const root = resolve(options.root ?? repositoryRoot);
  try {
    const binary = await resolveModuleBinary(config, id, { root, binary: options.binary });
    return { id, ...engine, binary };
  } catch (cause) {
    throw new CraftLibraryError("BINARY_UNAVAILABLE", `The configured ${id} CLI is not available; build or provide its existing engine owner.`, { cause });
  }
}

/**
 * Run an engine's own headless CLI without changing its arguments or protocol. For example, use
 * FilmCraft's documented `exec` syntax, PhotoCraft's `serve` JSON-lines service, or VectorCraft's
 * `run` syntax exactly as that library owner documents it.
 */
export async function runCraftLibrary(
  config: Config,
  id: string,
  args: string[],
  options: CraftRunOptions = {},
): Promise<ProcessResult & { library: CraftLibrary }> {
  const library = await resolveCraftLibrary(config, id, options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
    throw new CraftLibraryError("INVALID_OPTIONS", "Craft CLI timeout must be between 1 ms and 12 hours.");
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_OUTPUT_BYTES)
    throw new CraftLibraryError("INVALID_OPTIONS", "Craft CLI output limit must be between 1 byte and 64 MiB.");
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string" || arg.includes("\0")))
    throw new CraftLibraryError("INVALID_OPTIONS", "Craft CLI arguments must be NUL-free strings.");
  const cwd = resolve(options.root ?? repositoryRoot, library.module.path);
  try {
    const result = await runProcess([library.binary, ...args], cwd, {
      timeoutMs,
      maxOutputBytes,
      signal: options.signal,
      input: options.input,
      env: options.env,
    });
    return { ...result, library };
  } catch (cause) {
    if (cause instanceof ProcessError)
      throw new CraftLibraryError(cause.code, `${id}: ${cause.message}`, { cause });
    throw cause;
  }
}
