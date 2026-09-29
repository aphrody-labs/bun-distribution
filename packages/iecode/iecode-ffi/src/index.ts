import { dlopen, FFIType, suffix, toArrayBuffer } from "bun:ffi";

const FFI_SCHEMA = "iecode.ffi/v1";
const POINTER_BYTES = 8;
const IECODE_BYTES_SIZE = POINTER_BYTES * 3;
// Bun 1.4's declarations expose `u64`; at runtime `FFIType.usize === FFIType.u64`.
// IECODE supports 64-bit Bun hosts only, matching Rust's `usize` ABI here.
const FFI_USIZE = FFIType.u64;

/** Exact exported names and signatures from `crates/ffi/src/lib.rs`. */
export const IECODE_FFI_SYMBOLS = {
  iecode_core_version: {
    args: [],
    returns: FFIType.cstring,
  },
  iecode_ffi_schema: {
    args: [],
    returns: FFIType.cstring,
  },
  iecode_emu_registry_json_out: {
    args: [FFIType.ptr],
    returns: FFIType.i32,
  },
  iecode_pipeline_validate_json: {
    args: [FFIType.ptr, FFI_USIZE, FFIType.ptr],
    returns: FFIType.i32,
  },
  iecode_bytes_free_fields: {
    args: [FFIType.ptr, FFI_USIZE, FFI_USIZE],
    returns: FFIType.void,
  },
  iecode_ffi_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
} as const;

export type IecodeFfiLibrary = ReturnType<typeof dlopen<typeof IECODE_FFI_SYMBOLS>>;

type IecodeBytes = {
  pointer: Parameters<typeof toArrayBuffer>[0];
  length: number;
  capacity: number;
};

function assertSupportedPointerWidth(): void {
  if (process.arch !== "arm64" && process.arch !== "x64") {
    throw new Error(`iecode-ffi requires a 64-bit process; received ${process.arch}`);
  }
}

function readIecodeBytes(storage: Uint8Array): IecodeBytes {
  assertSupportedPointerWidth();
  const view = new DataView(storage.buffer, storage.byteOffset, storage.byteLength);
  const pointer = Number(view.getBigUint64(0, true)) as IecodeBytes["pointer"];
  const length = Number(view.getBigUint64(POINTER_BYTES, true));
  const capacity = Number(view.getBigUint64(POINTER_BYTES * 2, true));

  if (
    !Number.isSafeInteger(pointer) ||
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(capacity)
  ) {
    throw new Error("iecode-ffi returned an unsupported IecodeBytes value");
  }
  if (pointer === 0 || length > capacity) {
    throw new Error("iecode-ffi returned an invalid IecodeBytes value");
  }

  return { pointer, length, capacity };
}

function readOwnedJson<T>(library: IecodeFfiLibrary, storage: Uint8Array): T {
  const bytes = readIecodeBytes(storage);
  try {
    return JSON.parse(
      new TextDecoder().decode(new Uint8Array(toArrayBuffer(bytes.pointer, 0, bytes.length))),
    ) as T;
  } finally {
    const pointer = bytes.pointer as Parameters<typeof library.symbols.iecode_bytes_free_fields>[0];
    library.symbols.iecode_bytes_free_fields(pointer, bytes.length, bytes.capacity);
  }
}

/** Resolve through an override or the platform loader; never a repository path. */
export function resolveLibraryPath(): string {
  if (Bun.env.IECODE_FFI_LIBRARY) {
    return Bun.env.IECODE_FFI_LIBRARY;
  }

  return process.platform === "win32" ? `iecode_ffi.${suffix}` : `libiecode_ffi.${suffix}`;
}

export function openIecodeFfi(path = resolveLibraryPath()): IecodeFfiLibrary {
  return dlopen(path, IECODE_FFI_SYMBOLS);
}

export function readCoreVersion(path?: string): string {
  const library = openIecodeFfi(path);
  return library.symbols.iecode_core_version() ?? "";
}

export function readSchema(path?: string): string {
  const library = openIecodeFfi(path);
  return library.symbols.iecode_ffi_schema() ?? "";
}

/** Read and release the native registry using the ABI's explicit ownership tuple. */
export function readEmulatorRegistry<T = unknown>(path?: string): T {
  const library = openIecodeFfi(path);
  const output = new Uint8Array(IECODE_BYTES_SIZE);
  const status = library.symbols.iecode_emu_registry_json_out(output);
  if (status !== 0) {
    throw new Error(`iecode FFI registry request failed (${status})`);
  }

  return readOwnedJson<T>(library, output);
}

/** Validate a pipeline manifest through the same Rust contract used by native callers. */
export function validatePipelineJson<T = Record<string, unknown>>(
  manifest: string,
  path?: string,
): T {
  const library = openIecodeFfi(path);
  const input = new TextEncoder().encode(manifest);
  const output = new Uint8Array(IECODE_BYTES_SIZE);
  const status = library.symbols.iecode_pipeline_validate_json(input, input.byteLength, output);
  const result = readOwnedJson<T & { valid?: boolean; error?: string }>(library, output);
  if (status !== 0 || result.valid === false) {
    throw new Error(
      `iecode FFI pipeline validation failed (${status}): ${result.error ?? "invalid manifest"}`,
    );
  }
  return result;
}

export { FFI_SCHEMA };
