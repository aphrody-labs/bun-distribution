// SPDX-License-Identifier: Apache-2.0
//
// Bun `bun:ffi` binding for the aphrody native library (crate `aphrody-ffi`).
//
// Loads the cdylib and exposes the full aphrody command surface in-process:
//
//   import { run, runCaptured, version } from "./index.ts";
//   const r = runCaptured(["doctor", "--json"]);   // { code, stdout, stderr }
//   console.log(JSON.parse(r.stdout));
//
// Set APHRODY_FFI_LIB to override the library path; otherwise it is resolved
// from target/{release,debug}/ relative to this file.

import { CString, dlopen, FFIType, suffix, type Pointer } from "bun:ffi";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** ABI version this binding is written against. */
export const EXPECTED_ABI_VERSION = 1;

const ENCODER = new TextEncoder();

/**
 * Encode a JS string as a NUL-terminated UTF-8 buffer for a `cstring` argument.
 * Bun does not auto-marshal a JS string into a pointer for FFI args, so we hand
 * it a `Uint8Array` (Bun passes its pointer, pinned for the synchronous call).
 */
function cstr(text: string): Uint8Array {
  return ENCODER.encode(`${text}\0`);
}

function resolveLibPath(): string {
  const override = process.env.APHRODY_FFI_LIB;
  if (override && existsSync(override)) return override;

  // On Windows the cdylib is `aphrody_ffi.dll`; elsewhere `libaphrody_ffi.{so,dylib}`.
  const prefix = process.platform === "win32" ? "" : "lib";
  const fileName = `${prefix}aphrody_ffi.${suffix}`;

  const here = dirname(fileURLToPath(import.meta.url));
  // crates/aphrody-ffi/bun -> repo root is three levels up.
  const targetDir = join(here, "..", "..", "..", "target");

  const candidates: string[] = [];
  for (const profile of ["release", "debug"]) {
    candidates.push(join(targetDir, profile, fileName));
  }
  // Also probe target/<triple>/{release,debug}/ — present when .cargo/config
  // pins a default --target (aphrody defaults to x86_64-pc-windows-msvc).
  try {
    for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const profile of ["release", "debug"]) {
        candidates.push(join(targetDir, entry.name, profile, fileName));
      }
    }
  } catch {
    // target/ may not exist yet; fall through to the bare name.
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Last resort: let the dynamic loader search the default paths.
  return fileName;
}

const lib = dlopen(resolveLibPath(), {
  aphrody_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_version: { args: [], returns: FFIType.cstring },
  aphrody_run_json: { args: [FFIType.cstring], returns: FFIType.i32 },
  aphrody_run_captured: { args: [FFIType.cstring], returns: FFIType.ptr },
  aphrody_string_free: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_last_error: { args: [], returns: FFIType.ptr },
  aphrody_web_extract_main: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_html_to_markdown: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_simhash64: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_index_last_error: { args: [], returns: FFIType.ptr },
  aphrody_web_index_open: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.i32], returns: FFIType.u64_fast },
  aphrody_web_index_len: { args: [FFIType.u64], returns: FFIType.i64_fast },
  aphrody_web_index_dim: { args: [FFIType.u64], returns: FFIType.u32 },
  aphrody_web_index_add: { args: [FFIType.u64, FFIType.u64, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  aphrody_web_index_add_batch: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
  aphrody_web_index_search: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32], returns: FFIType.ptr },
  aphrody_web_index_remove: { args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 },
  aphrody_web_index_save: { args: [FFIType.u64], returns: FFIType.i32 },
  aphrody_web_index_compact: { args: [FFIType.u64], returns: FFIType.i32 },
  aphrody_web_index_stats: { args: [FFIType.u64], returns: FFIType.ptr },
  aphrody_web_index_close: { args: [FFIType.u64], returns: FFIType.i32 },
});

function readOwnedString(ptr: bigint | Pointer | null): string {
  if (!ptr) throw new Error("aphrody-ffi returned a null string");
  try {
    return new CString(ptr).toString();
  } finally {
    lib.symbols.aphrody_string_free(ptr);
  }
}

/** Extract structured page content through the shared Rust extractor. */
export function webExtractMain(html: string, url?: string, options: Record<string, unknown> = {}): Record<string, unknown> {
  const result = readOwnedString(lib.symbols.aphrody_web_extract_main(
    cstr(html),
    url === undefined ? null : cstr(url),
    cstr(JSON.stringify(options)),
  ));
  return JSON.parse(result) as Record<string, unknown>;
}

/** Convert HTML with the same native library used by the Aphrody CLI. */
export function webHtmlToMarkdown(html: string, baseUrl?: string): string {
  return readOwnedString(lib.symbols.aphrody_web_html_to_markdown(
    cstr(html),
    baseUrl === undefined ? null : cstr(baseUrl),
  ));
}

/** Return the 64-bit SimHash as a sixteen-character lowercase hex string. */
export function webSimhash64(text: string): string {
  return readOwnedString(lib.symbols.aphrody_web_simhash64(cstr(text)));
}

function webIndexError(): string {
  const payload = JSON.parse(readOwnedString(lib.symbols.aphrody_web_index_last_error())) as { error: string | null };
  return payload.error ?? "unknown index error";
}

/** HNSW index backed by the shared Rust Web library. */
export class WebVectorIndex {
  #handle: number;

  private constructor(handle: number, readonly path: string, readonly rebuiltFromCorruptFile: boolean) {
    this.#handle = handle;
  }

  static open(path: string, dim: number, params: Record<string, unknown> = {}): WebVectorIndex {
    const handle = Number(lib.symbols.aphrody_web_index_open(cstr(path), dim, cstr(JSON.stringify(params)), 1));
    if (!handle) throw new Error(`index open failed: ${webIndexError()}`);
    return new WebVectorIndex(handle, path, webIndexError().startsWith("corrupt"));
  }

  #id(): number {
    if (!this.#handle) throw new Error("WebVectorIndex is closed");
    return this.#handle;
  }

  get dim(): number { return lib.symbols.aphrody_web_index_dim(this.#id()); }
  get size(): number { return Math.max(0, Number(lib.symbols.aphrody_web_index_len(this.#id()))); }

  add(key: number, vector: Float32Array): void {
    if (!Number.isSafeInteger(key) || key < 0) throw new RangeError("index key must be a non-negative safe integer");
    if (lib.symbols.aphrody_web_index_add(this.#id(), key, vector, vector.length) !== 0) {
      throw new Error(`index add failed: ${webIndexError()}`);
    }
  }

  addBatch(keys: readonly number[], vectors: readonly Float32Array[]): void {
    if (keys.length !== vectors.length) throw new RangeError("key and vector counts differ");
    if (keys.length === 0) return;
    const dim = this.dim;
    const flat = new Float32Array(keys.length * dim);
    vectors.forEach((vector, i) => {
      if (!Number.isSafeInteger(keys[i]) || keys[i]! < 0 || vector.length !== dim) {
        throw new RangeError("invalid index key or vector dimension");
      }
      flat.set(vector, i * dim);
    });
    const nativeKeys = BigUint64Array.from(keys, (key) => BigInt(key));
    if (lib.symbols.aphrody_web_index_add_batch(this.#id(), nativeKeys, flat, keys.length, dim) !== 0) {
      throw new Error(`index batch failed: ${webIndexError()}`);
    }
  }

  search(query: Float32Array, k: number, ef = Math.max(128, k * 2)): Array<{ key: number; score: number }> {
    const result = JSON.parse(readOwnedString(lib.symbols.aphrody_web_index_search(
      this.#id(), query, query.length, k, ef,
    ))) as Array<{ key: number; score: number }> | { error: string };
    if (!Array.isArray(result)) throw new Error(`index search failed: ${result.error}`);
    return result;
  }

  remove(key: number): boolean { return lib.symbols.aphrody_web_index_remove(this.#id(), key) === 1; }
  save(): void {
    if (lib.symbols.aphrody_web_index_save(this.#id()) !== 0) throw new Error(`index save failed: ${webIndexError()}`);
  }
  compact(): void {
    if (lib.symbols.aphrody_web_index_compact(this.#id()) !== 0) throw new Error(`index compact failed: ${webIndexError()}`);
  }
  stats(): Record<string, unknown> {
    return JSON.parse(readOwnedString(lib.symbols.aphrody_web_index_stats(this.#id()))) as Record<string, unknown>;
  }
  close(): void {
    if (!this.#handle) return;
    lib.symbols.aphrody_web_index_close(this.#handle);
    this.#handle = 0;
  }
}

/** Native ABI version reported by the loaded library. */
export function abiVersion(): number {
  return lib.symbols.aphrody_abi_version();
}

/** aphrody version string. */
export function version(): string {
  const value = lib.symbols.aphrody_version();
  if (value === null) throw new Error("aphrody-ffi returned a null version");
  return value.toString();
}

/** The last error recorded on this thread by the native library, if any. */
export function lastError(): string | null {
  const ptr = lib.symbols.aphrody_last_error();
  if (!ptr) return null;
  const text = new CString(ptr).toString();
  return text.length > 0 ? text : null;
}

/**
 * Run an aphrody command with stdout/stderr inherited by the host process.
 * Returns the exit code. Arguments exclude the program name.
 */
export function run(args: string[]): number {
  return lib.symbols.aphrody_run_json(cstr(JSON.stringify(args)));
}

/** Structured result of a captured run. */
export interface CapturedResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run an aphrody command capturing stdout AND stderr in-process. Arguments
 * exclude the program name, e.g. `runCaptured(["version", "--json"])`.
 */
export function runCaptured(args: string[]): CapturedResult {
  const resultPtr = lib.symbols.aphrody_run_captured(cstr(JSON.stringify(args)));
  if (!resultPtr) {
    return {
      code: 70,
      stdout: "",
      stderr: lastError() ?? "aphrody_run_captured returned NULL",
    };
  }
  try {
    return JSON.parse(new CString(resultPtr).toString()) as CapturedResult;
  } finally {
    lib.symbols.aphrody_string_free(resultPtr);
  }
}

/** Throws if the loaded library's ABI does not match this binding. */
export function assertCompatible(): void {
  const actual = abiVersion();
  if (actual !== EXPECTED_ABI_VERSION) {
    throw new Error(
      `aphrody-ffi ABI mismatch: binding expects ${EXPECTED_ABI_VERSION}, library reports ${actual}`,
    );
  }
}

/** Close the native library handle (optional; the process exit also frees it). */
export function close(): void {
  lib.close();
}
