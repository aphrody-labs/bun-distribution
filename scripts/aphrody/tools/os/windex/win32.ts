// SPDX-License-Identifier: Apache-2.0
// Minimal Win32 bindings through bun:ffi (kernel32, advapi32, wintrust), loaded lazily so that the pure modules and
// their tests import on every platform. Every handle is closed by its owner; no elevation is attempted here.
import { dlopen, ptr, type Pointer } from "bun:ffi";

export const isWindows = process.platform === "win32";

/** NUL-terminated UTF-16LE buffer for a `LPCWSTR` argument. */
export function wstr(s: string): Buffer {
  return Buffer.from(`${s}\0`, "utf16le");
}

/** Reads a NUL-terminated UTF-16LE string from `buf` starting at `offset` (at most `maxChars`). */
export function readWstr(buf: Uint8Array, offset = 0, maxChars = buf.length / 2): string {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = offset;
  const limit = Math.min(buf.byteLength, offset + maxChars * 2);
  while (end + 1 < limit && view.getUint16(end, true) !== 0) end += 2;
  return Buffer.from(buf.buffer, buf.byteOffset + offset, end - offset).toString("utf16le");
}

const k32Symbols = {
  CreateFileW: {
    args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"],
    returns: "ptr",
  },
  CloseHandle: { args: ["ptr"], returns: "i32" },
  DeviceIoControl: {
    args: ["ptr", "u32", "ptr", "u32", "ptr", "u32", "ptr", "ptr"],
    returns: "i32",
  },
  GetLastError: { args: [], returns: "u32" },
  FindFirstStreamW: { args: ["ptr", "i32", "ptr", "u32"], returns: "ptr" },
  FindNextStreamW: { args: ["ptr", "ptr"], returns: "i32" },
  FindClose: { args: ["ptr"], returns: "i32" },
  GetFileAttributesW: { args: ["ptr"], returns: "u32" },
  GetVolumeInformationW: {
    args: ["ptr", "ptr", "u32", "ptr", "ptr", "ptr", "ptr", "u32"],
    returns: "i32",
  },
} as const;

const advSymbols = {
  RegOpenKeyExW: { args: ["u64", "ptr", "u32", "u32", "ptr"], returns: "i32" },
  RegEnumKeyExW: {
    args: ["u64", "u32", "ptr", "ptr", "ptr", "ptr", "ptr", "ptr"],
    returns: "i32",
  },
  RegQueryValueExW: {
    args: ["u64", "ptr", "ptr", "ptr", "ptr", "ptr"],
    returns: "i32",
  },
  RegCloseKey: { args: ["u64"], returns: "i32" },
} as const;

const wintrustSymbols = {
  CryptCATAdminAcquireContext2: {
    args: ["ptr", "ptr", "ptr", "ptr", "u32"],
    returns: "i32",
  },
  CryptCATAdminReleaseContext: { args: ["ptr", "u32"], returns: "i32" },
  CryptCATAdminCalcHashFromFileHandle2: {
    args: ["ptr", "ptr", "ptr", "ptr", "u32"],
    returns: "i32",
  },
  CryptCATAdminEnumCatalogFromHash: {
    args: ["ptr", "ptr", "u32", "u32", "ptr"],
    returns: "ptr",
  },
  CryptCATCatalogInfoFromContext: {
    args: ["ptr", "ptr", "u32"],
    returns: "i32",
  },
  CryptCATAdminReleaseCatalogContext: {
    args: ["ptr", "ptr", "u32"],
    returns: "i32",
  },
} as const;

type K32 = ReturnType<typeof dlopen<typeof k32Symbols>>["symbols"];
type Adv = ReturnType<typeof dlopen<typeof advSymbols>>["symbols"];
type WinTrust = ReturnType<typeof dlopen<typeof wintrustSymbols>>["symbols"];

let k32Lib: K32 | undefined;
let advLib: Adv | undefined;
let trustLib: WinTrust | null | undefined;

export function k32(): K32 {
  if (!isWindows) throw new Error("kernel32 n'existe que sous Windows");
  k32Lib ??= dlopen("kernel32.dll", k32Symbols).symbols;
  return k32Lib;
}

export function advapi(): Adv {
  if (!isWindows) throw new Error("advapi32 n'existe que sous Windows");
  advLib ??= dlopen("advapi32.dll", advSymbols).symbols;
  return advLib;
}

/** wintrust.dll, or null when it cannot be loaded (catalog lookups are then skipped, never faked). */
export function wintrust(): WinTrust | null {
  if (trustLib !== undefined) return trustLib;
  try {
    trustLib = isWindows ? dlopen("wintrust.dll", wintrustSymbols).symbols : null;
  } catch {
    trustLib = null;
  }
  return trustLib;
}

export const GENERIC_READ = 0x8000_0000;
export const FILE_READ_ATTRIBUTES = 0x80;
export const FILE_SHARE_ALL = 0x1 | 0x2 | 0x4;
export const OPEN_EXISTING = 3;
export const FILE_FLAG_BACKUP_SEMANTICS = 0x0200_0000;
export const INVALID_FILE_ATTRIBUTES = 0xffff_ffff;

/** A pointer-typed handle return is invalid when null/0 or `INVALID_HANDLE_VALUE` (all bits set). */
export function validHandle(h: Pointer | bigint | null): h is Pointer {
  return typeof h === "number" && h !== 0 && h < 2 ** 52;
}

/** Opens a file or volume; returns the handle or the Win32 error code. */
export function openHandle(
  path: string,
  access = GENERIC_READ,
  flags = FILE_FLAG_BACKUP_SEMANTICS,
): { handle: Pointer } | { error: number } {
  const lib = k32();
  const h = lib.CreateFileW(wstr(path), access, FILE_SHARE_ALL, null, OPEN_EXISTING, flags, null);
  if (!validHandle(h)) return { error: lib.GetLastError() };
  return { handle: h };
}

export function closeHandle(h: Pointer): void {
  k32().CloseHandle(h);
}

/** `DeviceIoControl` wrapper: returns the bytes written or the Win32 error code. */
export function ioctl(
  handle: Pointer,
  code: number,
  input: Uint8Array | null,
  output: Uint8Array,
): { bytes: number } | { error: number } {
  const lib = k32();
  const returned = new Uint32Array(1);
  const ok = lib.DeviceIoControl(
    handle,
    code,
    input,
    input?.byteLength ?? 0,
    output,
    output.byteLength,
    returned,
    null,
  );
  if (!ok) return { error: lib.GetLastError() };
  return { bytes: returned[0]! };
}

/** `GetFileAttributesW`; undefined when the path cannot be queried. */
export function fileAttributes(path: string): number | undefined {
  const a = k32().GetFileAttributesW(wstr(path));
  return a === INVALID_FILE_ATTRIBUTES ? undefined : a;
}

/** Volume serial number of `C:\` style roots, as 8 hex digits. */
export function volumeSerial(root: string): string | undefined {
  const serial = new Uint32Array(1);
  const ok = k32().GetVolumeInformationW(wstr(root), null, 0, serial, null, null, null, 0);
  return ok ? serial[0]!.toString(16).padStart(8, "0") : undefined;
}

export type Stream = { name: string; size: number };

/** Alternate data streams of a file (the unnamed `::$DATA` stream excluded). */
export function alternateStreams(path: string): Stream[] {
  const lib = k32();
  // WIN32_FIND_STREAM_DATA: LARGE_INTEGER StreamSize + WCHAR cStreamName[MAX_PATH + 36].
  const data = new Uint8Array(8 + 2 * (260 + 36));
  const view = new DataView(data.buffer);
  const h = lib.FindFirstStreamW(wstr(path), 0, data, 0);
  if (!validHandle(h)) return [];
  const out: Stream[] = [];
  try {
    do {
      const name = readWstr(data, 8, 296);
      if (name !== "::$DATA") {
        out.push({
          name: name.replace(/:\$DATA$/, "").replace(/^:/, ""),
          size: Number(view.getBigInt64(0, true)),
        });
      }
    } while (lib.FindNextStreamW(h, data));
  } finally {
    lib.FindClose(h);
  }
  return out;
}

export { ptr, type Pointer };
