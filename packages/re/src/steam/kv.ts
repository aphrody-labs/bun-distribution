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
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0xfeff) i++;
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
      while (i < n) {
        const ch = text[i];
        if (ch === "\\") {
          const nx = text[i + 1];
          out += nx === "n" ? "\n" : nx === "t" ? "\t" : nx === "r" ? "\r" : (nx ?? "");
          i += 2;
        } else if (ch === '"') {
          i++;
          break;
        } else {
          out += ch;
          i++;
        }
      }
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
      const obj: KvObject = {};
      if (pendingKey !== null) top[pendingKey] = obj;
      stack.push(obj);
      pendingKey = null;
    } else if (tok === "}") {
      if (stack.length > 1) stack.pop();
      pendingKey = null;
    } else if (pendingKey === null) {
      pendingKey = tok;
    } else {
      top[pendingKey] = tok;
      pendingKey = null;
    }
  }
  return root;
}

export const kvGet = (obj: KvValue | null | undefined, ...path: string[]): KvValue | undefined => {
  let cur: KvValue | undefined = obj ?? undefined;
  for (const p of path) {
    if (cur === undefined || typeof cur === "string") return undefined;
    cur = cur[p] ?? cur[p.toLowerCase()];
  }
  return cur;
};
export const kvStr = (obj: KvValue | null | undefined, ...path: string[]): string | null => {
  const v = kvGet(obj, ...path);
  return typeof v === "string" ? v : null;
};
export const kvInt = (obj: KvValue | null | undefined, ...path: string[]): number | null => {
  const s = kvStr(obj, ...path);
  if (s === null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
export const kvObj = (obj: KvValue | null | undefined, ...path: string[]): KvObject | null => {
  const v = kvGet(obj, ...path);
  return v !== undefined && typeof v !== "string" ? v : null;
};

/** Little-endian byte cursor shared by the binary parsers. */
export class Cursor {
  pos = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining(): number {
    return this.bytes.length - this.pos;
  }
  u8(): number {
    return this.bytes[this.pos++]!;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u64(): bigint {
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  }
  i64(): bigint {
    const v = this.view.getBigInt64(this.pos, true);
    this.pos += 8;
    return v;
  }
  take(len: number): Uint8Array {
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  cstr(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0) this.pos++;
    const s = utf8.decode(this.bytes.subarray(start, this.pos));
    this.pos++;
    return s;
  }
  wstr(): string {
    const start = this.pos;
    while (this.pos + 1 < this.bytes.length && !(this.bytes[this.pos] === 0 && this.bytes[this.pos + 1] === 0))
      this.pos += 2;
    const s = utf16.decode(this.bytes.subarray(start, this.pos));
    this.pos += 2;
    return s;
  }
}
const utf8 = new TextDecoder("utf-8");
const utf16 = new TextDecoder("utf-16le");

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
export function parseBinaryKv(cur: Cursor, stringTable: string[] | null): KvObject {
  const readKey = (): string => {
    if (stringTable) {
      const idx = cur.u32();
      return stringTable[idx] ?? `#${idx}`;
    }
    return cur.cstr();
  };
  const readObject = (): KvObject => {
    const obj: KvObject = {};
    for (;;) {
      if (cur.remaining <= 0) return obj;
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
          throw new Error(`binary KV: unknown type 0x${type.toString(16)} at ${cur.pos - 1}`);
      }
    }
  };
  return readObject();
}

/** Flattens nested KV into `a/b/c` → string pairs. */
export function flattenKv(obj: KvObject, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}/${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flattenKv(v, key, out);
  }
  return out;
}
