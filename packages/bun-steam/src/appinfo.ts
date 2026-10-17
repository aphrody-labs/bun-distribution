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
  if (magic !== APPINFO_MAGIC.v39 && magic !== APPINFO_MAGIC.v40 && magic !== APPINFO_MAGIC.v41) {
    throw new Error(`appinfo.vdf: unknown magic 0x${magic.toString(16)}`);
  }
  const universe = cur.u32();
  let stringTable: string[] | null = null;
  if (magic === APPINFO_MAGIC.v41) {
    const offset = Number(cur.u64());
    const tc = new Cursor(bytes);
    tc.pos = offset;
    const count = tc.u32();
    stringTable = [];
    for (let i = 0; i < count; i++) stringTable.push(tc.cstr());
  }
  const apps: AppInfoEntry[] = [];
  const end = stringTable
    ? Number(new DataView(bytes.buffer, bytes.byteOffset + 8, 8).getBigUint64(0, true))
    : bytes.length;
  while (cur.pos + 4 <= end) {
    const appid = cur.u32();
    if (appid === 0) break;
    const size = cur.u32();
    const entryEnd = cur.pos + size;
    const infoState = cur.u32();
    const lastUpdated = cur.u32();
    const picsToken = cur.u64();
    const sha1 = hex(cur.take(20));
    const changeNumber = cur.u32();
    const binarySha1 = magic >= APPINFO_MAGIC.v40 ? hex(cur.take(20)) : null;
    let kv: KvObject = {};
    try {
      kv = parseBinaryKv(cur, stringTable);
    } catch {
      kv = { _error: "binary kv parse failed" };
    }
    cur.pos = entryEnd;
    apps.push({
      appid,
      size,
      infoState,
      lastUpdated,
      picsToken,
      sha1,
      changeNumber,
      binarySha1,
      kv,
    });
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
