// SPDX-License-Identifier: Apache-2.0
// Platform-independent decoding of NTFS USN records (USN_RECORD_V2 and V3) and of the reason flags, mirroring
// crates/os/kernel/libs/fsindex/src/mft.rs so that the Bun watcher and the Rust MFT tree read the same layout.

export const USN_REASON = {
  DATA_OVERWRITE: 0x1,
  DATA_EXTEND: 0x2,
  DATA_TRUNCATION: 0x4,
  NAMED_DATA_OVERWRITE: 0x10,
  NAMED_DATA_EXTEND: 0x20,
  NAMED_DATA_TRUNCATION: 0x40,
  FILE_CREATE: 0x100,
  FILE_DELETE: 0x200,
  EA_CHANGE: 0x400,
  SECURITY_CHANGE: 0x800,
  RENAME_OLD_NAME: 0x1000,
  RENAME_NEW_NAME: 0x2000,
  INDEXABLE_CHANGE: 0x4000,
  BASIC_INFO_CHANGE: 0x8000,
  HARD_LINK_CHANGE: 0x10000,
  COMPRESSION_CHANGE: 0x20000,
  ENCRYPTION_CHANGE: 0x40000,
  OBJECT_ID_CHANGE: 0x80000,
  REPARSE_POINT_CHANGE: 0x100000,
  STREAM_CHANGE: 0x200000,
  TRANSACTED_CHANGE: 0x400000,
  INTEGRITY_CHANGE: 0x800000,
  CLOSE: 0x8000_0000,
} as const;

/** Reasons that change the bytes of the default or a named stream (rehash / reparse needed). */
export const DATA_REASONS =
  USN_REASON.DATA_OVERWRITE |
  USN_REASON.DATA_EXTEND |
  USN_REASON.DATA_TRUNCATION |
  USN_REASON.NAMED_DATA_OVERWRITE |
  USN_REASON.NAMED_DATA_EXTEND |
  USN_REASON.NAMED_DATA_TRUNCATION |
  USN_REASON.STREAM_CHANGE |
  USN_REASON.FILE_CREATE;

export const FILE_ATTRIBUTE_DIRECTORY = 0x10;
/** Record number 5 is the root directory of every NTFS volume. */
export const ROOT_RECORD = 5;
const RECORD_MASK = 0xffff_ffff_ffffn;

export type UsnRecord = {
  major: number;
  /** Full 64-bit file reference (sequence << 48 | record); V3 references keep their low 64 bits. */
  frn: bigint;
  parentFrn: bigint;
  /** MFT record number (low 48 bits), the stable directory key of the in-memory tree. */
  record: number;
  parentRecord: number;
  usn: bigint;
  /** FILETIME (100 ns since 1601). */
  timestamp: bigint;
  reason: number;
  attributes: number;
  name: string;
  /** Bytes consumed (the record length). */
  length: number;
};

export const recordOf = (frn: bigint): number => Number(frn & RECORD_MASK);

/** Decodes one record at the start of `buf`; undefined when the bytes are not a valid V2/V3 record. */
export function parseUsnRecord(
  buf: Uint8Array,
  offset = 0,
): UsnRecord | undefined {
  if (buf.byteLength - offset < 8) return undefined;
  const v = new DataView(
    buf.buffer,
    buf.byteOffset + offset,
    buf.byteLength - offset,
  );
  const length = v.getUint32(0, true);
  const major = v.getUint16(4, true);
  if (length < 8 || length > v.byteLength) return undefined;
  let frn: bigint;
  let parentFrn: bigint;
  let base: number;
  if (major === 2) {
    if (length < 60) return undefined;
    frn = v.getBigUint64(8, true);
    parentFrn = v.getBigUint64(16, true);
    base = 24;
  } else if (major === 3) {
    if (length < 76) return undefined;
    frn = v.getBigUint64(8, true);
    parentFrn = v.getBigUint64(24, true);
    base = 40;
  } else {
    return undefined;
  }
  const usn = v.getBigInt64(base, true);
  const timestamp = v.getBigInt64(base + 8, true);
  const reason = v.getUint32(base + 16, true);
  const attributes = v.getUint32(base + 28, true);
  const nameLength = v.getUint16(base + 32, true);
  const nameOffset = v.getUint16(base + 34, true);
  if (nameOffset + nameLength > length) return undefined;
  const name = Buffer.from(
    buf.buffer,
    buf.byteOffset + offset + nameOffset,
    nameLength,
  ).toString("utf16le");
  return {
    major,
    frn,
    parentFrn,
    record: recordOf(frn),
    parentRecord: recordOf(parentFrn),
    usn,
    timestamp,
    reason,
    attributes,
    name,
    length,
  };
}

/** Decodes a packed sequence of records (the part of an FSCTL output after its 8-byte USN/FRN prefix). */
export function parseUsnRecords(buf: Uint8Array): UsnRecord[] {
  const out: UsnRecord[] = [];
  let off = 0;
  while (off < buf.byteLength) {
    const rec = parseUsnRecord(buf, off);
    if (!rec) break;
    out.push(rec);
    // Records are 8-byte aligned; RecordLength already includes the padding.
    off += rec.length;
  }
  return out;
}

/** Human-readable reason names (logs, NDJSON journal). */
export function reasonNames(reason: number): string[] {
  const names: string[] = [];
  for (const [k, bit] of Object.entries(USN_REASON))
    if ((reason & bit) >>> 0 === bit) names.push(k);
  return names;
}

/** FILETIME (100 ns ticks since 1601-01-01) to epoch milliseconds. */
export function filetimeToMs(ft: bigint): number {
  return Number((ft - 116_444_736_000_000_000n) / 10_000n);
}

/** Builds a synthetic V2 record (tests and fixtures). */
export function encodeUsnRecordV2(r: {
  frn: bigint;
  parentFrn: bigint;
  usn: bigint;
  reason: number;
  attributes: number;
  name: string;
  timestamp?: bigint;
}): Uint8Array {
  const name = Buffer.from(r.name, "utf16le");
  const length = (60 + name.byteLength + 7) & ~7;
  const out = new Uint8Array(length);
  const v = new DataView(out.buffer);
  v.setUint32(0, length, true);
  v.setUint16(4, 2, true);
  v.setBigUint64(8, r.frn, true);
  v.setBigUint64(16, r.parentFrn, true);
  v.setBigInt64(24, r.usn, true);
  v.setBigInt64(32, r.timestamp ?? 0n, true);
  v.setUint32(40, r.reason >>> 0, true);
  v.setUint32(52, r.attributes, true);
  v.setUint16(56, name.byteLength, true);
  v.setUint16(58, 60, true);
  out.set(name, 60);
  return out;
}

export type DirEntry = { parent: number; name: string };

/**
 * Directory tree keyed by MFT record number: enough to turn any USN record (parent record + name) into a full
 * path. Files are not stored, so the whole C: volume fits in a few hundred thousand entries.
 */
export class DirTree {
  readonly dirs = new Map<number, DirEntry>();
  private cache = new Map<number, string>();

  constructor(readonly drive = "C") {}

  set(record: number, parent: number, name: string): void {
    const prev = this.dirs.get(record);
    if (prev && prev.parent === parent && prev.name === name) return;
    this.dirs.set(record, { parent, name });
    if (prev) this.cache.clear();
  }

  delete(record: number): void {
    if (this.dirs.delete(record)) this.cache.clear();
  }

  /** Full path of a directory record, or undefined when an ancestor is unknown. */
  path(record: number): string | undefined {
    if (record === ROOT_RECORD) return `${this.drive}:`;
    const hit = this.cache.get(record);
    if (hit !== undefined) return hit;
    const chain: string[] = [];
    let cur = record;
    for (let depth = 0; depth < 512; depth++) {
      if (cur === ROOT_RECORD) {
        const p = `${this.drive}:\\${chain.reverse().join("\\")}`;
        this.cache.set(record, p);
        return p;
      }
      const e = this.dirs.get(cur);
      if (!e) return undefined;
      chain.push(e.name);
      cur = e.parent;
    }
    return undefined;
  }

  /** Path of a record's entry (`parent path` + `name`). */
  childPath(parentRecord: number, name: string): string | undefined {
    const p = this.path(parentRecord);
    return p === undefined ? undefined : `${p}\\${name}`;
  }
}
