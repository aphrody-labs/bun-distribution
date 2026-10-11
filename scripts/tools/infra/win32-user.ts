// SPDX-License-Identifier: Apache-2.0
/**
 * Win32 user-scope primitives through bun:ffi, without PowerShell, `setx` or `icacls`:
 * persistent user environment (`HKCU\Environment` + `WM_SETTINGCHANGE` broadcast, the same
 * contract as `aphrody self install-path`) and owner-only protected DACLs bound to the SID of
 * the current token. Windows x64/arm64 only.
 */
import { dlopen, FFIType, ptr, read, type Pointer } from "bun:ffi";

/** `HKEY_CURRENT_USER`, sign-extended like the `(HKEY)(LONG)0x80000001` of the SDK headers. */
const HKEY_CURRENT_USER = -2147483647n;
const REG_SZ = 1;
const RRF_RT_REG_SZ = 0x2;
const ERROR_FILE_NOT_FOUND = 2;
const HWND_BROADCAST = 0xffffn;
const WM_SETTINGCHANGE = 0x1a;
const SMTO_ABORTIFHUNG = 0x2;
const SE_FILE_OBJECT = 1;
const DACL_SECURITY_INFORMATION = 0x4;
const PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
const SDDL_REVISION_1 = 1;
const TOKEN_QUERY = 0x8;
const TOKEN_USER = 1;
/** `GetCurrentProcess()` pseudo-handle. */
const CURRENT_PROCESS = -1n;

const ENVIRONMENT = "Environment";

const openAdvapi32 = () =>
  dlopen("advapi32.dll", {
    RegSetKeyValueW: {
      args: [FFIType.i64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
    RegGetValueW: {
      args: [
        FFIType.i64,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.i32,
    },
    RegDeleteKeyValueW: { args: [FFIType.i64, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    RegDeleteKeyW: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
    OpenProcessToken: { args: [FFIType.i64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    GetTokenInformation: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    ConvertSidToStringSidW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    ConvertStringSecurityDescriptorToSecurityDescriptorW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    ConvertSecurityDescriptorToStringSecurityDescriptorW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    GetSecurityDescriptorDacl: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    SetNamedSecurityInfoW: {
      args: [
        FFIType.ptr,
        FFIType.i32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.u32,
    },
    GetNamedSecurityInfoW: {
      args: [
        FFIType.ptr,
        FFIType.i32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.u32,
    },
  }).symbols;

const openKernel32 = () =>
  dlopen("kernel32.dll", {
    LocalFree: { args: [FFIType.ptr], returns: FFIType.ptr },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
  }).symbols;

const openUser32 = () =>
  dlopen("user32.dll", {
    SendMessageTimeoutW: {
      args: [
        FFIType.u64,
        FFIType.u32,
        FFIType.u64,
        FFIType.ptr,
        FFIType.u32,
        FFIType.u32,
        FFIType.ptr,
      ],
      returns: FFIType.i64,
    },
  }).symbols;

let advapi32: ReturnType<typeof openAdvapi32> | undefined;
let kernel32: ReturnType<typeof openKernel32> | undefined;
let user32: ReturnType<typeof openUser32> | undefined;

const api = () => (advapi32 ??= openAdvapi32());
const kernel = () => (kernel32 ??= openKernel32());

/** NUL-terminated UTF-16LE copy of a string, kept alive by the caller for the call. */
export function wide(text: string): Buffer {
  return Buffer.from(`${text}\0`, "utf16le");
}

/** Reads the NUL-terminated UTF-16 string at a native address. */
function wideAt(address: Pointer): string {
  const units: number[] = [];
  for (let offset = 0; ; offset += 2) {
    const unit = read.u16(address, offset);
    if (unit === 0) return String.fromCharCode(...units);
    units.push(unit);
  }
}

/** Address stored in an out-parameter slot. */
function slot(cell: BigUint64Array): Pointer {
  return Number(cell[0]!) as Pointer;
}

/** Writes REG_SZ values under `HKCU\<subKey>` (created when missing). */
export function setUserValues(subKey: string, values: Record<string, string>): void {
  const key = wide(subKey);
  for (const [name, value] of Object.entries(values)) {
    if (!name || name.includes("=")) throw new Error(`nom de variable invalide : ${name}`);
    const data = wide(value);
    const status = api().RegSetKeyValueW(
      HKEY_CURRENT_USER,
      ptr(key),
      ptr(wide(name)),
      REG_SZ,
      ptr(data),
      data.byteLength,
    );
    if (status !== 0) throw new Error(`RegSetKeyValueW(HKCU\\${subKey}\\${name}) : ${status}`);
  }
}

/** Reads one string value under `HKCU\<subKey>`; `null` when the value does not exist. */
export function userValue(subKey: string, name: string): string | null {
  const key = wide(subKey);
  const value = wide(name);
  const size = new Uint32Array(1);
  const probe = api().RegGetValueW(
    HKEY_CURRENT_USER,
    ptr(key),
    ptr(value),
    RRF_RT_REG_SZ,
    null,
    null,
    ptr(size),
  );
  if (probe === ERROR_FILE_NOT_FOUND) return null;
  if (probe !== 0) throw new Error(`RegGetValueW(HKCU\\${subKey}\\${name}) : ${probe}`);
  const data = new Uint8Array(size[0]!);
  const status = api().RegGetValueW(
    HKEY_CURRENT_USER,
    ptr(key),
    ptr(value),
    RRF_RT_REG_SZ,
    null,
    ptr(data),
    ptr(size),
  );
  if (status !== 0) throw new Error(`RegGetValueW(HKCU\\${subKey}\\${name}) : ${status}`);
  return Buffer.from(data.buffer, 0, Math.max(0, size[0]! - 2)).toString("utf16le");
}

/** Removes values under `HKCU\<subKey>`; absent values are not an error. */
export function deleteUserValues(subKey: string, names: string[]): void {
  const key = wide(subKey);
  for (const name of names) {
    const status = api().RegDeleteKeyValueW(HKEY_CURRENT_USER, ptr(key), ptr(wide(name)));
    if (status !== 0 && status !== ERROR_FILE_NOT_FOUND)
      throw new Error(`RegDeleteKeyValueW(HKCU\\${subKey}\\${name}) : ${status}`);
  }
}

/** Deletes an `HKCU` key that has no subkeys (its values go with it). */
export function deleteUserKey(subKey: string): void {
  const status = api().RegDeleteKeyW(HKEY_CURRENT_USER, ptr(wide(subKey)));
  if (status !== 0 && status !== ERROR_FILE_NOT_FOUND)
    throw new Error(`RegDeleteKeyW(HKCU\\${subKey}) : ${status}`);
}

/** Tells Explorer and the shells it starts that the user environment changed. */
export function broadcastEnvironmentChange(): void {
  const result = new BigUint64Array(1);
  (user32 ??= openUser32()).SendMessageTimeoutW(
    HWND_BROADCAST,
    WM_SETTINGCHANGE,
    0n,
    ptr(wide(ENVIRONMENT)),
    SMTO_ABORTIFHUNG,
    5000,
    ptr(result),
  );
}

/** Persists user environment variables for new processes (`HKCU\Environment`, REG_SZ). */
export function setUserEnvironment(values: Record<string, string>): void {
  setUserValues(ENVIRONMENT, values);
  broadcastEnvironmentChange();
}

/** Removes persistent user environment variables. */
export function removeUserEnvironment(names: string[]): void {
  deleteUserValues(ENVIRONMENT, names);
  broadcastEnvironmentChange();
}

/** Persistent user environment variable, `null` when unset. */
export function userEnvironment(name: string): string | null {
  return userValue(ENVIRONMENT, name);
}

/** String SID of the user of the current process token. */
export function currentUserSid(): string {
  const token = new BigUint64Array(1);
  if (!api().OpenProcessToken(CURRENT_PROCESS, TOKEN_QUERY, ptr(token)))
    throw new Error(`OpenProcessToken : ${kernel().GetLastError()}`);
  const handle = slot(token);
  try {
    const size = new Uint32Array(1);
    api().GetTokenInformation(handle, TOKEN_USER, null, 0, ptr(size));
    const info = new BigUint64Array(Math.ceil(size[0]! / 8));
    if (!api().GetTokenInformation(handle, TOKEN_USER, ptr(info), size[0]!, ptr(size)))
      throw new Error(`GetTokenInformation : ${kernel().GetLastError()}`);
    // TOKEN_USER { SID_AND_ATTRIBUTES { PSID Sid; DWORD Attributes } }
    const text = new BigUint64Array(1);
    if (!api().ConvertSidToStringSidW(slot(info), ptr(text)))
      throw new Error(`ConvertSidToStringSidW : ${kernel().GetLastError()}`);
    try {
      return wideAt(slot(text));
    } finally {
      kernel().LocalFree(slot(text));
    }
  } finally {
    kernel().CloseHandle(handle);
  }
}

/** Protected DACL granting full control to one SID only, inherited by children of a directory. */
export function ownerOnlySddl(sid: string, directory: boolean): string {
  if (!/^S-1-(?:\d+-)*\d+$/.test(sid)) throw new Error(`SID invalide : ${sid}`);
  return `D:P(A;${directory ? "OICI" : ""};FA;;;${sid})`;
}

/**
 * Replaces the DACL of a file or directory with a protected one that only grants the current
 * user full control: inherited entries are dropped, nothing else (SYSTEM, Administrators) keeps
 * access. Same effect as `icacls /inheritance:r /grant:r <user>:F`.
 */
export function restrictToCurrentUser(path: string, directory: boolean): string {
  const sddl = ownerOnlySddl(currentUserSid(), directory);
  const descriptor = new BigUint64Array(1);
  if (
    !api().ConvertStringSecurityDescriptorToSecurityDescriptorW(
      ptr(wide(sddl)),
      SDDL_REVISION_1,
      ptr(descriptor),
      null,
    )
  )
    throw new Error(
      `ConvertStringSecurityDescriptorToSecurityDescriptorW : ${kernel().GetLastError()}`,
    );
  try {
    const present = new Int32Array(1);
    const defaulted = new Int32Array(1);
    const dacl = new BigUint64Array(1);
    if (
      !api().GetSecurityDescriptorDacl(slot(descriptor), ptr(present), ptr(dacl), ptr(defaulted)) ||
      !present[0]
    )
      throw new Error("GetSecurityDescriptorDacl");
    const status = api().SetNamedSecurityInfoW(
      ptr(wide(path)),
      SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
      null,
      null,
      slot(dacl),
      null,
    );
    if (status !== 0) throw new Error(`SetNamedSecurityInfoW(${path}) : ${status}`);
    return sddl;
  } finally {
    kernel().LocalFree(slot(descriptor));
  }
}

/** Current DACL of a file or directory in SDDL (`D:...`). */
export function daclSddl(path: string): string {
  const descriptor = new BigUint64Array(1);
  const status = api().GetNamedSecurityInfoW(
    ptr(wide(path)),
    SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION,
    null,
    null,
    null,
    null,
    ptr(descriptor),
  );
  if (status !== 0) throw new Error(`GetNamedSecurityInfoW(${path}) : ${status}`);
  try {
    const text = new BigUint64Array(1);
    if (
      !api().ConvertSecurityDescriptorToStringSecurityDescriptorW(
        slot(descriptor),
        SDDL_REVISION_1,
        DACL_SECURITY_INFORMATION,
        ptr(text),
        null,
      )
    )
      throw new Error(
        `ConvertSecurityDescriptorToStringSecurityDescriptorW : ${kernel().GetLastError()}`,
      );
    try {
      return wideAt(slot(text));
    } finally {
      kernel().LocalFree(slot(text));
    }
  } finally {
    kernel().LocalFree(slot(descriptor));
  }
}
