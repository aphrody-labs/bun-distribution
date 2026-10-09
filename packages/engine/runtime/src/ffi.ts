/**
 * Generic Bun FFI plumbing for native libraries that follow the YOLO owned-buffer convention
 * (`{ data: *mut u8, len: usize, cap: usize }` out-slots released by a `*_free_fields` symbol).
 * Consumers (iecode NIE, Aphrody engines) declare their symbols and library names; discovery,
 * lazy loading with a diagnostic, C strings and owned-byte reads live here once.
 */
import { CString, dlopen, suffix, toArrayBuffer, type FFIFunction, type Pointer } from "bun:ffi";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/** Select one embedded provider before any native ABI call; ambiguity is an error. */
export function embeddedNativeLibraryPath(
  name: string,
  files: readonly Blob[] = Bun.embeddedFiles,
): string | null {
  const stem = process.platform === "win32" ? name : `lib${name}`;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(?:-[A-Za-z0-9_-]+)?\\.${suffix}$`);
  const matches = files.flatMap((file) => {
    const path = (file as Blob & { name?: string }).name;
    return typeof path === "string" && pattern.test(basename(path)) ? [path] : [];
  });
  if (matches.length > 1) throw new Error(`Multiple embedded native libraries for ${name}`);
  const path = matches[0];
  return path === undefined ? null : isAbsolute(path) ? path : join(dirname(Bun.main), path);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** NUL-terminated UTF-8 copy of `text`. */
export function toCString(text: string): Uint8Array {
  const encoded = encoder.encode(text);
  const out = new Uint8Array(encoded.length + 1);
  out.set(encoded);
  return out;
}

/** Size in bytes of an owned-buffer slot on 64-bit targets. */
export const OWNED_SLOT_BYTES = 24;

/**
 * Copy the bytes of a filled owned-buffer slot and release the native allocation through
 * `free(data, len, cap)`. Returns null for an empty or unset slot (the allocation, if any, is still freed).
 */
export function readOwnedBytes(
  slot: Uint8Array,
  free: (data: bigint, len: bigint, cap: bigint) => void,
): Uint8Array | null {
  return withOwnedView(slot, free, (view) => view.slice());
}

export function readOwnedString(
  slot: Uint8Array,
  free: (data: bigint, len: bigint, cap: bigint) => void,
): string | null {
  return withOwnedView(slot, free, (view) => decoder.decode(view));
}

/**
 * Run `read` on a borrowed view of the slot's bytes, then release them. `free` takes
 * `(data, len, cap)`, not the `(bytes, ctx)` of a `toArrayBuffer` deallocator, so the
 * allocation cannot be handed to the GC and the view must not escape `read`.
 */
function withOwnedView<T>(
  slot: Uint8Array,
  free: (data: bigint, len: bigint, cap: bigint) => void,
  read: (view: Uint8Array) => T,
): T | null {
  const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
  const data = view.getBigUint64(0, true);
  const len = view.getBigUint64(8, true);
  const cap = view.getBigUint64(16, true);
  if (data === 0n || len === 0n) {
    if (data !== 0n) free(data, len, cap);
    return null;
  }
  try {
    return read(new Uint8Array(toArrayBuffer(Number(data) as unknown as Pointer, 0, Number(len))));
  } finally {
    free(data, len, cap);
  }
}

export function readOwnedJson<T = unknown>(
  slot: Uint8Array,
  free: (data: bigint, len: bigint, cap: bigint) => void,
): T | null {
  const text = readOwnedString(slot, free);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Copy `len` bytes at a native address and release the allocation through `free(address)`.
 * For C ABIs returning `(ptr, len)` through separate out-parameters.
 */
export function readNativeBytes(
  address: number | bigint,
  len: number,
  free: (address: number) => void,
): Uint8Array {
  const addr = Number(address);
  try {
    return new Uint8Array(toArrayBuffer(addr as unknown as Pointer, 0, len)).slice();
  } finally {
    free(addr);
  }
}

/** Copy a NUL-terminated native string and always release its original allocation. */
export function readNativeString(
  address: number | bigint,
  free: (address: number) => void,
): string {
  const addr = Number(address);
  try {
    return new CString(addr as Pointer).toString();
  } finally {
    free(addr);
  }
}

export interface NativeLibraryOptions<S extends Record<string, FFIFunction>> {
  /** Library base name without prefix or suffix, e.g. `iecode` for `libiecode.so`. */
  name: string;
  /** Exact file name (or per-platform file names) overriding `lib<name>.<suffix>`, e.g. .NET NativeAOT `IECODE.Ffi.so`. */
  fileNames?: readonly string[];
  symbols: S;
  /** Explicit library file, checked before environment variables. */
  path?: string;
  /** Environment variables naming an explicit library file, checked first, in order. */
  envPaths?: readonly string[];
  /** Extra directories searched after the executable dir and `~/.local/bin`. */
  searchDirs?: readonly string[];
  /** Cargo hint appended to the "not found" diagnostic. */
  buildHint?: string;
}

export interface NativeLibrary<S extends Record<string, FFIFunction>> {
  resolvePath(): string | null;
  /** Loaded symbol table, or null (see `loadError`). Loading is attempted once. */
  load(): ReturnType<typeof dlopen<S>>["symbols"] | null;
  isAvailable(): boolean;
  loadError(): string | null;
  libraryPath(): string | null;
  readonly closed: boolean;
  /** Terminal, idempotent unload. Callers must stop using previously returned symbols. */
  close(): void;
}

/** Lazy, diagnosable native library loader. */
export function nativeLibrary<S extends Record<string, FFIFunction>>(
  options: NativeLibraryOptions<S>,
): NativeLibrary<S> {
  const defaultFile =
    process.platform === "win32" ? `${options.name}.dll` : `lib${options.name}.${suffix}`;
  const files = options.fileNames?.length ? options.fileNames : [defaultFile];
  const file = files[0]!;
  let attempted = false;
  let symbols: ReturnType<typeof dlopen<S>>["symbols"] | null = null;
  let error: string | null = null;
  let path: string | null = null;
  let library: ReturnType<typeof dlopen<S>> | null = null;
  let closed = false;

  const resolvePath = (): string | null => {
    if (options.path && existsSync(options.path)) return options.path;
    for (const env of options.envPaths ?? []) {
      const value = process.env[env];
      if (value && existsSync(value)) return value;
    }
    const dirs = [
      dirname(process.execPath),
      resolve(homedir(), ".local/bin"),
      ...(options.searchDirs ?? []),
    ];
    const candidates = dirs.flatMap((dir) => files.map((name) => resolve(dir, name)));
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  };
  const load = () => {
    if (attempted) return symbols;
    attempted = true;
    const found = resolvePath();
    if (!found) {
      error = `Native binary ${file} not found.${options.buildHint ? ` ${options.buildHint}` : ""}`;
      return null;
    }
    try {
      library = dlopen(found, options.symbols);
      symbols = library.symbols;
      path = found;
      error = null;
    } catch (cause) {
      error = `Failed to dlopen ${found}: ${cause instanceof Error ? cause.message : String(cause)}`;
      symbols = null;
    }
    return symbols;
  };
  return {
    resolvePath,
    load,
    isAvailable: () => load() !== null,
    loadError: () => (load(), error),
    libraryPath: () => (load(), path),
    get closed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      attempted = true;
      symbols = null;
      error = `Native library ${file} is closed`;
      const owned = library;
      library = null;
      owned?.close();
    },
  };
}
