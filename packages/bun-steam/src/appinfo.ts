// SPDX-License-Identifier: Apache-2.0
/** `appcache/appinfo.vdf` (PICS app info) and `appcache/packageinfo.vdf` readers. */
import { Cursor, type KvObject, parseBinaryKv } from "./vdf.js";

export const APPINFO_MAGIC = {
  v39: 0x07564427,
  v40: 0x07564428,
  v41: 0x07564429,
} as const;
export const PACKAGEINFO_MAGIC = { v39: 0x06565527, v40: 0x06565528 } as const;

export interface AppInfoEntry {
  appid: number;
  size: number;
  infoState: number;
  lastUpdated: number;
  picsToken: bigint;
  sha1: string;
  changeNumber: number;
  binarySha1: string | null;
  kv: KvObject;
}
export interface AppInfoFile {
  version: number;
  universe: number;
  apps: AppInfoEntry[];
  stringTable: number;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** Parses appinfo.vdf v39/v40/v41. Corrupt tails stop the scan without discarding earlier apps. */
export function parseAppInfo(bytes: Uint8Array): AppInfoFile {
  const cur = new Cursor(bytes);
  const magic = cur.u32();
  if (
    magic !== APPINFO_MAGIC.v39 &&
    magic !== APPINFO_MAGIC.v40 &&
    magic !== APPINFO_MAGIC.v41
  ) {
    throw new Error(`appinfo.vdf: unknown magic 0x${magic.toString(16)}`);
  }
  const universe = cur.u32();
  let stringTable: string[] | null = null;
  if (magic === APPINFO_MAGIC.v41) {
    const offset = Number(cur.u64());
    if (
      !Number.isSafeInteger(offset) ||
      offset < cur.pos ||
      offset > bytes.byteLength - 4
    ) {
      throw new Error("appinfo.vdf: invalid string-table offset");
    }
    const tc = new Cursor(bytes);
    tc.pos = offset;
    const count = tc.u32();
    if (count > tc.remaining)
      throw new Error("appinfo.vdf: invalid string-table count");
    stringTable = [];
    for (let i = 0; i < count; i++) stringTable.push(tc.cstr());
  }
  const apps: AppInfoEntry[] = [];
  const end = stringTable
    ? Number(
        new DataView(bytes.buffer, bytes.byteOffset + 8, 8).getBigUint64(
          0,
          true,
        ),
      )
    : bytes.length;
  while (cur.pos + 4 <= end) {
    let appid: number;
    let size: number;
    try {
      appid = cur.u32();
    } catch {
      break;
    }
    if (appid === 0) break;
    try {
      size = cur.u32();
    } catch {
      break;
    }
    const entryStart = cur.pos;
    const entryEnd = entryStart + size;
    if (!Number.isSafeInteger(entryEnd) || size <= 0 || entryEnd > end) break;
    const entry = new Cursor(bytes, entryEnd);
    entry.pos = entryStart;
    let parsed: Omit<AppInfoEntry, "appid" | "size">;
    try {
      const infoState = entry.u32();
      const lastUpdated = entry.u32();
      const picsToken = entry.u64();
      const sha1 = hex(entry.take(20));
      const changeNumber = entry.u32();
      const binarySha1 =
        magic >= APPINFO_MAGIC.v40 ? hex(entry.take(20)) : null;
      const kv = parseBinaryKv(entry, stringTable);
      parsed = {
        infoState,
        lastUpdated,
        picsToken,
        sha1,
        changeNumber,
        binarySha1,
        kv,
      };
    } catch {
      // A malformed tail is not an app record; retain earlier complete records and stop here.
      break;
    }
    cur.pos = entryEnd;
    apps.push({ appid, size, ...parsed });
  }
  return {
    version: magic,
    universe,
    apps,
    stringTable: stringTable?.length ?? 0,
  };
}

export interface PackageInfoEntry {
  packageid: number;
  sha1: string;
  changeNumber: number;
  token: bigint | null;
  kv: KvObject;
}
export interface PackageInfoFile {
  version: number;
  universe: number;
  packages: PackageInfoEntry[];
}

/** Parses packageinfo.vdf v39/v40. */
export function parsePackageInfo(bytes: Uint8Array): PackageInfoFile {
  const cur = new Cursor(bytes);
  const magic = cur.u32();
  if (magic !== PACKAGEINFO_MAGIC.v39 && magic !== PACKAGEINFO_MAGIC.v40) {
    throw new Error(`packageinfo.vdf: unknown magic 0x${magic.toString(16)}`);
  }
  const universe = cur.u32();
  const packages: PackageInfoEntry[] = [];
  while (cur.remaining >= 4) {
    const packageid = cur.u32();
    if (packageid === 0xffffffff) break;
    const sha1 = hex(cur.take(20));
    const changeNumber = cur.u32();
    const token = magic === PACKAGEINFO_MAGIC.v40 ? cur.u64() : null;
    const kv = parseBinaryKv(cur, null);
    packages.push({ packageid, sha1, changeNumber, token, kv });
  }
  return { version: magic, universe, packages };
}
