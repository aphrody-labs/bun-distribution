// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical package archives without an interpreter. The reader follows CPython `tarfile` name
 * and size rules, the writer lays headers out exactly like `tarfile.PAX_FORMAT`, and gzip runs
 * through the system zlib that CPython links, so archives keep the bytes pinned in bun.lock.
 */
import { dlopen, FFIType, ptr } from "bun:ffi";

export interface TarMember {
  name: string;
  /** `other` covers links, devices, FIFOs and unknown types; canonical archives refuse them. */
  type: "file" | "directory" | "other";
  mode: number;
  size: number;
  data: Uint8Array;
}

const BLOCK = 512;
const RECORD = 20 * BLOCK;
const MAX_OCTAL_SIZE = 8 ** 11;
const utf8 = new TextEncoder();
const strict = new TextDecoder("utf-8", { fatal: true });

let zlib: ReturnType<typeof openZlib> | undefined;
function openZlib() {
  const symbols = {
    compressBound: { args: [FFIType.u64], returns: FFIType.u64 },
    compress2: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.i32],
      returns: FFIType.i32,
    },
  } as const;
  const names =
    process.platform === "darwin"
      ? ["libz.1.dylib", "libz.dylib"]
      : process.platform === "win32"
        ? [
            "zlib1.dll",
            "zlib.dll",
            // Git for Windows ships the reference zlib next to its mingw64 tools.
            ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
              .filter((dir): dir is string => Boolean(dir))
              .map(dir => `${dir}\\Git\\mingw64\\bin\\zlib1.dll`),
          ]
        : ["libz.so.1"];
  for (const name of names)
    try {
      return dlopen(name, symbols).symbols;
    } catch {
      // Try the next platform name.
    }
  throw new Error(`Canonical archives require the reference zlib (tried ${names.join(", ")})`);
}

/** Raw DEFLATE at `level`, identical to zlib.compressobj(level, DEFLATED, -15, 8, 0). */
function deflateRaw(data: Uint8Array, level: number): Uint8Array {
  zlib ??= openZlib();
  const bound = Number(zlib.compressBound(data.length));
  const output = new Uint8Array(bound);
  const length = new BigUint64Array([BigInt(bound)]);
  const status = zlib.compress2(ptr(output), ptr(length), ptr(data), data.length, level);
  if (status !== 0) throw new Error(`zlib compress2 failed with status ${status}`);
  // compress2 frames the same DEFLATE stream as RFC 1950: drop its 2-byte header and Adler-32.
  return output.subarray(2, Number(length[0]) - 4);
}

/** gzip.GzipFile(filename='', compresslevel=9, mtime=0): no FNAME, XFL=2, OS=255. */
export function gzipCanonical(data: Uint8Array): Uint8Array {
  const body = deflateRaw(data, 9);
  const output = new Uint8Array(10 + body.length + 8);
  output.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255]);
  output.set(body, 10);
  const view = new DataView(output.buffer);
  view.setUint32(10 + body.length, Bun.hash.crc32(data), true);
  view.setUint32(14 + body.length, data.length % 2 ** 32, true);
  return output;
}

function nts(field: Uint8Array): string {
  const end = field.indexOf(0);
  return strict.decode(end === -1 ? field : field.subarray(0, end));
}

function nti(field: Uint8Array): number {
  if (field[0] === 0o200 || field[0] === 0o377) {
    let value = 0;
    for (const byte of field.subarray(1)) value = value * 256 + byte;
    return field[0] === 0o377 ? value - 256 ** (field.length - 1) : value;
  }
  const text = nts(field).trim() || "0";
  if (!/^[0-7]+$/.test(text)) throw new Error("Invalid tar header number");
  return Number.parseInt(text, 8);
}

function blocks(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK;
}

function paxRecords(payload: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  for (let offset = 0; offset < payload.length && payload[offset] !== 0;) {
    const space = payload.indexOf(0x20, offset);
    const length = Number(nts(payload.subarray(offset, space === -1 ? offset : space)));
    if (space === -1 || !Number.isSafeInteger(length) || length <= space - offset)
      throw new Error("Invalid pax extended header");
    const record = payload.subarray(space + 1, offset + length);
    const equals = record.indexOf(0x3d);
    if (equals === -1 || record.at(-1) !== 0x0a) throw new Error("Invalid pax extended header");
    records.set(strict.decode(record.subarray(0, equals)), strict.decode(record.subarray(equals + 1, -1)));
    offset += length;
  }
  if (records.has("hdrcharset")) throw new Error("Binary pax header charsets are unsupported");
  return records;
}

/** Members of an uncompressed tar, named as CPython tarfile names them. */
export function readTar(archive: Uint8Array): TarMember[] {
  const members: TarMember[] = [];
  let pax: Map<string, string> | undefined;
  let longName: string | undefined;
  for (let offset = 0; offset + BLOCK <= archive.length;) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every(byte => byte === 0)) break;
    let unsigned = 256;
    let signed = 256;
    for (const [index, byte] of header.entries())
      if (index < 148 || index >= 156) {
        unsigned += byte;
        signed += byte > 127 ? byte - 256 : byte;
      }
    const checksum = nti(header.subarray(148, 156));
    if (checksum !== unsigned && checksum !== signed) throw new Error("Invalid tar header checksum");
    const typeflag = String.fromCharCode(header[156]!);
    const start = offset + BLOCK;
    let size = nti(header.subarray(124, 136));
    if (typeflag === "x" || typeflag === "L") {
      if (start + size > archive.length) throw new Error("Truncated tar archive");
      const payload = archive.subarray(start, start + size);
      if (typeflag === "x") pax = paxRecords(payload);
      else longName = nts(payload);
      offset = start + blocks(size);
      continue;
    }
    let name = nts(header.subarray(0, 100));
    // V7 "AREGTYPE + trailing slash" directories are recognised only without a preceding pax or
    // GNU long-name header (tarfile's dircheck=False for follow-up headers).
    const dircheck = pax === undefined && longName === undefined;
    const directory = typeflag === "5" || (dircheck && typeflag === "\0" && name.endsWith("/"));
    const type = directory ? "directory" : ["0", "\0", "7"].includes(typeflag) ? "file" : "other";
    if (directory) name = name.replace(/\/+$/, "");
    const prefix = nts(header.subarray(345, 500));
    if (prefix && !["L", "K", "S"].includes(typeflag)) name = `${prefix}/${name}`;
    if (longName !== undefined) {
      name = directory ? longName.replace(/\/$/, "") : longName;
      longName = undefined;
    }
    if (pax) {
      const path = pax.get("path");
      if (path !== undefined) name = path.replace(/\/+$/, "");
      const paxSize = pax.get("size");
      if (paxSize !== undefined) {
        if (!/^\d+$/.test(paxSize)) throw new Error("Invalid pax size");
        size = Number(paxSize);
      }
      pax = undefined;
    }
    // tarfile skips data blocks for regular files and unknown types, not for directories or links.
    const skips = type === "file" || (type === "other" && !"123456K".includes(typeflag));
    if (skips && start + size > archive.length) throw new Error("Truncated tar archive");
    members.push({
      name,
      type,
      mode: nti(header.subarray(100, 108)),
      size,
      data: type === "file" ? archive.subarray(start, start + size) : new Uint8Array(),
    });
    offset = start + (skips ? blocks(size) : 0);
  }
  return members;
}

function octal(value: number, digits: number): Uint8Array {
  return utf8.encode(`${value.toString(8).padStart(digits - 1, "0")}\0`);
}

function ustarHeader(name: string, mode: number, size: number, typeflag: string): Uint8Array {
  const block = new Uint8Array(BLOCK);
  // stn(name, 100, "ascii", "replace"): one "?" per non-ASCII code point, then truncate.
  const ascii = Array.from(name, char => (char.codePointAt(0)! < 0x80 ? char : "?")).join("");
  block.set(utf8.encode(ascii).subarray(0, 100), 0);
  block.set(octal(mode & 0o7777, 8), 100);
  block.set(octal(0, 8), 108);
  block.set(octal(0, 8), 116);
  block.set(octal(size, 12), 124);
  block.set(octal(0, 12), 136);
  block.fill(0x20, 148, 156);
  block[156] = typeflag.charCodeAt(0);
  block.set(utf8.encode("ustar\x0000"), 257);
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  block.set(utf8.encode(`${checksum.toString(8).padStart(6, "0")}\0`), 148);
  return block;
}

function padded(data: Uint8Array): Uint8Array {
  const output = new Uint8Array(blocks(data.length));
  output.set(data);
  return output;
}

/** "<length> <keyword>=<value>\n", where the decimal length counts itself (tarfile's fixed point). */
function paxRecord(keyword: string, value: string): Uint8Array {
  const body = utf8.encode(` ${keyword}=${value}\n`);
  let length = 0;
  for (let previous = -1; length !== previous;) {
    previous = length;
    length = body.length + String(length).length;
  }
  return Buffer.concat([utf8.encode(String(length)), body]);
}

function byName(a: TarMember, b: TarMember): number {
  // UTF-8 byte order is code point order, which is how Python compares str.
  return Buffer.compare(utf8.encode(a.name), utf8.encode(b.name));
}

/** tarfile PAX_FORMAT output for the canonical members: sorted, root-owned, mtime 0, fixed modes. */
export function canonicalTar(members: TarMember[]): Uint8Array {
  if (new Set(members.map(member => member.name)).size !== members.length) throw new Error("Duplicate archive entry");
  const parts: Uint8Array[] = [];
  for (const member of members.toSorted(byName)) {
    if (member.type === "other") throw new Error(`Unsupported archive entry type: ${member.name}`);
    const directory = member.type === "directory";
    const name = directory ? `${member.name}/` : member.name;
    const size = directory ? 0 : member.size;
    const pax: [string, string][] = [];
    if (/\P{ASCII}/u.test(name) || name.length > 100) pax.push(["path", name]);
    if (size >= MAX_OCTAL_SIZE) pax.push(["size", String(size)]);
    if (pax.length) {
      const records = Buffer.concat(pax.map(([keyword, value]) => paxRecord(keyword, value)));
      parts.push(ustarHeader("././@PaxHeader", 0, records.length, "x"), padded(records));
    }
    const mode = directory || member.mode & 0o111 ? 0o755 : 0o644;
    parts.push(ustarHeader(name, mode, size >= MAX_OCTAL_SIZE ? 0 : size, directory ? "5" : "0"));
    if (!directory) parts.push(padded(member.data));
  }
  parts.push(new Uint8Array(2 * BLOCK));
  const length = parts.reduce((total, part) => total + part.length, 0);
  parts.push(new Uint8Array((RECORD - (length % RECORD)) % RECORD));
  return Buffer.concat(parts);
}
