// Shared binary data source for every console format parser: bounded random reads through
// Blob.slice(), sequential chunk streams through Blob.stream(), and an endian-aware view.

export type Endian = "le" | "be";

const latin1 = new TextDecoder("latin1");

/** Synchronous endian-aware reader over a byte window that starts at `base` in its source. */
export class BinaryView {
  readonly bytes: Uint8Array;
  readonly endian: Endian;
  readonly base: number;
  private readonly data: DataView;

  constructor(bytes: Uint8Array, endian: Endian = "le", base = 0) {
    this.bytes = bytes;
    this.endian = endian;
    this.base = base;
    this.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  has(offset: number, length: number): boolean {
    return offset >= 0 && offset + length <= this.bytes.byteLength;
  }

  u8(offset: number): number {
    return this.data.getUint8(offset);
  }

  u16(offset: number, endian = this.endian): number {
    return this.data.getUint16(offset, endian === "le");
  }

  u24(offset: number, endian = this.endian): number {
    const [a, b, c] = [this.u8(offset), this.u8(offset + 1), this.u8(offset + 2)];
    return endian === "le" ? a | (b << 8) | (c << 16) : (a << 16) | (b << 8) | c;
  }

  u32(offset: number, endian = this.endian): number {
    return this.data.getUint32(offset, endian === "le");
  }

  i32(offset: number, endian = this.endian): number {
    return this.data.getInt32(offset, endian === "le");
  }

  /** 64-bit value as a number; throws when it cannot be represented exactly. */
  u64(offset: number, endian = this.endian): number {
    const value = this.data.getBigUint64(offset, endian === "le");
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`64-bit value at ${offset} exceeds 2^53`);
    return Number(value);
  }

  big64(offset: number, endian = this.endian): bigint {
    return this.data.getBigUint64(offset, endian === "le");
  }

  slice(offset: number, length: number): Uint8Array {
    return this.bytes.subarray(offset, offset + length);
  }

  /** Latin-1 text with NUL padding and surrounding spaces removed. */
  ascii(offset: number, length: number): string {
    const end = Math.min(this.bytes.byteLength, offset + length);
    const raw = this.bytes.subarray(offset, end);
    const nul = raw.indexOf(0);
    return latin1.decode(nul < 0 ? raw : raw.subarray(0, nul)).trim();
  }

  hex(offset: number, length: number): string {
    return Buffer.from(this.slice(offset, length)).toString("hex");
  }

  equals(offset: number, signature: ArrayLike<number> | string): boolean {
    const bytes = typeof signature === "string" ? Buffer.from(signature, "latin1") : signature;
    if (!this.has(offset, bytes.length)) return false;
    for (let index = 0; index < bytes.length; index++) if (this.bytes[offset + index] !== bytes[index]) return false;
    return true;
  }

  with(endian: Endian): BinaryView {
    return new BinaryView(this.bytes, endian, this.base);
  }
}

export interface Chunk {
  offset: number;
  bytes: Uint8Array;
}

/** Lazily read file or blob. Reads never load more than the requested window. */
export class BinarySource {
  readonly blob: Blob;
  readonly path: string | undefined;
  private head: Uint8Array | undefined;
  static readonly headBytes = 0x10000;

  constructor(blob: Blob, path?: string) {
    this.blob = blob;
    this.path = path;
  }

  static open(path: string): BinarySource {
    return new BinarySource(Bun.file(path), path);
  }

  static from(bytes: Uint8Array<ArrayBuffer>, path?: string): BinarySource {
    return new BinarySource(new Blob([bytes]), path);
  }

  get size(): number {
    return this.blob.size;
  }

  /** Reads `[offset, offset + length)` clamped to the source; the first 64 KiB stay cached. */
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
      throw new RangeError(`invalid read ${offset}+${length}`);
    }
    const end = Math.min(this.size, offset + length);
    if (offset >= end) return new Uint8Array(0);
    if (end <= BinarySource.headBytes) {
      this.head ??= await this.blob.slice(0, Math.min(this.size, BinarySource.headBytes)).bytes();
      return this.head.subarray(offset, end);
    }
    return this.blob.slice(offset, end).bytes();
  }

  async view(offset: number, length: number, endian: Endian = "le"): Promise<BinaryView> {
    return new BinaryView(await this.read(offset, length), endian, offset);
  }

  /** Sequential chunks of `[start, end)` streamed through Blob.stream(). */
  async *chunks(start = 0, end = this.size): AsyncGenerator<Chunk> {
    let offset = start;
    for await (const bytes of this.blob.slice(start, Math.min(end, this.size)).stream()) {
      yield { offset, bytes };
      offset += bytes.byteLength;
    }
  }

  /** Offsets of `pattern` in `[start, end)`, found while streaming with a boundary overlap. */
  async find(
    pattern: Uint8Array | string,
    options: { start?: number; end?: number; limit?: number } = {},
  ): Promise<number[]> {
    const needle = typeof pattern === "string" ? Buffer.from(pattern, "latin1") : Buffer.from(pattern);
    const hits: number[] = [];
    const limit = options.limit ?? 16;
    let carry = Buffer.alloc(0);
    let carryOffset = options.start ?? 0;
    for await (const { offset, bytes } of this.chunks(options.start ?? 0, options.end ?? this.size)) {
      const window = carry.byteLength
        ? Buffer.concat([carry, bytes])
        : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const windowOffset = carry.byteLength ? carryOffset : offset;
      let at = window.indexOf(needle);
      while (at >= 0) {
        hits.push(windowOffset + at);
        if (hits.length >= limit) return hits;
        at = window.indexOf(needle, at + 1);
      }
      const keep = Math.min(needle.byteLength - 1, window.byteLength);
      carry = Buffer.from(window.subarray(window.byteLength - keep));
      carryOffset = windowOffset + window.byteLength - keep;
    }
    return hits;
  }

  /** Latin-1 regex matches over `[start, end)` while streaming; `carry` bounds a match length. */
  async matches(
    pattern: RegExp,
    options: {
      start?: number | undefined;
      end?: number | undefined;
      limit?: number | undefined;
      carry?: number | undefined;
    } = {},
  ): Promise<Array<{ offset: number; text: string }>> {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const regex = new RegExp(pattern.source, flags);
    const limit = options.limit ?? 16;
    const carryBytes = options.carry ?? 64;
    const found = new Map<number, string>();
    let carry = "";
    let carryOffset = options.start ?? 0;
    for await (const { offset, bytes } of this.chunks(options.start ?? 0, options.end ?? this.size)) {
      const text = carry + latin1.decode(bytes);
      const base = carry ? carryOffset : offset;
      for (const match of text.matchAll(regex)) {
        found.set(base + match.index, match[0]);
        if (found.size >= limit) break;
      }
      if (found.size >= limit) break;
      carry = text.slice(-carryBytes);
      carryOffset = base + text.length - carry.length;
    }
    return [...found].map(([offset, text]) => ({ offset, text })).sort((a, b) => a.offset - b.offset);
  }

  /** CRC-32 (IEEE) of `[start, end)` computed while streaming. */
  async crc32(start = 0, end = this.size): Promise<number> {
    let crc = 0;
    for await (const { bytes } of this.chunks(start, end)) crc = Bun.hash.crc32(bytes, crc);
    return crc >>> 0;
  }
}

export interface StreamDigest {
  bytes: number;
  chunks: number;
  crc32: string;
  md5: string;
  sha1: string;
  sha256: string;
  milliseconds: number;
}

/** One streaming pass computing the usual dump-verification digests. */
export async function digestSource(source: BinarySource, start = 0, end = source.size): Promise<StreamDigest> {
  const begin = performance.now();
  const md5 = new Bun.CryptoHasher("md5");
  const sha1 = new Bun.CryptoHasher("sha1");
  const sha256 = new Bun.CryptoHasher("sha256");
  let crc = 0;
  let bytes = 0;
  let chunks = 0;
  for await (const chunk of source.chunks(start, end)) {
    crc = Bun.hash.crc32(chunk.bytes, crc);
    md5.update(chunk.bytes);
    sha1.update(chunk.bytes);
    sha256.update(chunk.bytes);
    bytes += chunk.bytes.byteLength;
    chunks++;
  }
  return {
    bytes,
    chunks,
    crc32: hex32(crc >>> 0),
    md5: md5.digest("hex"),
    sha1: sha1.digest("hex"),
    sha256: sha256.digest("hex"),
    milliseconds: Math.round(performance.now() - begin),
  };
}

export function hex32(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

export function hex(value: number, digits = 0): string {
  return `0x${value.toString(16).padStart(digits, "0")}`;
}

/** CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF), used by Nintendo DS headers. */
export function crc16(bytes: Uint8Array, initial = 0xffff): number {
  let crc = initial;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}
