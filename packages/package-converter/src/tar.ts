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
