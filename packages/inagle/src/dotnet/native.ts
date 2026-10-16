/**
 * @file native.ts
 * @description Low-level Bun FFI bindings for IECODE.Ffi NativeAOT shared library.
 */

import { FFIType, ptr, suffix, type Pointer } from "bun:ffi";
import { resolve } from "node:path";
import { nativeLibrary, readNativeBytes } from "@aphrody/runtime-sdk/ffi";
import {
  type DetectedFormat,
  type DotnetBridgeStatus,
  FORMAT_ID_MAP,
  type IDotnetBridge,
} from "./types.js";

const IECODE_FFI_SYMBOLS = {
  iecode_core_version: { args: [], returns: FFIType.cstring },
  iecode_ffi_schema: { args: [], returns: FFIType.cstring },
  iecode_status: { args: [], returns: FFIType.i32 },
  iecode_level5_crc32: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.u32 },
  iecode_format_detect: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  iecode_cpk_decrypt_block: {
    args: [FFIType.ptr, FFIType.i32, FFIType.u64, FFIType.u64],
    returns: FFIType.i32,
  },
  iecode_crilayla_compress: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  iecode_crilayla_decompress: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  iecode_rdbn_is_valid: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  iecode_bytes_free: { args: [FFIType.ptr], returns: FFIType.void },
} as const;

function managedRuntimeIdentifier(): string | undefined {
  const operatingSystem =
    process.platform === "win32"
      ? "win"
      : process.platform === "linux"
        ? "linux"
        : process.platform === "darwin"
          ? "osx"
          : undefined;
  if (!operatingSystem || (process.arch !== "x64" && process.arch !== "arm64")) return undefined;
  return `${operatingSystem}-${process.arch}`;
}

function dotnetLibrary(path?: string) {
  const dir = import.meta.dir;
  const cwd = process.cwd();
  const publish = "src/IECODE/Ffi/bin/Release/net10.0";
  const rid = managedRuntimeIdentifier();
  return nativeLibrary({
    name: "IECODE.Ffi",
    fileNames: [`IECODE.Ffi.${suffix}`, "IECODE.Ffi.node"],
    ...(path ? { path } : {}),
    envPaths: ["IECODE_FFI_PATH", "IECODE_CORE_NATIVE_PATH"],
    symbols: IECODE_FFI_SYMBOLS,
    searchDirs: [
      ...(rid
        ? [
            resolve(dir, "../../../..", publish, rid, "publish"),
            resolve(cwd, publish, rid, "publish"),
          ]
        : []),
      resolve(dir, "native"),
    ],
  });
}

/** Searches for the compiled NativeAOT IECODE.Ffi shared library across candidate locations. */
export function findNativeLibrary(): string | null {
  return dotnetLibrary().resolvePath();
}

type NativeSymbols = NonNullable<ReturnType<ReturnType<typeof dotnetLibrary>["load"]>>;

export class NativeDotnetBridge implements IDotnetBridge {
  private readonly _lib: { symbols: NativeSymbols };
  private readonly _status: DotnetBridgeStatus;
  private constructor(
    lib: { symbols: NativeSymbols },
    libraryPath: string,
    version: string,
    schema: string,
  ) {
    this._lib = lib;
    this._status = {
      available: true,
      mode: "native-aot",
      version,
      schema,
      libraryPath,
    };
  }

  public static tryLoad(libraryPath?: string): NativeDotnetBridge | null {
    // Bun only: bun:ffi is unavailable in other runtimes
    if (typeof Bun === "undefined" || !Bun.version) {
      return null;
    }
    const library = dotnetLibrary(libraryPath);
    const symbols = library.load();
    const path = library.libraryPath();
    if (!symbols || !path) {
      return null;
    }
    try {
      return new NativeDotnetBridge(
        { symbols },
        path,
        String(symbols.iecode_core_version()),
        String(symbols.iecode_ffi_schema()),
      );
    } catch {
      return null;
    }
  }

  public get status(): DotnetBridgeStatus {
    return this._status;
  }

  public isAvailable(): boolean {
    return true;
  }

  public computeLevel5Crc32(data: Uint8Array | string): number {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (bytes.length === 0) return 0;
    return this._lib.symbols.iecode_level5_crc32(ptr(bytes), bytes.length);
  }

  public detectFormat(data: Uint8Array): DetectedFormat {
    if (data.length === 0) {
      return { format: "Unknown", formatId: 0, name: "Empty", extension: "" };
    }
    const formatId = this._lib.symbols.iecode_format_detect(ptr(data), data.length);
    const meta = FORMAT_ID_MAP[formatId] || {
      format: "Unknown",
      name: "Unknown",
      extension: ".bin",
    };
    return {
      format: meta.format,
      formatId,
      name: meta.name,
      extension: meta.extension,
    };
  }

  public isCrilayla(data: Uint8Array): boolean {
    if (data.length < 16) return false;
    return (
      data[0] === 0x43 && // C
      data[1] === 0x52 && // R
      data[2] === 0x49 && // I
      data[3] === 0x4c && // L
      data[4] === 0x41 && // A
      data[5] === 0x59 && // Y
      data[6] === 0x4c && // L
      data[7] === 0x41 // A
    );
  }

  public decompressCrilayla(data: Uint8Array): Uint8Array {
    if (data.length < 16) {
      throw new Error(`CRILAYLA buffer too short: ${data.length} bytes (minimum 16 bytes).`);
    }

    const outPtrBuf = new BigUint64Array(1);
    const outLenBuf = new Int32Array(1);

    const code = this._lib.symbols.iecode_crilayla_decompress(
      ptr(data),
      data.length,
      ptr(outPtrBuf),
      ptr(outLenBuf),
    );

    if (code !== 0) {
      throw new Error(`Native CRILAYLA decompression failed with error code: ${code}`);
    }

    return readNativeBytes(outPtrBuf[0]!, outLenBuf[0]!, (address) =>
      this._lib.symbols.iecode_bytes_free(address as unknown as Pointer),
    );
  }

  public compressCrilayla(data: Uint8Array): Uint8Array {
    const outPtrBuf = new BigUint64Array(1);
    const outLenBuf = new Int32Array(1);

    const code = this._lib.symbols.iecode_crilayla_compress(
      ptr(data),
      data.length,
      ptr(outPtrBuf),
      ptr(outLenBuf),
    );

    if (code !== 0) {
      throw new Error(`Native CRILAYLA compression failed with error code: ${code}`);
    }

    return readNativeBytes(outPtrBuf[0]!, outLenBuf[0]!, (address) =>
      this._lib.symbols.iecode_bytes_free(address as unknown as Pointer),
    );
  }

  public decryptCpkBlock(
    data: Uint8Array,
    offset: bigint | number = 0n,
    key: bigint | number = 0x1717e18en,
  ): Uint8Array {
    const copy = new Uint8Array(data.length);
    copy.set(data);

    const bigOffset = typeof offset === "bigint" ? offset : BigInt(offset);
    const bigKey = typeof key === "bigint" ? key : BigInt(key);

    this._lib.symbols.iecode_cpk_decrypt_block(ptr(copy), copy.length, bigKey, bigOffset);

    return copy;
  }

  public isRdbn(data: Uint8Array): boolean {
    if (data.length < 4) return false;
    return this._lib.symbols.iecode_rdbn_is_valid(ptr(data), data.length) === 1;
  }
}
