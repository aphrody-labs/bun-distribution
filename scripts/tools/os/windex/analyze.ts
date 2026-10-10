// SPDX-License-Identifier: Apache-2.0
// Per-entry analysis shared by the worker pool and the real-time watcher: Bun fs stat (FRN, size, timestamps),
// NTFS attributes, streaming SHA-256, PE parsing, alternate data streams and catalog signature.
import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { catalogSignature, type CatalogSignature } from "./catalog.ts";
import { stateValue } from "./config.ts";
import { looksLikePe, parsePe, type ByteSource, type PeInfo } from "./pe.ts";
import { alternateStreams, fileAttributes, isWindows, type Stream } from "./win32.ts";

export type Task = {
  path: string;
  dir: boolean;
  /** Attributes already known from the MFT. */
  attrs?: number;
  /** `stateValue(size, mtimeMs)` of the stored record: equal means unchanged, the content is not re-read. */
  prev?: number;
  hash: "all" | "pe" | "none";
  /** Files above this size are not hashed (still stat'ed and PE-probed). */
  maxHashBytes: number;
  /** Attributes are filled by the caller from the MFT: skip GetFileAttributesW. */
  skipAttrs?: boolean;
  /** Metadata-only change (USN without data reasons): stat, never re-read the content. */
  metaOnly?: boolean;
  /**
   * Inline catalog-signature lookup for PE files without an embedded signature (wintrust, slow): the watcher's
   * single-file updates set it; scans leave it off and run the deferred catalog pass instead.
   */
  catalog?: boolean;
};

export type PeSummary = {
  kind: string;
  machine: string;
  bits: number;
  subsystem: string;
  characteristics: number;
  dllCharacteristics: number;
  timestamp: number;
  imageBase: string;
  imageSize: number;
  entryRva: number;
  isDotnet: boolean;
  fileVersion: string | null;
  productVersion: string | null;
  company: string | null;
  description: string | null;
  product: string | null;
  originalFilename: string | null;
  internalName: string | null;
  copyright: string | null;
  signature: "embedded" | "catalog" | "none";
  signer: string | null;
  signerIssuer: string | null;
  digest: string | null;
  catalog: string | null;
  /** False until the catalog lookup ran for an image without an embedded signature (deferred pass). */
  catalogChecked: boolean;
  exportName: string | null;
  imports: { module: string; delay: boolean; functions: string[] }[];
  exports: { ordinal: number; name: string | null; forwarder: string | null }[];
  warnings: string[];
};

export type EntryRecord = {
  path: string;
  dir: boolean;
  size: number;
  attrs: number;
  /** File reference number (Bun stat `ino`), decimal string of the unsigned 64-bit value. */
  frn: string | null;
  nlink: number;
  birthMs: number | null;
  mtimeMs: number | null;
  atimeMs: number | null;
  ctimeMs: number | null;
  /** True when size and mtime match the stored record: content fields are omitted and kept as stored. */
  unchanged: boolean;
  sha256: string | null;
  ads: Stream[] | null;
  pe: PeSummary | null;
  error: string | null;
};

const CHUNK = 4 << 20;
const IN_MEMORY_MAX = 64 << 20;
export const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;

function fdSource(fd: number, size: number): ByteSource {
  return {
    size,
    read(offset, length) {
      const len = Math.max(0, Math.min(length, size - offset));
      const buf = new Uint8Array(len);
      let got = 0;
      while (got < len) {
        const n = readSync(fd, buf, got, len - got, offset + got);
        if (n <= 0) break;
        got += n;
      }
      return buf.subarray(0, got);
    },
  };
}

/** `catalog` is the lookup result (null: listed in no catalog), undefined when the lookup did not run. */
export function summarize(pe: PeInfo, catalog?: CatalogSignature | null): PeSummary {
  const s = pe.version?.strings ?? {};
  return {
    kind: pe.kind,
    machine: pe.machine,
    bits: pe.bits,
    subsystem: pe.subsystem,
    characteristics: pe.characteristics,
    dllCharacteristics: pe.dllCharacteristics,
    timestamp: pe.timestamp,
    imageBase: pe.imageBase.toString(),
    imageSize: pe.imageSize,
    entryRva: pe.entryRva,
    isDotnet: pe.isDotnet,
    fileVersion: pe.version?.fileVersion ?? s.FileVersion ?? null,
    productVersion: pe.version?.productVersion ?? s.ProductVersion ?? null,
    company: s.CompanyName ?? null,
    description: s.FileDescription ?? null,
    product: s.ProductName ?? null,
    originalFilename: s.OriginalFilename ?? null,
    internalName: s.InternalName ?? null,
    copyright: s.LegalCopyright ?? null,
    signature: pe.authenticode ? "embedded" : catalog ? "catalog" : "none",
    signer: pe.authenticode ? pe.authenticode.signer : (catalog?.signer ?? null),
    signerIssuer: pe.authenticode ? pe.authenticode.issuer : (catalog?.issuer ?? null),
    digest: pe.authenticode ? pe.authenticode.digest : (catalog?.digest ?? null),
    catalog: pe.authenticode ? null : (catalog?.catalog ?? null),
    catalogChecked: pe.authenticode !== null || catalog !== undefined,
    exportName: pe.exportName,
    imports: pe.imports,
    exports: pe.exports,
    warnings: pe.warnings,
  };
}

const ms = (ns: bigint) => Number(ns / 1_000_000n);
const PE_EXT = /\.(exe|dll|sys|ocx|cpl|drv|efi|scr|mui|ax|acm|tsp|com|winmd|node|pyd|mun)$/i;

/** Analyses one filesystem entry; I/O failures are captured in `error`, never thrown. */
export function analyze(task: Task): EntryRecord {
  const rec: EntryRecord = {
    path: task.path,
    dir: task.dir,
    size: 0,
    attrs: task.attrs ?? 0,
    frn: null,
    nlink: 1,
    birthMs: null,
    mtimeMs: null,
    atimeMs: null,
    ctimeMs: null,
    unchanged: false,
    sha256: null,
    ads: null,
    pe: null,
    error: null,
  };
  try {
    const st = statSync(task.path, { bigint: true });
    rec.size = task.dir ? 0 : Number(st.size);
    rec.frn = st.ino.toString();
    rec.nlink = Number(st.nlink);
    rec.birthMs = ms(st.birthtimeNs);
    rec.mtimeMs = ms(st.mtimeNs);
    rec.atimeMs = ms(st.atimeNs);
    rec.ctimeMs = ms(st.ctimeNs);
  } catch (e) {
    rec.error = (e as NodeJS.ErrnoException).code ?? String(e);
    return rec;
  }
  if (task.attrs === undefined && !task.skipAttrs && isWindows)
    rec.attrs = fileAttributes(task.path) ?? 0;
  if (task.dir) return rec;
  if (
    task.metaOnly ||
    (task.prev !== undefined && task.prev === stateValue(rec.size, rec.mtimeMs))
  ) {
    rec.unchanged = true;
    return rec;
  }
  if (isWindows) {
    try {
      const ads = alternateStreams(task.path);
      rec.ads = ads.length ? ads : null;
    } catch {
      rec.ads = null;
    }
  }
  if (task.hash === "none" && !PE_EXT.test(task.path)) return rec;
  let fd: number;
  try {
    fd = openSync(task.path, "r");
  } catch (e) {
    rec.error = (e as NodeJS.ErrnoException).code ?? String(e);
    return rec;
  }
  try {
    const size = Number(fstatSync(fd, { bigint: true }).size);
    const head = fdSource(fd, size).read(0, Math.min(size, 4096));
    const isPe = looksLikePe(head);
    const wantHash =
      size <= task.maxHashBytes && (task.hash === "all" || (task.hash === "pe" && isPe));
    let image: Uint8Array | null = null;
    if (wantHash) {
      const hasher = new Bun.CryptoHasher("sha256");
      if (size <= IN_MEMORY_MAX) {
        image = fdSource(fd, size).read(0, size);
        hasher.update(image);
      } else {
        const buf = new Uint8Array(CHUNK);
        let pos = 0;
        for (;;) {
          const n = readSync(fd, buf, 0, CHUNK, pos);
          if (n <= 0) break;
          hasher.update(buf.subarray(0, n));
          pos += n;
        }
      }
      rec.sha256 = hasher.digest("hex");
    }
    if (isPe) {
      const name = task.path.slice(task.path.lastIndexOf("\\") + 1);
      const pe = parsePe(
        image ? { size, read: (o, l) => image!.subarray(o, o + l) } : fdSource(fd, size),
        name,
      );
      if (pe) {
        const catalog =
          !pe.authenticode && isWindows && task.catalog ? catalogSignature(task.path) : undefined;
        rec.pe = summarize(pe, catalog);
      }
    }
  } catch (e) {
    rec.error = (e as Error).message;
  } finally {
    closeSync(fd);
  }
  return rec;
}
