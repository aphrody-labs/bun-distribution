// SPDX-License-Identifier: Apache-2.0
/**
 * Valve KeyValues: the text VDF dialect (`appmanifest_*.acf`, `libraryfolders.vdf`,
 * `localconfig.vdf`, `remotecache.vdf`) and the binary KeyValues encoding used inside
 * `appinfo.vdf` and `packageinfo.vdf`.
 */

export type KvValue = string | KvObject;
export interface KvObject {
  [key: string]: KvValue;
}

/** Parses a text VDF document into nested objects. Duplicate keys keep the last value. */
export function parseTextKv(text: string): KvObject {
  const root: KvObject = {};
  const stack: KvObject[] = [root];
  let i = 0;
  const n = text.length;
  let pendingKey: string | null = null;

  const skipWs = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0xfeff)
        i++;
      else if (c === 0x2f && text.charCodeAt(i + 1) === 0x2f) {
        while (i < n && text.charCodeAt(i) !== 0x0a) i++;
      } else break;
    }
  };
  const readToken = (): string | null => {
    skipWs();
    if (i >= n) return null;
    const c = text[i];
    if (c === "{" || c === "}") {
      i++;
      return c;
    }
    if (c === '"') {
      i++;
      let out = "";
      let closed = false;
      while (i < n) {
        const ch = text[i];
        if (ch === "\\") {
          const nx = text[i + 1];
          out +=
            nx === "n"
              ? "\n"
              : nx === "t"
                ? "\t"
                : nx === "r"
                  ? "\r"
                  : (nx ?? "");
          i += 2;
        } else if (ch === '"') {
          i++;
          closed = true;
          break;
        } else {
          out += ch;
          i++;
        }
      }
      if (!closed)
        throw new Error(`text KV: unterminated quoted token at ${i}`);
      return out;
    }
    // Bare token (up to whitespace or brace); `[$COND]` conditionals are skipped.
    let start = i;
    while (i < n && !/[\s{}"]/.test(text[i]!)) i++;
    const tok = text.slice(start, i);
    if (tok.startsWith("[") && tok.endsWith("]")) return readToken();
    return tok;
  };

  for (;;) {
    const tok = readToken();
    if (tok === null) break;
    const top = stack[stack.length - 1]!;
    if (tok === "{") {
      if (pendingKey === null)
        throw new Error(`text KV: object has no key at ${i - 1}`);
      const obj: KvObject = {};
      top[pendingKey] = obj;
      stack.push(obj);
      pendingKey = null;
    } else if (tok === "}") {
      if (pendingKey !== null)
        throw new Error(
          `text KV: key has no value before closing object at ${i - 1}`,
        );
      if (stack.length === 1)
        throw new Error(`text KV: unexpected closing object at ${i - 1}`);
      stack.pop();
      pendingKey = null;
    } else if (pendingKey === null) {
      pendingKey = tok;
    } else {
      top[pendingKey] = tok;
      pendingKey = null;
    }
  }
  if (pendingKey !== null)
    throw new Error(`text KV: key has no value at end of input: ${pendingKey}`);
  if (stack.length !== 1)
    throw new Error(`text KV: ${stack.length - 1} unterminated object(s)`);
  return root;
}

export const kvGet = (
  obj: KvValue | null | undefined,
  ...path: string[]
): KvValue | undefined => {
  let cur: KvValue | undefined = obj ?? undefined;
  for (const p of path) {
    if (cur === undefined || typeof cur === "string") return undefined;
    cur = cur[p] ?? cur[p.toLowerCase()];
  }
  return cur;
};
export const kvStr = (
  obj: KvValue | null | undefined,
  ...path: string[]
): string | null => {
  const v = kvGet(obj, ...path);
  return typeof v === "string" ? v : null;
};
export const kvInt = (
  obj: KvValue | null | undefined,
  ...path: string[]
): number | null => {
  const s = kvStr(obj, ...path);
  if (s === null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
export const kvObj = (
  obj: KvValue | null | undefined,
  ...path: string[]
): KvObject | null => {
  const v = kvGet(obj, ...path);
  return v !== undefined && typeof v !== "string" ? v : null;
};

/** Little-endian byte cursor shared by the binary parsers. */
export class Cursor {
  pos = 0;
  readonly view: DataView;
  constructor(
    readonly bytes: Uint8Array,
    readonly end = bytes.byteLength,
  ) {
    if (!Number.isSafeInteger(end) || end < 0 || end > bytes.byteLength) {
      throw new RangeError("binary KV: invalid cursor boundary");
    }
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining(): number {
    return this.end - this.pos;
  }
  private require(length: number): void {
    if (
      !Number.isSafeInteger(this.pos) ||
      this.pos < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > this.remaining
    ) {
      throw new RangeError(`binary KV: truncated input at ${this.pos}`);
    }
  }
  u8(): number {
    this.require(1);
    return this.bytes[this.pos++]!;
  }
  u32(): number {
    this.require(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    this.require(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    this.require(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u64(): bigint {
    this.require(8);
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  }
  i64(): bigint {
    this.require(8);
    const v = this.view.getBigInt64(this.pos, true);
    this.pos += 8;
    return v;
  }
  take(len: number): Uint8Array {
    this.require(len);
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  cstr(): string {
    const start = this.pos;
    while (this.pos < this.end && this.bytes[this.pos] !== 0) this.pos++;
    if (this.pos >= this.end)
      throw new Error(`binary KV: unterminated UTF-8 string at ${start}`);
    const s = utf8.decode(this.bytes.subarray(start, this.pos));
    this.pos++;
    return s;
  }
  wstr(): string {
    const start = this.pos;
    while (
      this.pos + 1 < this.end &&
      !(this.bytes[this.pos] === 0 && this.bytes[this.pos + 1] === 0)
    )
      this.pos += 2;
    if (this.pos + 1 >= this.end)
      throw new Error(`binary KV: unterminated UTF-16LE string at ${start}`);
    const s = utf16.decode(this.bytes.subarray(start, this.pos));
    this.pos += 2;
    return s;
  }
}
const utf8 = new TextDecoder("utf-8", { fatal: true });
const utf16 = new TextDecoder("utf-16le", { fatal: true });

export const BIN_KV = {
  OBJECT: 0x00,
  STRING: 0x01,
  INT32: 0x02,
  FLOAT32: 0x03,
  POINTER: 0x04,
  WSTRING: 0x05,
  COLOR: 0x06,
  UINT64: 0x07,
  END: 0x08,
  INT64: 0x0a,
  END_ALT: 0x0b,
} as const;

/**
 * Parses one binary KeyValues object at the cursor. With `stringTable` (appinfo v41), each key is
 * a `u32` index into the table instead of an inline C string. Values are normalized to strings so
 * the result shares the text-KV shape.
 */
export function parseBinaryKv(
  cur: Cursor,
  stringTable: string[] | null,
): KvObject {
  const readKey = (): string => {
    if (stringTable) {
      const idx = cur.u32();
      const key = stringTable[idx];
      if (key === undefined)
        throw new Error(`binary KV: string-table index ${idx} is out of range`);
      return key;
    }
    return cur.cstr();
  };
  const readObject = (): KvObject => {
    const obj: KvObject = {};
    for (;;) {
      if (cur.remaining <= 0)
        throw new Error(`binary KV: missing object terminator at ${cur.pos}`);
      const type = cur.u8();
      if (type === BIN_KV.END || type === BIN_KV.END_ALT) return obj;
      const key = readKey();
      switch (type) {
        case BIN_KV.OBJECT:
          obj[key] = readObject();
          break;
        case BIN_KV.STRING:
          obj[key] = cur.cstr();
          break;
        case BIN_KV.WSTRING:
          obj[key] = cur.wstr();
          break;
        case BIN_KV.INT32:
        case BIN_KV.COLOR:
        case BIN_KV.POINTER:
          obj[key] = String(cur.i32());
          break;
        case BIN_KV.FLOAT32:
          obj[key] = String(cur.f32());
          break;
        case BIN_KV.UINT64:
          obj[key] = cur.u64().toString();
          break;
        case BIN_KV.INT64:
          obj[key] = cur.i64().toString();
          break;
        default:
          throw new Error(
            `binary KV: unknown type 0x${type.toString(16)} at ${cur.pos - 1}`,
          );
      }
    }
  };
  return readObject();
}

/** Flattens nested KV into `a/b/c` → string pairs. */
export function flattenKv(
  obj: KvObject,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}/${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flattenKv(v, key, out);
  }
  return out;
}

/**
 * Escapes a text VDF token the way the Steam client writes it: backslash and double quote only
 * (the client keeps newlines and tabs raw inside quoted values, e.g. SDL controller mappings).
 */
const escapeKv = (s: string): string => s.replace(/[\\"]/g, (c) => `\\${c}`);

/**
 * Serializes nested objects to text VDF in the Steam client layout (tab indentation, two tabs
 * between key and value). `parseTextKv(stringifyTextKv(x))` round-trips `x`.
 */
export function stringifyTextKv(obj: KvObject, depth = 0): string {
  const pad = "\t".repeat(depth);
  let out = "";
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      out += `${pad}"${escapeKv(key)}"\t\t"${escapeKv(value)}"\n`;
    } else {
      out += `${pad}"${escapeKv(key)}"\n${pad}{\n${stringifyTextKv(value, depth + 1)}${pad}}\n`;
    }
  }
  return out;
}

/** Case-insensitive child lookup that returns the key as stored (Steam keys keep their case). */
export function kvKey(obj: KvObject, key: string): string | undefined {
  if (Object.hasOwn(obj, key)) return key;
  const lower = key.toLowerCase();
  return Object.keys(obj).find((k) => k.toLowerCase() === lower);
}

/** Returns the child object at `path`, creating missing levels (case-insensitive match). */
export function kvEnsure(obj: KvObject, ...path: string[]): KvObject {
  let cur = obj;
  for (const p of path) {
    const k = kvKey(cur, p) ?? p;
    const next = cur[k];
    if (next === undefined || typeof next === "string") cur[k] = {};
    cur = cur[k] as KvObject;
  }
  return cur;
}

/** One typed binary KeyValues leaf; objects are nested {@link BinKvObject}s. */
export type BinKvLeaf =
  | { type: "string"; value: string }
  | { type: "wstring"; value: string }
  | { type: "int32"; value: number }
  | { type: "pointer"; value: number }
  | { type: "color"; value: number }
  | { type: "float32"; value: number }
  | { type: "uint64"; value: bigint }
  | { type: "int64"; value: bigint };
export type BinKvValue = BinKvLeaf | BinKvObject;
export interface BinKvObject {
  [key: string]: BinKvValue;
}

const isLeaf = (v: BinKvValue): v is BinKvLeaf =>
  typeof (v as BinKvLeaf).type === "string" &&
  "value" in v &&
  Object.keys(v).length === 2;

/**
 * Parses binary KeyValues keeping each value's wire type, so {@link writeBinaryKv} reproduces
 * the input byte for byte (`shortcuts.vdf`, `appinfo.vdf` sections without a string table).
 */
export function parseBinaryKvTyped(cur: Cursor): BinKvObject {
  const obj: BinKvObject = {};
  for (;;) {
    if (cur.remaining <= 0)
      throw new Error(`binary KV: missing object terminator at ${cur.pos}`);
    const type = cur.u8();
    if (type === BIN_KV.END || type === BIN_KV.END_ALT) return obj;
    const key = cur.cstr();
    switch (type) {
      case BIN_KV.OBJECT:
        obj[key] = parseBinaryKvTyped(cur);
        break;
      case BIN_KV.STRING:
        obj[key] = { type: "string", value: cur.cstr() };
        break;
      case BIN_KV.WSTRING:
        obj[key] = { type: "wstring", value: cur.wstr() };
        break;
      case BIN_KV.INT32:
        obj[key] = { type: "int32", value: cur.i32() };
        break;
      case BIN_KV.POINTER:
        obj[key] = { type: "pointer", value: cur.i32() };
        break;
      case BIN_KV.COLOR:
        obj[key] = { type: "color", value: cur.i32() };
        break;
      case BIN_KV.FLOAT32:
        obj[key] = { type: "float32", value: cur.f32() };
        break;
      case BIN_KV.UINT64:
        obj[key] = { type: "uint64", value: cur.u64() };
        break;
      case BIN_KV.INT64:
        obj[key] = { type: "int64", value: cur.i64() };
        break;
      default:
        throw new Error(
          `binary KV: unknown type 0x${type.toString(16)} at ${cur.pos - 1}`,
        );
    }
  }
}

const utf8e = new TextEncoder();

/** Serializes typed binary KeyValues; the root object is closed with `END` (0x08). */
export function writeBinaryKv(obj: BinKvObject): Uint8Array {
  const chunks: Uint8Array[] = [];
  const byte = (b: number) => chunks.push(Uint8Array.of(b));
  const cstr = (s: string) => {
    chunks.push(utf8e.encode(s));
    byte(0);
  };
  const num = (size: 4 | 8, set: (v: DataView) => void) => {
    const b = new Uint8Array(size);
    set(new DataView(b.buffer));
    chunks.push(b);
  };
  const walk = (o: BinKvObject) => {
    for (const [key, v] of Object.entries(o)) {
      if (!isLeaf(v)) {
        byte(BIN_KV.OBJECT);
        cstr(key);
        walk(v);
        continue;
      }
      switch (v.type) {
        case "string":
          byte(BIN_KV.STRING);
          cstr(key);
          cstr(v.value);
          break;
        case "wstring": {
          byte(BIN_KV.WSTRING);
          cstr(key);
          const units = new Uint8Array(v.value.length * 2 + 2);
          const dv = new DataView(units.buffer);
          for (let i = 0; i < v.value.length; i++)
            dv.setUint16(i * 2, v.value.charCodeAt(i), true);
          chunks.push(units);
          break;
        }
        case "int32":
        case "pointer":
        case "color":
          byte(
            v.type === "int32"
              ? BIN_KV.INT32
              : v.type === "pointer"
                ? BIN_KV.POINTER
                : BIN_KV.COLOR,
          );
          cstr(key);
          num(4, (d) => d.setInt32(0, v.value, true));
          break;
        case "float32":
          byte(BIN_KV.FLOAT32);
          cstr(key);
          num(4, (d) => d.setFloat32(0, v.value, true));
          break;
        case "uint64":
          byte(BIN_KV.UINT64);
          cstr(key);
          num(8, (d) => d.setBigUint64(0, v.value, true));
          break;
        case "int64":
          byte(BIN_KV.INT64);
          cstr(key);
          num(8, (d) => d.setBigInt64(0, v.value, true));
          break;
      }
    }
    byte(BIN_KV.END);
  };
  walk(obj);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Reads `shortcuts.vdf` (binary KV, root `shortcuts` holding `"0"`, `"1"`, ... entries). */
export function parseShortcuts(bytes: Uint8Array): BinKvObject {
  const root = parseBinaryKvTyped(new Cursor(bytes));
  const key = kvKey(root as unknown as KvObject, "shortcuts");
  const list = key ? root[key] : undefined;
  return list && !isLeaf(list) ? list : {};
}

/** Writes `shortcuts.vdf` from its `"0"`, `"1"`, ... entries (the file ends with two `END` bytes). */
export function writeShortcuts(entries: BinKvObject): Uint8Array {
  return writeBinaryKv({ shortcuts: entries });
}
