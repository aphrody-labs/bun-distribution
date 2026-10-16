// SPDX-License-Identifier: Apache-2.0
// NTFS volume access through bun:ffi: USN journal query/creation, MFT enumeration (FSCTL_ENUM_USN_DATA) and
// journal reads (FSCTL_READ_USN_JOURNAL). Same documented controls as crates/os/kernel/libs/fsindex/src/ntfs_win.rs.
// Opening `\\.\C:` requires an administrator token (elevated session or a SYSTEM task); without it every call
// returns ERROR_ACCESS_DENIED and the callers fall back to the Bun fs walk, never to a fake result.
import { closeHandle, ioctl, openHandle, type Pointer } from "./win32.ts";
import {
  DirTree,
  FILE_ATTRIBUTE_DIRECTORY,
  parseUsnRecords,
  type UsnRecord,
} from "./usn.ts";

export type { UsnRecord };

export const FSCTL_ENUM_USN_DATA = 0x0009_00b3;
export const FSCTL_READ_USN_JOURNAL = 0x0009_00bb;
export const FSCTL_CREATE_USN_JOURNAL = 0x0009_00e7;
export const FSCTL_QUERY_USN_JOURNAL = 0x0009_00f4;

export const ERROR_ACCESS_DENIED = 5;
export const ERROR_HANDLE_EOF = 38;
export const ERROR_JOURNAL_DELETE_IN_PROGRESS = 1178;
export const ERROR_JOURNAL_NOT_ACTIVE = 1179;
export const ERROR_JOURNAL_ENTRY_DELETED = 1181;

export class Win32Error extends Error {
  constructor(
    readonly op: string,
    readonly code: number,
  ) {
    super(`${op}: erreur Win32 ${code}`);
  }
}

export type Journal = {
  journalId: bigint;
  firstUsn: bigint;
  nextUsn: bigint;
  lowestValidUsn: bigint;
  maxUsn: bigint;
  maximumSize: bigint;
};

/** An open `\\.\X:` handle. */
export class Volume {
  private constructor(
    readonly drive: string,
    private handle: Pointer | null,
  ) {}

  static open(drive = "C"): Volume {
    const r = openHandle(`\\\\.\\${drive.toUpperCase()}:`);
    if ("error" in r)
      throw new Win32Error(`ouverture du volume ${drive}:`, r.error);
    return new Volume(drive.toUpperCase(), r.handle);
  }

  close(): void {
    if (this.handle) closeHandle(this.handle);
    this.handle = null;
  }

  private get h(): Pointer {
    if (!this.handle) throw new Error(`volume : fermé`);
    return this.handle;
  }

  query(): Journal {
    const out = new Uint8Array(80);
    const r = ioctl(this.h, FSCTL_QUERY_USN_JOURNAL, null, out);
    if ("error" in r) throw new Win32Error("FSCTL_QUERY_USN_JOURNAL", r.error);
    const v = new DataView(out.buffer);
    return {
      journalId: v.getBigUint64(0, true),
      firstUsn: v.getBigInt64(8, true),
      nextUsn: v.getBigInt64(16, true),
      lowestValidUsn: v.getBigInt64(24, true),
      maxUsn: v.getBigInt64(32, true),
      maximumSize: v.getBigUint64(40, true),
    };
  }

  /** Queries the journal, creating it (32 MiB, 4 MiB delta) when the volume has none. */
  queryOrCreate(): Journal {
    try {
      return this.query();
    } catch (e) {
      if (
        !(e instanceof Win32Error) ||
        (e.code !== ERROR_JOURNAL_NOT_ACTIVE &&
          e.code !== ERROR_JOURNAL_DELETE_IN_PROGRESS)
      ) {
        throw e;
      }
      const input = new Uint8Array(16);
      const v = new DataView(input.buffer);
      v.setBigUint64(0, 32n * 1024n * 1024n, true);
      v.setBigUint64(8, 4n * 1024n * 1024n, true);
      const r = ioctl(
        this.h,
        FSCTL_CREATE_USN_JOURNAL,
        input,
        new Uint8Array(0),
      );
      if ("error" in r)
        throw new Win32Error("FSCTL_CREATE_USN_JOURNAL", r.error);
      return this.query();
    }
  }

  /**
   * Enumerates every MFT record (hidden and system entries included) as V2 records. The hot path avoids BigInt
   * and string allocation: `onRecord(record, parentRecord, attributes, name)` where `name()` decodes lazily.
   * Metadata only: names, parents and attributes, never file contents.
   */
  enumerate(
    onRecord: (
      record: number,
      parent: number,
      attributes: number,
      name: () => string,
    ) => void,
    bufferBytes = 4 << 20,
  ): number {
    const out = new Uint8Array(bufferBytes);
    // MFT_ENUM_DATA_V0: StartFileReferenceNumber, LowUsn, HighUsn (V2 records only: 64-bit references).
    const input = new Uint8Array(24);
    const iv = new DataView(input.buffer);
    iv.setBigInt64(16, 0x7fff_ffff_ffff_ffffn, true);
    const ov = new DataView(out.buffer);
    const decoder = new TextDecoder("utf-16le");
    let count = 0;
    for (;;) {
      const r = ioctl(this.h, FSCTL_ENUM_USN_DATA, input, out);
      if ("error" in r) {
        if (r.error === ERROR_HANDLE_EOF) return count;
        throw new Win32Error("FSCTL_ENUM_USN_DATA", r.error);
      }
      if (r.bytes <= 8) return count;
      // The 8-byte prefix is the next StartFileReferenceNumber.
      input.set(out.subarray(0, 8), 0);
      let off = 8;
      while (off + 60 <= r.bytes) {
        const len = ov.getUint32(off, true);
        if (
          len < 60 ||
          off + len > r.bytes ||
          ov.getUint16(off + 4, true) !== 2
        )
          break;
        const record =
          ov.getUint32(off + 8, true) +
          ov.getUint16(off + 12, true) * 0x1_0000_0000;
        const parent =
          ov.getUint32(off + 16, true) +
          ov.getUint16(off + 20, true) * 0x1_0000_0000;
        const attributes = ov.getUint32(off + 52, true);
        const nameLen = ov.getUint16(off + 56, true);
        const nameOff = off + ov.getUint16(off + 58, true);
        onRecord(record, parent, attributes, () =>
          decoder.decode(out.subarray(nameOff, nameOff + nameLen)),
        );
        count++;
        off += len;
      }
    }
  }

  /**
   * Reads the journal from `startUsn` without waiting (Timeout 0, BytesToWaitFor 0): returns the decoded records
   * and the USN to resume from. ERROR_JOURNAL_ENTRY_DELETED means the checkpoint fell out of the journal.
   */
  read(
    startUsn: bigint,
    journalId: bigint,
    bufferBytes = 1 << 20,
  ): { records: UsnRecord[]; next: bigint } {
    const out = new Uint8Array(bufferBytes);
    // READ_USN_JOURNAL_DATA_V0: StartUsn, ReasonMask, ReturnOnlyOnClose, Timeout, BytesToWaitFor, UsnJournalID.
    const input = new Uint8Array(40);
    const iv = new DataView(input.buffer);
    iv.setBigInt64(0, startUsn, true);
    iv.setUint32(8, 0xffff_ffff, true);
    iv.setUint32(12, 0, true);
    iv.setBigUint64(16, 0n, true);
    iv.setBigUint64(24, 0n, true);
    iv.setBigUint64(32, journalId, true);
    const r = ioctl(this.h, FSCTL_READ_USN_JOURNAL, input, out);
    if ("error" in r) throw new Win32Error("FSCTL_READ_USN_JOURNAL", r.error);
    if (r.bytes < 8) return { records: [], next: startUsn };
    const next = new DataView(out.buffer).getBigInt64(0, true);
    return { records: parseUsnRecords(out.subarray(8, r.bytes)), next };
  }
}

/** Attributes by MFT record number in a growable typed array (0 = unknown, stored as attributes + 1). */
export class AttrTable {
  private data = new Uint32Array(1 << 20);

  set(record: number, attributes: number): void {
    if (record >= this.data.length) {
      let size = this.data.length;
      while (size <= record) size *= 2;
      const next = new Uint32Array(size);
      next.set(this.data);
      this.data = next;
    }
    this.data[record] = (attributes >>> 0) + 1;
  }

  get(record: number): number | undefined {
    const v = this.data[record];
    return v ? v - 1 : undefined;
  }
}

export type MftIndex = {
  tree: DirTree;
  /** Attributes by MFT record number (files and directories). */
  attributes: AttrTable;
  records: number;
  journal: Journal;
  ms: number;
};

/**
 * Reads the whole MFT of `drive`: the directory tree (record -> parent + name) and the attributes of every record.
 * The journal is queried first so that changes made during the enumeration are replayed from `journal.nextUsn`.
 */
export function readMft(drive = "C", withAttributes = true): MftIndex {
  const t0 = performance.now();
  const vol = Volume.open(drive);
  try {
    const journal = vol.queryOrCreate();
    const tree = new DirTree(vol.drive);
    const attributes = new AttrTable();
    const records = vol.enumerate((record, parent, attrs, name) => {
      if (withAttributes) attributes.set(record, attrs);
      if (attrs & FILE_ATTRIBUTE_DIRECTORY) tree.set(record, parent, name());
    });
    return { tree, attributes, records, journal, ms: performance.now() - t0 };
  } finally {
    vol.close();
  }
}
