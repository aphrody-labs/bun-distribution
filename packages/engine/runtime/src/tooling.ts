// SPDX-License-Identifier: MIT
import { FFIType, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { nativeLibrary, readNativeString, toCString, type NativeLibrary } from "./ffi.ts";
import { defaultLibraryPath } from "./index.ts";
import type { Finding, N2BReport } from "./tooling-schema.ts";

export type NodeProjectFinding = Finding;
export type NodeProjectReport = N2BReport & { $schema: string };
export interface ScanNodeProjectOptions {
  mode?: "check" | "fix" | "aggressive";
  ignore?: string[];
  dry_run?: boolean;
  /** Native file workers, bounded to 1..6. */
  jobs?: number;
}

export interface ModuleAnalysis {
  imports: string[];
  exports: string[];
  hasModuleSyntax: boolean;
  spanEncoding: "utf16";
  requests: {
    specifier: string;
    start: number;
    end: number;
    typeOnly: boolean;
    isImport: boolean;
  }[];
  exportEntries: { name: string; start: number; end: number; typeOnly: boolean }[];
}

const SYMBOLS = {
  yolo_tooling_abi_version: { args: [], returns: FFIType.u32 },
  node2bun_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_oxc_abi_version: { args: [], returns: FFIType.u32 },
  node2bun_scan_json: { args: [FFIType.ptr], returns: FFIType.ptr },
  node2bun_scan_with_options_json: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  node2bun_string_free: { args: [FFIType.ptr], returns: FFIType.void },
  find_newlines_u16: {
    args: [FFIType.ptr, "usize", FFIType.ptr, "usize"],
    returns: "usize",
  },
  aphrody_oxc_format: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_oxc_minify: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_oxc_lint: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_oxc_analyze: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_oxc_parse: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_oxc_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;
type Library = NativeLibrary<typeof SYMBOLS>;
type Symbols = NonNullable<ReturnType<Library["load"]>>;

export interface NativeToolingOptions {
  /** Explicit precompiled provider. It never silently falls back to another library. */
  path?: string;
}
export interface NativeToolingProbe {
  available: boolean;
  closed: boolean;
  libraryPath: string | null;
  error: string | null;
  abi?: { tooling: 1; n2b: 2; oxc: 1 };
}

function cString(value: string, name: string): Uint8Array {
  if (typeof value !== "string" || value.includes("\0"))
    throw new TypeError(`${name} must be a string without NUL bytes`);
  return toCString(value);
}

function optionsJson(options: ScanNodeProjectOptions): Uint8Array {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("N2B options must be an object");
  for (const key of Object.keys(options)) {
    if (!["mode", "ignore", "dry_run", "jobs"].includes(key))
      throw new TypeError(`Unknown N2B option: ${key}`);
  }
  if (options.mode !== undefined && !["check", "fix", "aggressive"].includes(options.mode))
    throw new TypeError("N2B mode must be check, fix or aggressive");
  if (
    options.ignore !== undefined &&
    (!Array.isArray(options.ignore) || !options.ignore.every((entry) => typeof entry === "string"))
  )
    throw new TypeError("N2B ignore must be an array of strings");
  if (options.dry_run !== undefined && typeof options.dry_run !== "boolean")
    throw new TypeError("N2B dry_run must be a boolean");
  if (
    options.jobs !== undefined &&
    (!Number.isInteger(options.jobs) || options.jobs < 1 || options.jobs > 6)
  )
    throw new TypeError("N2B jobs must be an integer between 1 and 6");
  return cString(JSON.stringify(options), "N2B options");
}

function envelope(
  pointer: Pointer | bigint | null,
  free: (pointer: Pointer) => void,
  name: string,
): Record<string, unknown> {
  if (!pointer) throw new Error(`${name} returned a null pointer`);
  let value: unknown;
  try {
    value = JSON.parse(readNativeString(pointer, (address) => free(address as Pointer)));
  } catch (cause) {
    throw new Error(`${name}: invalid native JSON`, { cause });
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name}: invalid native response`);
  const result = value as Record<string, unknown>;
  if (result.ok !== true) {
    const message = `${name}: ${typeof result.error === "string" ? result.error : "native operation failed"}`;
    if (result.kind === "syntax") throw new SyntaxError(message);
    throw new Error(message);
  }
  return result;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** One lazy provider owner. All native operations finish before close can unload its handle. */
export class NativeTooling {
  readonly #options: NativeToolingOptions;
  #library: Library | undefined;
  #validated = false;
  #closed = false;
  #failure: string | null = null;

  constructor(options: NativeToolingOptions = {}) {
    if (options.path !== undefined) {
      cString(options.path, "Native tooling path");
      if (!options.path) throw new TypeError("Native tooling path must not be empty");
    }
    this.#options = { ...options };
  }

  #symbols(): Symbols {
    if (this.#closed) throw new Error(this.#failure ?? "Native tooling is closed");
    if (!this.#library) {
      let path = this.#options.path ?? process.env.YOLO_TOOLING_LIB;
      if (path !== undefined) {
        cString(path, "Native tooling path");
        if (!path || !existsSync(path))
          throw new Error("Selected native tooling library is missing; selection preserved");
      } else {
        const selected = defaultLibraryPath();
        if (existsSync(selected)) path = selected;
        else if (process.env.YOLO_RUNTIME_LIB)
          throw new Error("Selected native runtime library is missing; selection preserved");
      }
      this.#library = nativeLibrary({
        name: "aphrody_ffi",
        symbols: SYMBOLS,
        ...(path === undefined ? {} : { path }),
        searchDirs: [
          resolve(homedir(), ".yolo/runtime"),
          resolve(homedir(), ".local/lib"),
          resolve(process.cwd(), "target/release"),
          resolve(process.cwd(), "target/debug"),
          resolve(homedir(), "yolo/target/release"),
          resolve(homedir(), "yolo/target/debug"),
          resolve(homedir(), "aphrody/target/release"),
          resolve(homedir(), "aphrody/target/debug"),
        ],
        buildHint:
          "Install the qualified aphrody_ffi library (feature `tooling`) or select YOLO_TOOLING_LIB.",
      });
    }
    const symbols = this.#library.load();
    if (!symbols) throw new Error(this.#library.loadError() ?? "Native tooling unavailable");
    if (!this.#validated) {
      const actual = {
        tooling: symbols.yolo_tooling_abi_version(),
        n2b: symbols.node2bun_abi_version(),
        oxc: symbols.aphrody_oxc_abi_version(),
      };
      if (actual.tooling !== 1 || actual.n2b !== 2 || actual.oxc !== 1) {
        this.#failure = `Native tooling ABI mismatch: ${JSON.stringify(actual)}`;
        this.close();
        throw new Error(this.#failure);
      }
      this.#validated = true;
    }
    return symbols;
  }

  probe(): NativeToolingProbe {
    try {
      this.#symbols();
      return {
        available: true,
        closed: false,
        libraryPath: this.#library!.libraryPath(),
        error: null,
        abi: { tooling: 1, n2b: 2, oxc: 1 },
      };
    } catch (error) {
      return {
        available: false,
        closed: this.#closed,
        libraryPath: this.#library?.libraryPath() ?? null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  #oxc(
    operation: "format" | "minify" | "lint" | "analyze" | "parse",
    source: string,
    filename: string,
  ) {
    const input = cString(source, "Oxc source");
    const path = cString(filename, "Oxc filename");
    const symbols = this.#symbols();
    return envelope(
      symbols[`aphrody_oxc_${operation}`](input, path),
      symbols.aphrody_oxc_free,
      operation === "analyze" || operation === "parse"
        ? `Cannot parse ${filename}`
        : `Oxc ${operation}`,
    );
  }

  formatSource(source: string, filename = "input.js"): string {
    const result = this.#oxc("format", source, filename);
    if (typeof result.code !== "string") throw new Error("Oxc format: missing native code");
    return result.code;
  }

  minifySource(source: string, filename = "input.js"): string {
    const result = this.#oxc("minify", source, filename);
    if (typeof result.code !== "string") throw new Error("Oxc minify: missing native code");
    return result.code;
  }

  lintSource(source: string, filename = "input.js"): string[] {
    const result = this.#oxc("lint", source, filename);
    if (!strings(result.diagnostics)) throw new Error("Oxc lint: invalid native diagnostics");
    return result.diagnostics;
  }

  analyzeModule(source: string, filename = "input.js"): ModuleAnalysis {
    const value = this.#oxc("analyze", source, filename).result;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Oxc analyze: invalid native result");
    const analysis = value as Record<string, unknown>;
    if (
      !strings(analysis.imports) ||
      !strings(analysis.exports) ||
      typeof analysis.hasModuleSyntax !== "boolean" ||
      analysis.spanEncoding !== "utf16" ||
      !Array.isArray(analysis.requests) ||
      !Array.isArray(analysis.exportEntries)
    )
      throw new Error("Oxc analyze: invalid native module schema");
    return analysis as unknown as ModuleAnalysis;
  }

  /** Official ESTree JSON; generic typing does not change the native representation. */
  parseProgram<T = unknown>(source: string, filename = "input.js"): T {
    const value = this.#oxc("parse", source, filename).result;
    if (
      !value ||
      typeof value !== "object" ||
      (value as Record<string, unknown>).type !== "Program" ||
      !Array.isArray((value as Record<string, unknown>).body)
    )
      throw new Error("Oxc parse: invalid native ESTree program");
    return value as T;
  }

  scanNodeProject(root: string, options?: ScanNodeProjectOptions): NodeProjectReport {
    const input = cString(root, "N2B project root");
    const encoded = options === undefined ? undefined : optionsJson(options);
    const symbols = this.#symbols();
    const result = envelope(
      encoded === undefined
        ? symbols.node2bun_scan_json(input)
        : symbols.node2bun_scan_with_options_json(input, encoded),
      symbols.node2bun_string_free,
      "N2B scan",
    );
    const report = result.report as NodeProjectReport | undefined;
    if (!report || report.schema_version !== 2 || !Array.isArray(report.files))
      throw new Error("N2B scan: invalid native report schema");
    return report;
  }

  findNewlinesUtf16(source: string): Uint32Array {
    if (this.#closed) throw new Error(this.#failure ?? "Native tooling is closed");
    if (typeof source !== "string") throw new TypeError("Newline source must be a string");
    if (source.length === 0) return new Uint32Array();
    const bytes = new Uint8Array(source.length * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < source.length; index++)
      view.setUint16(index * 2, source.charCodeAt(index), true);
    const symbols = this.#symbols();
    const count = Number(symbols.find_newlines_u16(bytes, bytes.length, null, 0));
    if (!Number.isSafeInteger(count) || count < 0 || count > source.length)
      throw new Error("N2B newline count is invalid");
    const offsets = new Uint32Array(count);
    if (count && Number(symbols.find_newlines_u16(bytes, bytes.length, offsets, count)) !== count)
      throw new Error("N2B newline count changed");
    return offsets;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#library?.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

const KEY = Symbol.for("yolo.tooling.native.v1");
const shared = globalThis as typeof globalThis & { [KEY]?: NativeTooling };
function sharedTooling(): NativeTooling {
  if (!shared[KEY]) {
    shared[KEY] = new NativeTooling();
    process.once("exit", () => shared[KEY]?.close());
  }
  return shared[KEY];
}

export const scanNodeProject = (
  root: string,
  options?: ScanNodeProjectOptions,
): NodeProjectReport => sharedTooling().scanNodeProject(root, options);
export const formatSource = (source: string, filename?: string): string =>
  sharedTooling().formatSource(source, filename);
export const minifySource = (source: string, filename?: string): string =>
  sharedTooling().minifySource(source, filename);
export const lintSource = (source: string, filename?: string): string[] =>
  sharedTooling().lintSource(source, filename);
export const analyzeModule = (source: string, filename?: string): ModuleAnalysis =>
  sharedTooling().analyzeModule(source, filename);
export const parseProgram = <T = unknown>(source: string, filename?: string): T =>
  sharedTooling().parseProgram<T>(source, filename);
export const findNewlinesUtf16 = (source: string): Uint32Array =>
  sharedTooling().findNewlinesUtf16(source);
export const probeNativeTooling = (): NativeToolingProbe => sharedTooling().probe();
export const closeNativeTooling = (): void => sharedTooling().close();
