// SPDX-License-Identifier: MIT
import { decoder, LIMITS, safePath, type PayloadEntry } from "./types.ts";

const string = (data: Uint8Array) =>
  decoder.decode(data.subarray(0, data.indexOf(0) < 0 ? data.length : data.indexOf(0)));
function number(data: Uint8Array): number {
  if (data[0]! & 0x80) {
    let value = BigInt(data[0]! & 0x7f);
    for (const byte of data.subarray(1)) value = value * 256n + BigInt(byte);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Tar integer exceeds limit");
    return Number(value);
  }
  const value = string(data).trim();
  if (value && !/^[0-7]+$/.test(value)) throw new Error("Invalid tar octal number");
  return value ? Number.parseInt(value, 8) : 0;
}

function pax(data: Uint8Array): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  for (let offset = 0; offset < data.length;) {
    let space = offset;
    while (space < data.length && data[space] !== 32) space++;
    const text = decoder.decode(data.subarray(offset, space));
    if (!/^\d+$/.test(text)) throw new Error("Invalid PAX length");
    const length = Number(text);
    if (
      !Number.isSafeInteger(length) ||
      length < space - offset + 3 ||
      length > data.length - offset ||
      data[offset + length - 1] !== 10
    )
      throw new Error("Truncated PAX record");
    const record = decoder.decode(data.subarray(space + 1, offset + length - 1));
    const equal = record.indexOf("=");
    if (equal < 1) throw new Error("Invalid PAX field");
    fields[record.slice(0, equal)] = record.slice(equal + 1);
    offset += length;
  }
  return fields;
}

/** ustar, GNU long names and PAX metadata, without filesystem extraction. */
export function tar(data: Uint8Array): PayloadEntry[] {
  if (data.length > LIMITS.unpacked) throw new Error("Tar exceeds unpacked byte limit");
  const entries: PayloadEntry[] = [];
  const names = new Set<string>();
  let local: Record<string, string> = Object.create(null);
  let global: Record<string, string> = Object.create(null);
  let terminated = false;
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (offset + 1024 > data.length || !data.subarray(offset).every(byte => byte === 0))
        throw new Error("Incomplete tar end marker or trailing payload");
      terminated = true;
      break;
    }
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (number(header.subarray(148, 156)) !== checksum) throw new Error("Tar header checksum mismatch");
    const attributes = { ...global, ...local };
    if (Object.keys(attributes).some(key => key.startsWith("GNU.sparse.") || key === "SCHILY.realsize"))
      throw new Error("Sparse tar payload needs a sparse-aware archive owner");
    const size = attributes.size === undefined ? number(header.subarray(124, 136)) : Number(attributes.size);
    const start = offset + 512;
    if (!Number.isSafeInteger(size) || size < 0 || size > data.length - start) throw new Error("Truncated tar payload");
    const payload = data.subarray(start, start + size);
    const flag = header[156] ?? 0;
    offset = start + Math.ceil(size / 512) * 512;
    if (flag === 120 || flag === 103) {
      if (size > LIMITS.metadata) throw new Error("Tar PAX metadata exceeds limit");
      if (flag === 103) global = { ...global, ...pax(payload) };
      else local = { ...local, ...pax(payload) };
      continue;
    }
    if (flag === 76 || flag === 75) {
      if (size > 65536) throw new Error("GNU tar name exceeds limit");
      local[flag === 76 ? "path" : "linkpath"] = string(payload).replace(/\n$/, "");
      continue;
    }
    // Old GNU headers use this region for timestamps and sparse metadata, not the ustar prefix.
    const prefix = decoder.decode(header.subarray(257, 263)) === "ustar\0" ? string(header.subarray(345, 500)) : "";
    const raw = attributes.path ?? `${prefix ? `${prefix}/` : ""}${string(header.subarray(0, 100))}`;
    local = Object.create(null);
    if (raw === "." || raw === "./") continue;
    const path = safePath(raw);
    if (names.has(path)) throw new Error(`Duplicate tar path: ${path}`);
    names.add(path);
    const kind =
      flag === 0 || flag === 48
        ? "file"
        : flag === 53
          ? "directory"
          : flag === 50
            ? "symlink"
            : flag === 49
              ? "hardlink"
              : undefined;
    if (!kind) throw new Error(`Unsupported tar entry type: ${flag}`);
    const link =
      kind === "symlink" || kind === "hardlink"
        ? (attributes.linkpath ?? string(header.subarray(157, 257)))
        : undefined;
    if (link?.includes("\0")) throw new Error("Invalid tar link");
    entries.push({
      path,
      kind,
      mode: number(header.subarray(100, 108)),
      link,
      data: kind === "file" ? payload : new Uint8Array(),
    });
    if (entries.length > LIMITS.entries) throw new Error("Tar entry count exceeds limit");
  }
  if (!terminated) throw new Error("Tar has no complete end marker");
  return entries;
}

export interface TarStreamEntry {
  path: string;
  kind: PayloadEntry["kind"];
  mode: number;
  mtime: number;
  size: number;
  link?: string;
  uname?: string;
  gname?: string;
  /** Extended attribute names (values are not interpreted). */
  xattrs: string[];
  data: Uint8Array;
}

export interface TarStreamLimits {
  /** Largest single member buffered in memory. */
  entry: number;
  /** Total decoded bytes accepted from the stream. */
  total: number;
  entries: number;
}

class ByteQueue {
  private chunks: Uint8Array[] = [];
  private head = 0;
  private available = 0;
  private done = false;
  consumed = 0;
  constructor(
    private reader: ReadableStreamDefaultReader<Uint8Array>,
    private limit: number,
  ) {}

  private async fill(size: number) {
    while (this.available < size && !this.done) {
      const chunk = await this.reader.read();
      if (chunk.done) this.done = true;
      else if (chunk.value.length) {
        this.chunks.push(chunk.value);
        this.available += chunk.value.length;
        if (this.consumed + this.available > this.limit) throw new Error("Tar stream exceeds decoded byte limit");
      }
    }
  }

  async read(size: number, copy = true): Promise<Uint8Array> {
    await this.fill(size);
    if (this.available < size) throw new Error("Truncated tar stream");
    const first = this.chunks[0];
    let out: Uint8Array;
    if (first && first.length - this.head >= size) {
      out = first.subarray(this.head, this.head + size);
      this.head += size;
      if (this.head === first.length) {
        this.chunks.shift();
        this.head = 0;
      }
    } else {
      out = copy ? new Uint8Array(size) : new Uint8Array(0);
      for (let offset = 0; offset < size;) {
        const chunk = this.chunks[0]!;
        const take = Math.min(chunk.length - this.head, size - offset);
        if (copy) out.set(chunk.subarray(this.head, this.head + take), offset);
        offset += take;
        this.head += take;
        if (this.head === chunk.length) {
          this.chunks.shift();
          this.head = 0;
        }
      }
    }
    this.available -= size;
    this.consumed += size;
    return out;
  }

  /** Accept only zero padding after the end marker. */
  async rest(limit: number): Promise<boolean> {
    for (let total = 0; ;) {
      await this.fill(1);
      if (!this.available) return true;
      const size = Math.min(this.available, 65536);
      total += size;
      if (total > limit) return false;
      const bytes = await this.read(size);
      if (!bytes.every(byte => byte === 0)) return false;
    }
  }
}

/** PAX records whose xattr values may be binary; only names and UTF-8 fields are decoded. */
function paxLenient(data: Uint8Array): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  const loose = new TextDecoder();
  for (let offset = 0; offset < data.length;) {
    let space = offset;
    while (space < data.length && data[space] !== 32 && space - offset < 20) space++;
    const length = Number(loose.decode(data.subarray(offset, space)));
    if (
      !Number.isSafeInteger(length) ||
      length < space - offset + 3 ||
      length > data.length - offset ||
      data[offset + length - 1] !== 10
    )
      throw new Error("Truncated PAX record");
    const record = data.subarray(space + 1, offset + length - 1);
    const equal = record.indexOf(61);
    if (equal < 1) throw new Error("Invalid PAX field");
    const key = decoder.decode(record.subarray(0, equal));
    fields[key] = /xattr\./.test(key) ? "" : loose.decode(record.subarray(equal + 1));
    offset += length;
  }
  return fields;
}

/** Streaming ustar/GNU/PAX reader for archives larger than the in-memory limits. */
export async function* tarStream(
  stream: ReadableStream<Uint8Array>,
  limits: TarStreamLimits,
): AsyncGenerator<TarStreamEntry> {
  const reader = stream.getReader();
  const queue = new ByteQueue(reader, limits.total);
  const names = new Set<string>();
  let local: Record<string, string> = Object.create(null);
  let global: Record<string, string> = Object.create(null);
  let count = 0;
  try {
    for (;;) {
      const header = await queue.read(512);
      if (header.every(byte => byte === 0)) {
        const second = await queue.read(512);
        if (!second.every(byte => byte === 0) || !(await queue.rest(1 << 20)))
          throw new Error("Incomplete tar end marker or trailing payload");
        return;
      }
      let checksum = 0;
      for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
      if (number(header.subarray(148, 156)) !== checksum) throw new Error("Tar header checksum mismatch");
      const attributes = { ...global, ...local };
      if (Object.keys(attributes).some(key => key.startsWith("GNU.sparse.") || key === "SCHILY.realsize"))
        throw new Error("Sparse tar payload needs a sparse-aware archive owner");
      const size = attributes.size === undefined ? number(header.subarray(124, 136)) : Number(attributes.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid tar member size");
      const flag = header[156] ?? 0;
      const padded = Math.ceil(size / 512) * 512;
      if (flag === 120 || flag === 103 || flag === 76 || flag === 75) {
        if (size > LIMITS.metadata) throw new Error("Tar metadata exceeds limit");
        const payload = (await queue.read(padded)).subarray(0, size);
        if (flag === 103) global = { ...global, ...paxLenient(payload) };
        else if (flag === 120) local = { ...local, ...paxLenient(payload) };
        else local[flag === 76 ? "path" : "linkpath"] = string(payload).replace(/\n$/, "");
        continue;
      }
      const kind =
        flag === 0 || flag === 48
          ? "file"
          : flag === 53
            ? "directory"
            : flag === 50
              ? "symlink"
              : flag === 49
                ? "hardlink"
                : undefined;
      if (!kind) throw new Error(`Unsupported tar entry type: ${flag}`);
      if (kind === "file" && size > limits.entry) throw new Error("Tar member exceeds the in-memory member limit");
      let data: Uint8Array = new Uint8Array();
      if (kind === "file") data = (await queue.read(padded)).subarray(0, size);
      else await queue.read(padded, false);
      const prefix = decoder.decode(header.subarray(257, 263)) === "ustar\0" ? string(header.subarray(345, 500)) : "";
      const raw = attributes.path ?? `${prefix ? `${prefix}/` : ""}${string(header.subarray(0, 100))}`;
      const xattrs = Object.keys(attributes)
        .filter(key => /^(SCHILY|LIBARCHIVE)\.xattr\./.test(key))
        .map(key => key.replace(/^(SCHILY|LIBARCHIVE)\.xattr\./, ""));
      const mtime = Math.floor(Number(attributes.mtime ?? number(header.subarray(136, 148))));
      const uname = attributes.uname ?? string(header.subarray(265, 297));
      const gname = attributes.gname ?? string(header.subarray(297, 329));
      local = Object.create(null);
      if (raw === "." || raw === "./") continue;
      // POSIX payloads: ':' is valid (pacman epochs); traversal and control bytes are not.
      const path = safePath(raw.replaceAll(":", "")).replaceAll("", ":");
      if (names.has(path)) throw new Error(`Duplicate tar path: ${path}`);
      names.add(path);
      const link =
        kind === "symlink" || kind === "hardlink"
          ? (attributes.linkpath ?? string(header.subarray(157, 257)))
          : undefined;
      if (link?.includes("\0")) throw new Error("Invalid tar link");
      if (++count > limits.entries) throw new Error("Tar entry count exceeds limit");
      yield {
        path,
        kind,
        mode: number(header.subarray(100, 108)),
        mtime: Number.isFinite(mtime) ? mtime : 0,
        size,
        link,
        uname: uname || undefined,
        gname: gname || undefined,
        xattrs,
        data,
      };
    }
  } finally {
    await reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      // A cancelled read can complete after the consumer stopped.
    }
  }
}

export interface TarWriteEntry {
  /** Relative path without a leading "./"; "" is the archive root directory. */
  path: string;
  kind: "file" | "directory" | "symlink" | "hardlink";
  mode: number;
  mtime: number;
  link?: string;
  data?: Uint8Array;
}

const encoder = new TextEncoder();

function octal(target: Uint8Array, offset: number, length: number, value: number) {
  target.set(encoder.encode(`${value.toString(8).padStart(length - 1, "0")}\0`), offset);
}

function rawHeader(name: string, flag: number, mode: number, size: number, mtime: number, link = ""): Uint8Array {
  const header = new Uint8Array(512);
  header.set(encoder.encode(name).subarray(0, 100), 0);
  octal(header, 100, 8, mode & 0o7777);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, size > 0o77777777777 ? 0 : size);
  octal(header, 136, 12, Math.max(0, Math.min(mtime, 0o77777777777)));
  header.fill(32, 148, 156);
  header[156] = flag;
  header.set(encoder.encode(link).subarray(0, 100), 157);
  header.set(encoder.encode("ustar"), 257);
  header.set(encoder.encode("00"), 263);
  header.set(encoder.encode("root"), 265);
  header.set(encoder.encode("root"), 297);
  octal(header, 329, 8, 0);
  octal(header, 337, 8, 0);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.set(encoder.encode(`${checksum.toString(8).padStart(6, "0")}\0 `), 148);
  return header;
}

function paxRecord(key: string, value: string): Uint8Array {
  const body = ` ${key}=${value}\n`;
  const bodyLength = encoder.encode(body).length;
  let length = bodyLength + 1;
  while (String(length).length + bodyLength !== length) length = String(length).length + bodyLength;
  return encoder.encode(`${length}${body}`);
}

/** Deterministic root-owned ustar writer with PAX records for long names and sizes. */
export class TarWriter {
  constructor(private sink: (chunk: Uint8Array) => Promise<void> | void) {}

  private async padded(data: Uint8Array) {
    await this.sink(data);
    const rest = (512 - (data.length % 512)) % 512;
    if (rest) await this.sink(new Uint8Array(rest));
  }

  async add(entry: TarWriteEntry): Promise<void> {
    const name = entry.path === "" ? "./" : `./${entry.path}${entry.kind === "directory" ? "/" : ""}`;
    const data = entry.kind === "file" ? (entry.data ?? new Uint8Array()) : undefined;
    const size = data?.length ?? 0;
    const ascii = (value: string) => /^[\x20-\x7e]*$/.test(value);
    const records: Uint8Array[] = [];
    if (name.length > 100 || !ascii(name)) records.push(paxRecord("path", name));
    if (entry.link && (entry.link.length > 100 || !ascii(entry.link))) records.push(paxRecord("linkpath", entry.link));
    if (size > 0o77777777777) records.push(paxRecord("size", String(size)));
    if (records.length) {
      const pax = new Uint8Array(records.reduce((sum, item) => sum + item.length, 0));
      let offset = 0;
      for (const record of records) {
        pax.set(record, offset);
        offset += record.length;
      }
      await this.sink(rawHeader("./PaxHeader", 120, 0o644, pax.length, entry.mtime));
      await this.padded(pax);
    }
    const flag = entry.kind === "file" ? 48 : entry.kind === "directory" ? 53 : entry.kind === "symlink" ? 50 : 49;
    await this.sink(rawHeader(name, flag, entry.mode, size, entry.mtime, entry.link ?? ""));
    if (data && data.length) await this.padded(data);
  }

  async end(): Promise<void> {
    await this.sink(new Uint8Array(1024));
  }
}
