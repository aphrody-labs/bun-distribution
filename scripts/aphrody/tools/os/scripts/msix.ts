// SPDX-License-Identifier: Apache-2.0
/**
 * Installed MSIX packages of the current user, read natively from the AppModel package repository
 * (`HKCU\Software\Classes\Local Settings\...\AppModel\Repository\Packages`, advapi32 through
 * bun:ffi): no PowerShell `Get-AppxPackage`, no child process, no window.
 */
import { dlopen, FFIType } from "bun:ffi";
import { existsSync } from "node:fs";

export interface MsixPackage {
  /** Package name, e.g. `OpenAI.Codex`. */
  name: string;
  version: string;
  architecture: string;
  /** `<name>_<publisherId>`, the directory name under `%LOCALAPPDATA%\Packages`. */
  family: string;
  fullName: string;
  installLocation: string;
}

const REPOSITORY =
  "Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages";
const HKEY_CURRENT_USER = 0xffff_ffff_8000_0001n;
const KEY_READ = 0x2_0019;
const RRF_RT_REG_SZ = 0x2;
const ERROR_SUCCESS = 0;
const ERROR_NO_MORE_ITEMS = 259;
const ERROR_MORE_DATA = 234;

function wide(text: string): Buffer {
  return Buffer.from(`${text}\0`, "utf16le");
}

function narrow(buffer: Buffer, chars: number): string {
  return buffer.toString("utf16le", 0, chars * 2);
}

/** Parse `Name_Version_Arch_ResourceId_PublisherId`; `undefined` for other key names. */
export function parsePackageFullName(
  fullName: string,
): Omit<MsixPackage, "installLocation"> | undefined {
  const parts = fullName.split("_");
  if (parts.length !== 5) return undefined;
  const [name, version, architecture, , publisherId] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!name || !/^\d+(\.\d+){3}$/.test(version) || !publisherId) return undefined;
  return { name, version, architecture, family: `${name}_${publisherId}`, fullName };
}

/** Numeric comparison of dotted versions (`26.930.7945.0`). */
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** Every package registered for the current user. Empty off Windows. */
export function listMsixPackages(): MsixPackage[] {
  if (process.platform !== "win32") return [];
  const advapi = dlopen("advapi32.dll", {
    RegOpenKeyExW: {
      args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    RegEnumKeyExW: {
      args: [
        FFIType.u64,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.i32,
    },
    RegGetValueW: {
      args: [
        FFIType.u64,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
      ],
      returns: FFIType.i32,
    },
    RegCloseKey: { args: [FFIType.u64], returns: FFIType.i32 },
  });
  const { RegOpenKeyExW, RegEnumKeyExW, RegGetValueW, RegCloseKey } = advapi.symbols;
  const handle = new BigUint64Array(1);
  const opened = RegOpenKeyExW(HKEY_CURRENT_USER, wide(REPOSITORY), 0, KEY_READ, handle);
  if (opened !== ERROR_SUCCESS) {
    advapi.close();
    return [];
  }
  const key = handle[0] as bigint;
  const packages: MsixPackage[] = [];
  const valueName = wide("PackageRootFolder");
  try {
    for (let index = 0; ; index += 1) {
      const name = Buffer.alloc(512 * 2);
      const length = new Uint32Array([512]);
      const status = RegEnumKeyExW(key, index, name, length, null, null, null, null);
      if (status === ERROR_NO_MORE_ITEMS) break;
      if (status !== ERROR_SUCCESS) continue;
      const fullName = narrow(name, length[0] as number);
      const identity = parsePackageFullName(fullName);
      if (!identity) continue;
      let size = new Uint32Array([1024]);
      let value = Buffer.alloc(size[0] as number);
      let read = RegGetValueW(key, wide(fullName), valueName, RRF_RT_REG_SZ, null, value, size);
      if (read === ERROR_MORE_DATA) {
        value = Buffer.alloc(size[0] as number);
        size = new Uint32Array([value.length]);
        read = RegGetValueW(key, wide(fullName), valueName, RRF_RT_REG_SZ, null, value, size);
      }
      if (read !== ERROR_SUCCESS) continue;
      const installLocation = value
        .toString("utf16le", 0, (size[0] as number) - 2)
        .replace(/\0+$/, "");
      packages.push({ ...identity, installLocation });
    }
  } finally {
    RegCloseKey(key);
    advapi.close();
  }
  return packages;
}

/** The highest installed version of `name` whose install directory exists, or `undefined`. */
export function findMsixPackage(name: string): MsixPackage | undefined {
  return listMsixPackages()
    .filter((pkg) => pkg.name === name && existsSync(pkg.installLocation))
    .toSorted((left, right) => compareVersions(right.version, left.version))[0];
}
