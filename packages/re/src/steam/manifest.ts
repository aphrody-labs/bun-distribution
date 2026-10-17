// SPDX-License-Identifier: Apache-2.0
/**
 * `depotcache/<depot>_<gid>.manifest` reader: the Steam content manifest container
 * (payload / metadata / signature protobuf sections) with a minimal protobuf wire decoder.
 */
import { Cursor } from "./kv.js";

export const MANIFEST_MAGIC = {
  payload: 0x71f617d0,
  metadata: 0x1f4812be,
  signature: 0x1b81b817,
  end: 0x32c415ab,
} as const;

interface Field {
  num: number;
  wire: number;
  value: bigint | Uint8Array;
}

/** Decodes one protobuf message into its raw fields (varint / fixed / length-delimited). */
export function decodeProto(bytes: Uint8Array): Field[] {
  const out: Field[] = [];
  const cur = new Cursor(bytes);
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const b = cur.u8();
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
      if (shift > 70n) throw new Error("protobuf: varint too long");
    }
  };
  while (cur.remaining > 0) {
    const tag = Number(varint());
    const num = tag >>> 3;
    const wire = tag & 7;
    switch (wire) {
      case 0:
        out.push({ num, wire, value: varint() });
        break;
      case 1:
        out.push({ num, wire, value: cur.u64() });
        break;
      case 2: {
        const len = Number(varint());
        out.push({ num, wire, value: cur.take(len) });
        break;
      }
      case 5:
        out.push({ num, wire, value: BigInt(cur.u32()) });
        break;
      default:
        throw new Error(`protobuf: unsupported wire type ${wire}`);
    }
  }
  return out;
}

const utf8 = new TextDecoder();
const num = (f: Field[], n: number): number | null => {
  const v = f.find((x) => x.num === n && typeof x.value === "bigint");
  return v ? Number(v.value) : null;
};
const big = (f: Field[], n: number): bigint | null => {
  const v = f.find((x) => x.num === n && typeof x.value === "bigint");
  return v ? (v.value as bigint) : null;
};
const bytesOf = (f: Field[], n: number): Uint8Array | null => {
  const v = f.find((x) => x.num === n && typeof x.value !== "bigint");
  return v ? (v.value as Uint8Array) : null;
};
const str = (f: Field[], n: number): string | null => {
  const b = bytesOf(f, n);
  return b ? utf8.decode(b) : null;
};
const hex = (b: Uint8Array | null) =>
  b ? Buffer.from(b).toString("hex") : null;

export interface ManifestChunk {
  sha: string | null;
  crc: number | null;
  offset: bigint;
  cbOriginal: number;
  cbCompressed: number;
}
export interface ManifestFile {
  filename: string;
  size: bigint;
  flags: number;
  shaFilename: string | null;
  shaContent: string | null;
  linkTarget: string | null;
  chunkCount: number;
  chunks: ManifestChunk[];
}
export interface ManifestMetadata {
  depotId: number | null;
  gidManifest: bigint | null;
  creationTime: number | null;
  filenamesEncrypted: boolean;
  cbDiskOriginal: bigint | null;
  cbDiskCompressed: bigint | null;
  uniqueChunks: number | null;
  crcEncrypted: number | null;
  crcClear: number | null;
}
export interface DepotManifest {
  metadata: ManifestMetadata;
  files: ManifestFile[];
  signatureBytes: number;
}

/** Field numbers of `content_manifest.proto` (SteamDatabase/Protobufs, steammessages_content). */
export function parseDepotManifest(
  bytes: Uint8Array,
  { withChunks = false } = {},
): DepotManifest {
  const cur = new Cursor(bytes);
  let payload: Uint8Array | null = null;
  let metadata: Uint8Array | null = null;
  let signatureBytes = 0;
  while (cur.remaining >= 4) {
    const magic = cur.u32();
    if (magic === MANIFEST_MAGIC.end) break;
    if (cur.remaining < 4) break;
    const len = cur.u32();
    const section = cur.take(len);
    if (magic === MANIFEST_MAGIC.payload) payload = section;
    else if (magic === MANIFEST_MAGIC.metadata) metadata = section;
    else if (magic === MANIFEST_MAGIC.signature) signatureBytes = len;
    else
      throw new Error(
        `manifest: unknown section magic 0x${magic.toString(16)}`,
      );
  }
  if (!payload) throw new Error("manifest: payload section missing");
  const files: ManifestFile[] = [];
  for (const f of decodeProto(payload)) {
    if (f.num !== 1 || typeof f.value === "bigint") continue;
    const m = decodeProto(f.value);
    const chunkFields = m.filter(
      (x) => x.num === 6 && typeof x.value !== "bigint",
    );
    const chunks: ManifestChunk[] = withChunks
      ? chunkFields.map((c) => {
          const cf = decodeProto(c.value as Uint8Array);
          return {
            sha: hex(bytesOf(cf, 1)),
            crc: num(cf, 2),
            offset: big(cf, 3) ?? 0n,
            cbOriginal: num(cf, 4) ?? 0,
            cbCompressed: num(cf, 5) ?? 0,
          };
        })
      : [];
    files.push({
      filename: str(m, 1) ?? "",
      size: big(m, 2) ?? 0n,
      flags: num(m, 3) ?? 0,
      shaFilename: hex(bytesOf(m, 4)),
      shaContent: hex(bytesOf(m, 5)),
      linkTarget: str(m, 7),
      chunkCount: chunkFields.length,
      chunks,
    });
  }
  const md = metadata ? decodeProto(metadata) : [];
  return {
    metadata: {
      depotId: num(md, 1),
      gidManifest: big(md, 2),
      creationTime: num(md, 3),
      filenamesEncrypted: (num(md, 4) ?? 0) !== 0,
      cbDiskOriginal: big(md, 5),
      cbDiskCompressed: big(md, 6),
      uniqueChunks: num(md, 7),
      crcEncrypted: num(md, 8),
      crcClear: num(md, 9),
    },
    files,
    signatureBytes,
  };
}

/** Directory flag of `EDepotFileFlag`. */
export const FILE_FLAG_DIRECTORY = 0x40;
