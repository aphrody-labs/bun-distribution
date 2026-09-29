// SPDX-License-Identifier: Apache-2.0
//
// In-process aphrody CLI engine bindings for Bun via `bun:ffi`.
// Loads the `aphrody_ffi` native library directly into the Bun runtime,
// avoiding process spawning overhead for commands.

import { CString, dlopen, FFIType, suffix } from "bun:ffi";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Expected ABI version from aphrody-ffi. */
export const EXPECTED_APHRODY_ABI_VERSION = 1;

const ENCODER = new TextEncoder();

interface AphrodyLibrary {
  close(): void;
  symbols: Record<string, (...args: any[]) => any>;
}

function cstr(text: string): Uint8Array {
  return ENCODER.encode(`${text}\0`);
}

function resolveAphrodyLibPath(): string | null {
  const override = process.env.APHRODY_FFI_LIB;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`APHRODY_FFI_LIB points to a missing file: ${override}`);
    }
    return override;
  }

  const prefix = process.platform === "win32" ? "" : "lib";
  const fileName = `${prefix}aphrody_ffi.${suffix}`;
  const altFileName = `libaphrody_ffi.${suffix}`;

  const here = dirname(fileURLToPath(import.meta.url));
  // packages/bun/aphrody/src -> repository root is four levels up.
  const repoRoot = join(here, "..", "..", "..", "..");
  const targetDir = join(repoRoot, "target");

  const candidates: string[] = [];

  for (const name of [fileName, altFileName]) {
    for (const profile of ["release", "debug"]) {
      candidates.push(join(targetDir, profile, name));
    }
  }

  try {
    if (existsSync(targetDir)) {
      for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const name of [fileName, altFileName]) {
          for (const profile of ["release", "debug"]) {
            candidates.push(join(targetDir, entry.name, profile, name));
          }
        }
      }
    }
  } catch {
    // target directory might not be readable or exist
  }

  for (const cand of candidates) {
    if (existsSync(cand)) {
      return cand;
    }
  }

  return null;
}

let aphrodyLibInstance: ReturnType<typeof initLib> | null = null;

function initLib() {
  const libPath = resolveAphrodyLibPath();
  if (!libPath) {
    return null;
  }

  let loaded: AphrodyLibrary;
  try {
    loaded = dlopen(libPath, {
      aphrody_abi_version: { args: [], returns: FFIType.u32 },
      aphrody_version: { args: [], returns: FFIType.cstring },
      aphrody_run_json: { args: [FFIType.cstring], returns: FFIType.i32 },
      aphrody_run_captured: { args: [FFIType.cstring], returns: FFIType.ptr },
      aphrody_string_free: { args: [FFIType.ptr], returns: FFIType.void },
      aphrody_last_error: { args: [], returns: FFIType.ptr },
    }) as unknown as AphrodyLibrary;
  } catch (error) {
    throw new Error(`Unable to load aphrody-ffi at ${libPath}: ${String(error)}`, { cause: error });
  }

  const actualAbi = loaded.symbols.aphrody_abi_version!();
  if (actualAbi !== EXPECTED_APHRODY_ABI_VERSION) {
    loaded.close();
    throw new Error(
      `aphrody-ffi ABI mismatch at ${libPath}: expected ${EXPECTED_APHRODY_ABI_VERSION}, found ${actualAbi}`,
    );
  }
  return loaded;
}

function getLib() {
  if (aphrodyLibInstance === null) {
    aphrodyLibInstance = initLib();
  }
  return aphrodyLibInstance;
}

/** Check if the native aphrody-ffi dynamic library is loaded and available. */
export function isAphrodyFfiAvailable(): boolean {
  return getLib() !== null;
}

/** Get the runtime ABI version from the native aphrody-ffi library. */
export function getAphrodyAbiVersion(): number {
  const lib = getLib();
  if (!lib) throw new Error("aphrody-ffi library not found; build aphrody-ffi or set APHRODY_FFI_LIB");
  return Number(lib.symbols.aphrody_abi_version!());
}

/** Get the version of aphrody as reported by the native library. */
export function getAphrodyVersion(): string {
  const lib = getLib();
  if (!lib) throw new Error("aphrody-ffi library not found; build aphrody-ffi or set APHRODY_FFI_LIB");
  const version = lib.symbols.aphrody_version!();
  if (!version) throw new Error("aphrody-ffi returned a null version pointer");
  return version.toString();
}

/** Get the last error recorded on the calling thread in aphrody-ffi. */
export function getAphrodyLastError(): string | null {
  const lib = getLib();
  if (!lib) return null;
  const ptr = lib.symbols.aphrody_last_error!();
  if (!ptr) return null;
  const text = new CString(ptr as any).toString();
  return text.length > 0 ? text : null;
}

/**
 * Execute an aphrody command in-process with inherited stdio.
 * @param args Command line arguments without program name, e.g. `["doctor"]`.
 * @returns Exit code (0 for success).
 */
export function runAphrody(args: string[]): number {
  const lib = getLib();
  if (!lib) throw new Error("aphrody-ffi library not found; build aphrody-ffi or set APHRODY_FFI_LIB");
  validateArgs(args);
  return Number(lib.symbols.aphrody_run_json!(cstr(JSON.stringify(args))));
}

/** Captured execution result from aphrody-ffi. */
export interface AphrodyCapturedResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute an aphrody command in-process capturing stdout and stderr.
 * @param args Command line arguments without program name, e.g. `["version", "--json"]`.
 */
export function runAphrodyCaptured(args: string[]): AphrodyCapturedResult {
  const lib = getLib();
  if (!lib) {
    throw new Error("aphrody-ffi library not found; build aphrody-ffi or set APHRODY_FFI_LIB");
  }
  validateArgs(args);

  const resultPtr = lib.symbols.aphrody_run_captured!(cstr(JSON.stringify(args)));
  if (!resultPtr) {
    throw new Error(getAphrodyLastError() ?? "aphrody_run_captured returned NULL");
  }

  try {
    const value: unknown = JSON.parse(new CString(resultPtr as any).toString());
    if (
      typeof value !== "object" || value === null ||
      !Number.isInteger((value as any).code) ||
      typeof (value as any).stdout !== "string" ||
      typeof (value as any).stderr !== "string"
    ) {
      throw new Error("aphrody_run_captured returned an invalid result payload");
    }
    return value as AphrodyCapturedResult;
  } finally {
    lib.symbols.aphrody_string_free!(resultPtr);
  }
}

function validateArgs(args: string[]): void {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("Aphrody CLI arguments must be strings without NUL characters");
  }
}
