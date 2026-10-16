/**
 * @file ffi/nie.ts
 * @description Comprehensive, high-performance Bun FFI binding to the native `iecode` Rust engine (aphrody-nie-ffi).
 *
 * Exposes Level-5 & NIE capabilities:
 * - CRC32 (Standard IEEE 802.3 Level-5 polynomial & raw NIE accumulator)
 * - CRI CPK key derivation, position-aware block XOR decryption, listing & extraction
 * - CRILAYLA reverse-bitstream LZSS decompression & compression
 * - RDBN / cfg.bin (T2B) probe, structured JSON decoding & table entry query
 * - G4TX texture format inspection, main/subtexture PNG decoding & raw RGBA8 pixels
 * - VFS virtual filesystem mounting, queries, and file streaming
 * - Lives save game container detection, decryption, summary & blob extraction
 * - Match deterministic simulator and CRand PRNG (MT19937)
 * - Safe memory lifecycle with automated cleanup, graceful fallback, and diagnostics
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { resolve } from "node:path";
import {
  nativeLibrary,
  readOwnedBytes,
  readOwnedJson,
  readOwnedString,
  toCString,
} from "@aphrody/runtime-sdk/ffi";
import { resolveFormat } from "../docs/vfs-catalog.js";
import { iecodePath } from "../core/roots.js";
import {
  computeLevel5Crc32,
  computeNieCrc32,
  deriveCpkKeyFromFilename,
  decryptCpkBlock,
  decompressCrilayla,
  isCrilayla,
  PureCrand,
} from "../nie-bridge/index.js";

const textEncoder = new TextEncoder();

// ============================================================================
// Types & Models
// ============================================================================

export interface NieBuildInfo {
  version: string;
  product: string;
  abiVersion: number;
  capabilities: string[];
  targetOs: string;
  targetArch: string;
}

export interface NieCpkEntry {
  index: number;
  id: number;
  name: string;
  dirName: string;
  offset: number;
  size: number;
  extractSize: number;
  isCompressed: boolean;
}

export interface NieCpkArchive {
  isEncrypted: boolean;
  fileKey: number | null;
  count: number;
  entries: NieCpkEntry[];
}

export interface NieCpkHeader {
  isEncrypted: boolean;
  fileKey: number | null;
  entryCount: number;
}

export interface NieG4txSubTexture {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NieG4txTexture {
  id: number;
  name: string;
  width: number;
  height: number;
  isDds: boolean;
  dataOffset: number;
  dataSize: number;
  subTextureCount: number;
  subTextures: NieG4txSubTexture[];
}

export interface NieG4txInfo {
  headerSize: number;
  fileType: number;
  tableSize: number;
  textureCount: number;
  textures: NieG4txTexture[];
}

export interface NieVfsFileInfo {
  path: string;
  cpk: string;
  size: number;
  isReadable: boolean;
}

export interface NieSaveBlobInfo {
  index: number;
  filename: string;
  subtype: string;
  size: number;
  crc32: number;
  payloadSize: number;
}

export interface NieSaveSummary {
  slotName: string;
  playerName: string;
  levelStr: string;
  playtimeSecs: number | null;
  uniqueId: string;
  lastSave: any;
  usedSlots: number | null;
  maxSlots: number | null;
  rosterCount: number;
  blobs: NieSaveBlobInfo[];
}

// ============================================================================
// FFI Symbol Specifications
// ============================================================================

const NIE_FFI_SYMBOLS = {
  nie_version: {
    args: [],
    returns: FFIType.cstring,
  },
  nie_build_info_json_out: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  nie_cfgbin_typed_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_clear_error: {
    args: [],
    returns: FFIType.void,
  },
  nie_last_error_out: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  nie_bytes_free_fields: {
    args: [FFIType.u64, FFIType.u64, FFIType.u64],
    returns: FFIType.void,
  },
  nie_crc32: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u32,
  },
  nie_crc32_nie: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u32,
  },
  nie_crand_new: {
    args: [FFIType.u32],
    returns: FFIType.ptr,
  },
  nie_crand_from_u64: {
    args: [FFIType.u64],
    returns: FFIType.ptr,
  },
  nie_crand_next_u32: {
    args: [FFIType.ptr],
    returns: FFIType.u32,
  },
  nie_crand_bounded: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.u32,
  },
  nie_crand_next_f32: {
    args: [FFIType.ptr],
    returns: FFIType.f32,
  },
  nie_crand_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  nie_detect: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u32,
  },
  nie_probe_header: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u32,
  },
  nie_format_name: {
    args: [FFIType.u32],
    returns: FFIType.cstring,
  },
  nie_format_extension: {
    args: [FFIType.u32],
    returns: FFIType.cstring,
  },
  nie_format_mime_type: {
    args: [FFIType.u32],
    returns: FFIType.cstring,
  },
  nie_format_category: {
    args: [FFIType.u32],
    returns: FFIType.cstring,
  },
  nie_format_is_big_endian: {
    args: [FFIType.u32],
    returns: FFIType.bool,
  },
  nie_format_supports_encryption: {
    args: [FFIType.u32],
    returns: FFIType.bool,
  },
  nie_format_supports_compression: {
    args: [FFIType.u32],
    returns: FFIType.bool,
  },
  nie_format_count: {
    args: [],
    returns: FFIType.u32,
  },
  nie_format_id_by_index: {
    args: [FFIType.u32],
    returns: FFIType.u32,
  },
  nie_format_catalog_json_out: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  nie_decode_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_cpk_key_from_filename: {
    args: [FFIType.cstring],
    returns: FFIType.u32,
  },
  nie_cpk_decrypt_block: {
    args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.u32],
    returns: FFIType.void,
  },
  nie_crilayla_is_compressed: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u32,
  },
  nie_crilayla_decompress_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_crilayla_compress_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_cpk_probe: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u32,
  },
  nie_cpk_header_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_cpk_list_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_cpk_extract_entry_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_cpk_extract_by_name_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.cstring, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_cfgbin_probe: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u32,
  },
  nie_cfgbin_to_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_rdbn_entry_query_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_menu_setting_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_g4tx_probe: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.u32,
  },
  nie_g4tx_info_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_g4tx_to_rgba_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.u32,
  },
  nie_g4tx_to_png_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_g4tx_subtexture_to_png_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_vfs_open: {
    args: [FFIType.cstring],
    returns: FFIType.ptr,
  },
  nie_vfs_read_out: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_vfs_file_info_json_out: {
    args: [FFIType.ptr, FFIType.cstring, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_vfs_list_json_out: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_vfs_list_range_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_vfs_count: {
    args: [FFIType.ptr],
    returns: FFIType.u64,
  },
  nie_vfs_is_readable: {
    args: [FFIType.ptr, FFIType.cstring],
    returns: FFIType.u32,
  },
  nie_vfs_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  nie_save_probe: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring],
    returns: FFIType.u32,
  },
  nie_save_summary_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_save_extract_blob_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_match_simulate_json_out: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_wiki_json_out: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.void,
  },
  nie_emu_registry_json_out: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
} as const;

// ============================================================================
// Library Discovery & Initialization
// ============================================================================

const nativeLib = nativeLibrary({
  name: "iecode",
  symbols: NIE_FFI_SYMBOLS,
  envPaths: ["IECODE_LIB_PATH", "NIE_FFI_PATH"],
  searchDirs: [
    resolve(process.cwd(), "target/release"),
    resolve(process.cwd(), "target/debug"),
    resolve(process.cwd(), "../target/release"),
    resolve(process.cwd(), "../target/debug"),
    iecodePath("target", "release"),
    iecodePath("target", "debug"),
  ],
  buildHint: "Compile with `cargo build -p aphrody-nie-ffi`.",
});

/**
 * Searches candidates for the compiled native `iecode` shared library.
 */
export function resolveNativeLibPath(): string | null {
  return nativeLib.resolvePath();
}

/**
 * Loads the native shared library via bun:ffi dlopen.
 * Returns the raw symbols table or null if not available.
 */
export function getNativeLib(): any | null {
  return nativeLib.load();
}

/**
 * Returns true if the native Rust library was successfully loaded.
 */
export function isNativeAvailable(): boolean {
  return nativeLib.isAvailable();
}

/**
 * Returns the library load diagnostic error, if any.
 */
export function getNativeLoadError(): string | null {
  return nativeLib.loadError();
}

/**
 * Returns the resolved file path of the loaded native library, or null.
 */
export function getNativeLibraryPath(): string | null {
  return nativeLib.libraryPath();
}

// ============================================================================
// Internal Helpers for NieBytes Buffer Transfer
// ============================================================================

export const freeNieBytes = (symbols: any) => (data: bigint, len: bigint, cap: bigint) =>
  symbols.nie_bytes_free_fields(data, len, cap);

function readAndFreeNieBytes(symbols: any, slot: Uint8Array): Uint8Array | null {
  return readOwnedBytes(slot, freeNieBytes(symbols));
}

function readAndFreeNieBytesString(symbols: any, slot: Uint8Array): string | null {
  return readOwnedString(slot, freeNieBytes(symbols));
}

function readAndFreeNieBytesJson<T = any>(symbols: any, slot: Uint8Array): T | null {
  return readOwnedJson<T>(slot, freeNieBytes(symbols));
}

// ============================================================================
// Public Ergonomic API
// ============================================================================

/**
 * Returns the compiled crate version string.
 */
export function nieVersion(): string {
  const lib = getNativeLib();
  if (lib) {
    return String(lib.nie_version());
  }
  return "1.0.0-fallback";
}

/**
 * Returns native engine build information and active capabilities.
 */
export function nieBuildInfo(): NieBuildInfo | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  lib.nie_build_info_json_out(ptr(slot));
  return readAndFreeNieBytesJson<NieBuildInfo>(lib, slot);
}

/**
 * Returns thread-local last error, if set.
 */
export function nieGetLastError(): string | null {
  const lib = getNativeLib();
  if (!lib) return getNativeLoadError();
  const slot = new Uint8Array(24);
  lib.nie_last_error_out(ptr(slot));
  return readAndFreeNieBytesString(lib, slot);
}

/**
 * Clears the thread-local error buffer.
 */
export function nieClearError(): void {
  const lib = getNativeLib();
  if (lib) {
    lib.nie_clear_error();
  }
}

/**
 * Computes standard IEEE 802.3 Level-5 CRC32 hash (with ~crc).
 */
export function nieCrc32(input: string | Uint8Array): number {
  const lib = getNativeLib();
  if (lib) {
    const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
    if (bytes.length === 0) return 0;
    return lib.nie_crc32(ptr(bytes), bytes.length) >>> 0;
  }
  return computeLevel5Crc32(input);
}

/**
 * Computes the raw NIE/Level-5 CRC32 accumulator without ~crc.
 */
export function nieCrc32Nie(input: string | Uint8Array): number {
  const lib = getNativeLib();
  if (lib) {
    const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
    if (bytes.length === 0) return 0xffffffff;
    return lib.nie_crc32_nie(ptr(bytes), bytes.length) >>> 0;
  }
  return computeNieCrc32(input);
}

/**
 * Derives the CRI position-XOR decryption key from a CPK archive filename.
 */
export function nieCpkKeyFromFilename(filename: string): number {
  const lib = getNativeLib();
  if (lib) {
    const cName = toCString(filename);
    return lib.nie_cpk_key_from_filename(ptr(cName)) >>> 0;
  }
  return deriveCpkKeyFromFilename(filename);
}

/**
 * Decrypts a CPK buffer in place using CRI position-aware XOR.
 */
export function nieDecryptCpkBlock(
  buffer: Uint8Array,
  fileOffset: number | bigint = 0,
  key?: number,
): void {
  if (key === undefined) {
    throw new Error("nieDecryptCpkBlock requires an explicit key");
  }
  const lib = getNativeLib();
  if (lib) {
    lib.nie_cpk_decrypt_block(ptr(buffer), buffer.length, BigInt(fileOffset), key >>> 0);
    return;
  }
  decryptCpkBlock(buffer, key, Number(fileOffset));
}

/**
 * Checks whether a buffer starts with the CRILAYLA magic signature.
 */
export function nieIsCrilayla(buffer: Uint8Array): boolean {
  const lib = getNativeLib();
  if (lib) {
    return lib.nie_crilayla_is_compressed(ptr(buffer), buffer.length) === 1;
  }
  return isCrilayla(buffer);
}

/**
 * Decompresses a CRILAYLA compressed buffer.
 */
export function nieDecompressCrilayla(buffer: Uint8Array): Uint8Array | null {
  const lib = getNativeLib();
  if (lib) {
    const slot = new Uint8Array(24);
    lib.nie_crilayla_decompress_out(ptr(buffer), buffer.length, ptr(slot));
    return readAndFreeNieBytes(lib, slot);
  }
  try {
    return decompressCrilayla(buffer);
  } catch {
    return null;
  }
}

/**
 * Compresses raw data into a standard CRILAYLA stream.
 */
export function nieCompressCrilayla(buffer: Uint8Array): Uint8Array | null {
  const lib = getNativeLib();
  if (!lib) {
    throw new Error("CRILAYLA compression requires native libiecode.");
  }
  const slot = new Uint8Array(24);
  lib.nie_crilayla_compress_out(ptr(buffer), buffer.length, ptr(slot));
  return readAndFreeNieBytes(lib, slot);
}

/**
 * Probes the format of a binary buffer.
 */
export function nieProbeHeader(buffer: Uint8Array): number {
  const lib = getNativeLib();
  if (lib) {
    return lib.nie_probe_header(ptr(buffer), buffer.length);
  }
  if (buffer.length >= 8 && new TextDecoder().decode(buffer.subarray(0, 8)) === "CRILAYLA") {
    return 22;
  }
  if (buffer.length >= 4) {
    return resolveFormat(new TextDecoder().decode(buffer.subarray(0, 4)))?.id ?? 0;
  }
  return 0;
}

/**
 * Returns short human-readable name of a format kind.
 */
export function nieFormatName(kind: number): string {
  const lib = getNativeLib();
  if (lib) {
    return String(lib.nie_format_name(kind));
  }
  const names: Record<number, string> = {
    0: "?",
    1: "G4TX",
    2: "G4MD",
    3: "G4MG",
    4: "G4MT",
    5: "G4SK",
    6: "G4PK",
    7: "G4RA",
    8: "AGI",
    9: "OBJB",
    10: "col",
    11: "cfg.bin",
    12: "mevbin",
    13: "G4CM",
    14: "CPK",
    15: "AWB",
    16: "@UTF",
    17: "DDS",
    18: "PNG",
    19: "WAV",
    20: "XPCK",
    21: "XFSA",
    22: "CRILAYLA",
    23: "ACB",
    24: "USM",
    25: "G4NV",
    26: "COL",
    27: "COLS",
    28: "LIVE",
  };
  return names[kind] ?? "?";
}

/**
 * Automatically detects file format and decodes it to JSON.
 */
export function nieDecodeJson<T = any>(buffer: Uint8Array): T | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  lib.nie_decode_json_out(ptr(buffer), buffer.length, ptr(slot));
  return readAndFreeNieBytesJson<T>(lib, slot);
}

/**
 * Probes if buffer is an unencrypted CPK.
 */
export function nieCpkProbe(buffer: Uint8Array): boolean {
  const lib = getNativeLib();
  if (lib) {
    return lib.nie_cpk_probe(ptr(buffer), buffer.length) === 1;
  }
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x43 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4b &&
    buffer[3] === 0x20
  );
}

/**
 * Parses and returns basic CPK archive header info.
 */
export function nieCpkHeader(buffer: Uint8Array, filename = ""): NieCpkHeader | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cName = toCString(filename);
  lib.nie_cpk_header_json_out(ptr(buffer), buffer.length, ptr(cName), ptr(slot));
  return readAndFreeNieBytesJson<NieCpkHeader>(lib, slot);
}

/**
 * Lists all file entries in a CPK buffer.
 */
export function nieCpkList(buffer: Uint8Array, filename = ""): NieCpkArchive | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cName = toCString(filename);
  lib.nie_cpk_list_json_out(ptr(buffer), buffer.length, ptr(cName), ptr(slot));
  return readAndFreeNieBytesJson<NieCpkArchive>(lib, slot);
}

/**
 * Extracts a specific entry by its index from a CPK buffer.
 */
export function nieCpkExtractEntry(
  buffer: Uint8Array,
  entryIndex: number,
  filename = "",
): Uint8Array | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cName = toCString(filename);
  lib.nie_cpk_extract_entry_out(ptr(buffer), buffer.length, ptr(cName), entryIndex, ptr(slot));
  return readAndFreeNieBytes(lib, slot);
}

/**
 * Extracts a file by internal path/name from a CPK buffer.
 */
export function nieCpkExtractByName(
  buffer: Uint8Array,
  entryName: string,
  filename = "",
): Uint8Array | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cName = toCString(filename);
  const cTarget = toCString(entryName);
  lib.nie_cpk_extract_by_name_out(ptr(buffer), buffer.length, ptr(cName), ptr(cTarget), ptr(slot));
  return readAndFreeNieBytes(lib, slot);
}

/**
 * Probes a cfg.bin buffer (1 = RDBN, 2 = T2B, 0 = Unknown).
 */
export function nieCfgBinProbe(buffer: Uint8Array): number {
  const lib = getNativeLib();
  if (lib) {
    return lib.nie_cfgbin_probe(ptr(buffer), buffer.length);
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x44 &&
    buffer[2] === 0x42 &&
    buffer[3] === 0x4e
  ) {
    return 1;
  }
  return 0;
}

/**
 * Decodes a cfg.bin file (RDBN or T2B) to unified JSON.
 */
export function nieDecodeCfgBinJson<T = any>(buffer: Uint8Array): T | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  lib.nie_cfgbin_to_json_out(ptr(buffer), buffer.length, ptr(slot));
  return readAndFreeNieBytesJson<T>(lib, slot);
}

/**
 * Queries a single table in an RDBN binary file.
 */
export function nieRdbnQueryTable<T = any>(buffer: Uint8Array, tableName: string): T | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cTable = toCString(tableName);
  lib.nie_rdbn_entry_query_json_out(ptr(buffer), buffer.length, ptr(cTable), ptr(slot));
  return readAndFreeNieBytesJson<T>(lib, slot);
}

/**
 * Decodes a menu setting cfg.bin into semantic MenuSetting JSON.
 */
export function nieDecodeMenuSettingJson<T = any>(buffer: Uint8Array): T | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  lib.nie_menu_setting_json_out(ptr(buffer), buffer.length, ptr(slot));
  return readAndFreeNieBytesJson<T>(lib, slot);
}

/**
 * Checks whether a buffer starts with the G4TX signature.
 */
export function nieG4txProbe(buffer: Uint8Array): boolean {
  const lib = getNativeLib();
  if (lib) {
    return lib.nie_g4tx_probe(ptr(buffer), buffer.length) === 1;
  }
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x34 &&
    buffer[2] === 0x54 &&
    buffer[3] === 0x58
  );
}

/**
 * Parses G4TX texture header and sub-texture atlas metadata.
 */
export function nieG4txInfo(buffer: Uint8Array): NieG4txInfo | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  lib.nie_g4tx_info_json_out(ptr(buffer), buffer.length, ptr(slot));
  return readAndFreeNieBytesJson<NieG4txInfo>(lib, slot);
}

/**
 * Decodes the main texture of a G4TX container to PNG bytes.
 */
export function nieG4txToPng(buffer: Uint8Array): Uint8Array | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  lib.nie_g4tx_to_png_out(ptr(buffer), buffer.length, ptr(slot));
  return readAndFreeNieBytes(lib, slot);
}

/**
 * Decodes a named subtexture from a G4TX texture atlas to PNG bytes.
 */
export function nieG4txSubtextureToPng(buffer: Uint8Array, subName: string): Uint8Array | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cName = toCString(subName);
  lib.nie_g4tx_subtexture_to_png_out(ptr(buffer), buffer.length, ptr(cName), ptr(slot));
  return readAndFreeNieBytes(lib, slot);
}

/**
 * Decodes the main texture of a G4TX container to raw RGBA8 pixels.
 */
export function nieG4txToRgba(
  buffer: Uint8Array,
): { width: number; height: number; rgba: Uint8Array } | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const wBuf = new Uint32Array(1);
  const hBuf = new Uint32Array(1);

  const ok = lib.nie_g4tx_to_rgba_out(ptr(buffer), buffer.length, ptr(slot), ptr(wBuf), ptr(hBuf));
  if (ok !== 1) {
    return null;
  }
  const rgba = readAndFreeNieBytes(lib, slot);
  if (!rgba) return null;
  return {
    width: wBuf[0],
    height: hBuf[0],
    rgba,
  };
}

/**
 * Probes if buffer is a Lives encrypted save file.
 */
export function nieSaveProbe(buffer: Uint8Array, filename: string): boolean {
  const lib = getNativeLib();
  if (!lib) return false;
  const cName = toCString(filename);
  return lib.nie_save_probe(ptr(buffer), buffer.length, ptr(cName)) === 1;
}

/**
 * Decrypts a Lives save file and returns full summary JSON.
 */
export function nieSaveSummary(buffer: Uint8Array, filename: string): NieSaveSummary | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cName = toCString(filename);
  lib.nie_save_summary_json_out(ptr(buffer), buffer.length, ptr(cName), ptr(slot));
  return readAndFreeNieBytesJson<NieSaveSummary>(lib, slot);
}

/**
 * Extracts a decrypted blob from a Lives save file.
 */
export function nieSaveExtractBlob(
  buffer: Uint8Array,
  filename: string,
  blobIndex: number,
): Uint8Array | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cName = toCString(filename);
  lib.nie_save_extract_blob_out(ptr(buffer), buffer.length, ptr(cName), blobIndex, ptr(slot));
  return readAndFreeNieBytes(lib, slot);
}

/**
 * Simulates a full soccer match from team setups and seed.
 */
export function nieSimulateMatch<T = any>(homeSetup: any, awaySetup: any, seed = 0n): T | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const cHome = toCString(JSON.stringify(homeSetup));
  const cAway = toCString(JSON.stringify(awaySetup));
  lib.nie_match_simulate_json_out(ptr(cHome), ptr(cAway), BigInt(seed), ptr(slot));
  return readAndFreeNieBytesJson<T>(lib, slot);
}

/**
 * Queries the Rust wiki SQLite mirror.
 */
export function nieQueryWiki<T = any>(request: any): T | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  const inputBytes = textEncoder.encode(JSON.stringify(request));
  lib.nie_wiki_json_out(ptr(inputBytes), inputBytes.length, ptr(slot));
  return readAndFreeNieBytesJson<T>(lib, slot);
}

/**
 * Returns the emulation capability registry JSON.
 */
export function nieEmuRegistry<T = any>(): T | null {
  const lib = getNativeLib();
  if (!lib) return null;
  const slot = new Uint8Array(24);
  lib.nie_emu_registry_json_out(ptr(slot));
  return readAndFreeNieBytesJson<T>(lib, slot);
}

// ============================================================================
// OOP Handles: CRand & VFS
// ============================================================================

/**
 * Safe handle for the game's MT19937 PRNG (CRand).
 * Transparently falls back to PureCrand when native libiecode is not loaded.
 */
export class NieCrandHandle {
  #handle: any = null;
  #lib: any = null;
  #fallback: PureCrand | null = null;

  constructor(seed: number | bigint) {
    const lib = getNativeLib();
    if (!lib) {
      this.#fallback = PureCrand.fromU64(seed);
      return;
    }
    this.#lib = lib;
    if (typeof seed === "bigint") {
      this.#handle = lib.nie_crand_from_u64(seed);
    } else {
      this.#handle = lib.nie_crand_new(seed >>> 0);
    }
  }

  nextU32(): number {
    if (this.#fallback) return this.#fallback.nextU32();
    if (!this.#handle) throw new Error("CRand handle has been disposed.");
    return this.#lib.nie_crand_next_u32(this.#handle) >>> 0;
  }

  bounded(bound: number): number {
    if (this.#fallback) return this.#fallback.bounded(bound);
    if (!this.#handle) throw new Error("CRand handle has been disposed.");
    return this.#lib.nie_crand_bounded(this.#handle, bound >>> 0) >>> 0;
  }

  nextF32(): number {
    if (this.#fallback) return this.#fallback.nextF32();
    if (!this.#handle) throw new Error("CRand handle has been disposed.");
    return this.#lib.nie_crand_next_f32(this.#handle);
  }

  close(): void {
    if (this.#fallback) {
      this.#fallback = null;
      return;
    }
    if (this.#handle) {
      this.#lib.nie_crand_free(this.#handle);
      this.#handle = null;
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/** Shared Rust discovery; no directory traversal or network mount is performed here. */
export function locateGameSource(hint?: string): {
  source: string;
  remote: boolean;
  discovery_ms: number;
} {
  const path = resolveNativeLibPath();
  if (!path) throw new Error("Native libiecode is required for shared game discovery.");
  const library = dlopen(path, {
    nie_game_source_resolve_out: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    nie_last_error_out: { args: [FFIType.ptr], returns: FFIType.void },
    nie_bytes_free_fields: { args: [FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.void },
  });
  try {
    const source = toCString(hint ?? "");
    const slot = new Uint8Array(24);
    library.symbols.nie_game_source_resolve_out(ptr(source), ptr(slot));
    const result = readAndFreeNieBytesJson<{
      source: string;
      remote: boolean;
      discovery_ms: number;
    }>(library.symbols, slot);
    if (result) return result;
    library.symbols.nie_last_error_out(ptr(slot));
    const error = readAndFreeNieBytes(library.symbols, slot);
    throw new Error(error ? new TextDecoder().decode(error) : "Game source not found.");
  } finally {
    library.close();
  }
}

/** Safe handle for local, HTTP Range or native SFTP game sources. */
export class NieVfsHandle {
  #handle: any;
  #lib: any;

  constructor(gameDataDir = "") {
    const lib = getNativeLib();
    if (!lib) {
      throw new Error("Cannot open NieVfsHandle without native libiecode.");
    }
    this.#lib = lib;
    const cDir = toCString(gameDataDir);
    this.#handle = lib.nie_vfs_open(ptr(cDir));
    if (!this.#handle) {
      throw new Error(`Failed to mount VFS from ${gameDataDir}`);
    }
  }

  /** Query typed game records through the native domain owner, without SQL or dumps. */
  query<T = Record<string, unknown>>(request: {
    domain: string;
    query?: string;
    offset?: number;
    limit?: number;
  }): {
    source: string;
    domain: string;
    total: number;
    matched: number;
    offset: number;
    items: T[];
  } {
    if (!this.#handle) throw new Error("Vfs handle has been disposed.");
    const path = resolveNativeLibPath();
    if (!path) throw new Error("Native libiecode is required for VFS domain queries.");
    const library = dlopen(path, {
      nie_vfs_query_json_out: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
        returns: FFIType.void,
      },
      nie_bytes_free_fields: {
        args: [FFIType.u64, FFIType.u64, FFIType.u64],
        returns: FFIType.void,
      },
    });
    try {
      const input = new TextEncoder().encode(JSON.stringify(request));
      const slot = new Uint8Array(24);
      library.symbols.nie_vfs_query_json_out(this.#handle, ptr(input), input.length, ptr(slot));
      const result = readAndFreeNieBytesJson<any>(library.symbols, slot);
      if (!result || result.error)
        throw new Error(result?.error ?? `Native VFS ${request.domain} query failed.`);
      return result;
    } finally {
      library.close();
    }
  }

  read(internalPath: string): Uint8Array | null {
    if (!this.#handle) throw new Error("Vfs handle has been disposed.");
    const slot = new Uint8Array(24);
    const cPath = toCString(internalPath);
    this.#lib.nie_vfs_read_out(this.#handle, ptr(cPath), ptr(slot));
    return readAndFreeNieBytes(this.#lib, slot);
  }

  fileInfo(internalPath: string): NieVfsFileInfo | null {
    if (!this.#handle) throw new Error("Vfs handle has been disposed.");
    const slot = new Uint8Array(24);
    const cPath = toCString(internalPath);
    this.#lib.nie_vfs_file_info_json_out(this.#handle, ptr(cPath), ptr(slot));
    return readAndFreeNieBytesJson<NieVfsFileInfo>(this.#lib, slot);
  }

  count(): bigint {
    if (!this.#handle) throw new Error("Vfs handle has been disposed.");
    return BigInt(this.#lib.nie_vfs_count(this.#handle));
  }

  isReadable(internalPath: string): boolean {
    if (!this.#handle) throw new Error("Vfs handle has been disposed.");
    const cPath = toCString(internalPath);
    return this.#lib.nie_vfs_is_readable(this.#handle, ptr(cPath)) === 1;
  }

  list(limit = 1000): any[] {
    if (!this.#handle) throw new Error("Vfs handle has been disposed.");
    return this.listRange(0, limit);
  }

  listRange(offset: number | bigint, limit: number | bigint): any[] {
    if (!this.#handle) throw new Error("Vfs handle has been disposed.");
    const slot = new Uint8Array(24);
    this.#lib.nie_vfs_list_range_json_out(this.#handle, BigInt(offset), BigInt(limit), ptr(slot));
    return readAndFreeNieBytesJson<any[]>(this.#lib, slot) ?? [];
  }

  close(): void {
    if (this.#handle) {
      this.#lib.nie_vfs_free(this.#handle);
      this.#handle = null;
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/**
 * Format descriptor returned by native C-ABI.
 */
export interface NieFormatDescriptor {
  id: number;
  name: string;
  magic_hex: string;
  magic_ascii: string;
  extension: string;
  mime_type: string;
  category: string;
  is_big_endian: boolean;
  encryption_supported: boolean;
  compression_supported: boolean;
  description: string;
}

/**
 * Detects the binary format ID (1..28) of a byte buffer using native libiecode.
 */
export function nieFormatDetect(data: Uint8Array): number {
  const lib = getNativeLib();
  if (!lib || data.length === 0) return 0;
  return Number(lib.nie_detect(ptr(data), BigInt(data.length)));
}

/**
 * Returns the canonical file extension for a format ID.
 */
export function nieFormatExtension(formatId: number): string {
  const lib = getNativeLib();
  if (!lib) return ".bin";
  return lib.nie_format_extension(formatId) ?? ".bin";
}

/**
 * Returns the MIME type for a format ID.
 */
export function nieFormatMimeType(formatId: number): string {
  const lib = getNativeLib();
  if (!lib) return "application/octet-stream";
  return lib.nie_format_mime_type(formatId) ?? "application/octet-stream";
}

/**
 * Returns the category for a format ID.
 */
export function nieFormatCategory(formatId: number): string {
  const lib = getNativeLib();
  if (!lib) return "system";
  return lib.nie_format_category(formatId) ?? "system";
}

/**
 * Returns whether the format is Big-Endian.
 */
export function nieFormatIsBigEndian(formatId: number): boolean {
  const lib = getNativeLib();
  if (!lib) return false;
  return Boolean(lib.nie_format_is_big_endian(formatId));
}

/**
 * Returns whether the format supports encryption.
 */
export function nieFormatSupportsEncryption(formatId: number): boolean {
  const lib = getNativeLib();
  if (!lib) return false;
  return Boolean(lib.nie_format_supports_encryption(formatId));
}

/**
 * Returns whether the format supports compression.
 */
export function nieFormatSupportsCompression(formatId: number): boolean {
  const lib = getNativeLib();
  if (!lib) return false;
  return Boolean(lib.nie_format_supports_compression(formatId));
}

/**
 * Returns total count of canonical VFS formats (28).
 */
export function nieFormatCount(): number {
  const lib = getNativeLib();
  if (!lib) return 28;
  return Number(lib.nie_format_count());
}

/**
 * Returns the complete VFS formats catalog as JSON DTOs from native libiecode.
 */
export function nieFormatCatalog(): NieFormatDescriptor[] {
  const lib = getNativeLib();
  if (!lib) return [];
  const slot = new Uint8Array(24);
  lib.nie_format_catalog_json_out(ptr(slot));
  return readAndFreeNieBytesJson<NieFormatDescriptor[]>(lib, slot) ?? [];
}
