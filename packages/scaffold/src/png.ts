// SPDX-License-Identifier: Apache-2.0
/**
 * Browser-safe PNG helpers: no `node:zlib`, so packages whose entry is bundled for the browser
 * (m3-next-migrate) can import this module. The zlib stream uses stored blocks.
 */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  if (typeof Bun !== "undefined" && Bun.hash?.crc32) {
    return Bun.hash.crc32(bytes);
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 0xffff));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  const view = new DataView(out.buffer);
  out.set([0x78, 0x01]);
  let offset = 2;
  for (let index = 0; index < blocks; index += 1) {
    const chunk = data.subarray(index * 0xffff, (index + 1) * 0xffff);
    out[offset] = index === blocks - 1 ? 1 : 0; // BFINAL, BTYPE=00 (stored)
    view.setUint16(offset + 1, chunk.length, true);
    view.setUint16(offset + 3, ~chunk.length & 0xffff, true);
    out.set(chunk, offset + 5);
    offset += 5 + chunk.length;
  }
  view.setUint32(offset, adler32(data));
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type Rgba = readonly [number, number, number, number];

/** Material 3 baseline primary; the icon of an app that has no artwork yet. */
export const DEFAULT_ICON_COLOR: Rgba = [0x67, 0x50, 0xa4, 0xff];

/**
 * Solid-colour RGBA PNG. `tauri::generate_context!` refuses to compile without `icons/icon.png`;
 * this keeps a fresh project buildable until the app runs `tauri icon` with its own artwork.
 * 256 px is the smallest size `isUsableAppIcon` accepts.
 */
export function solidIconPng(size = 256, rgba: Rgba = DEFAULT_ICON_COLOR): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const row = new Uint8Array(1 + size * 4); // filter byte 0 + pixels
  for (let x = 0; x < size; x += 1) row.set(rgba, 1 + x * 4);
  const raw = new Uint8Array(row.length * size);
  for (let y = 0; y < size; y += 1) raw.set(row, y * row.length);
  const parts = [
    new Uint8Array(SIGNATURE),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlibStored(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

/** Reads the IHDR of a PNG; `null` when the bytes are not a PNG. */
export function pngInfo(bytes: Uint8Array): PngInfo | null {
  if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null;
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24]!,
    colorType: bytes[25]!,
  };
}

/** `tauri::generate_context!` accepts a square 8-bit RGBA PNG of at least 256 px as the app icon. */
export function isUsableAppIcon(bytes: Uint8Array): boolean {
  const info = pngInfo(bytes);
  return (
    info !== null && info.colorType === 6 && info.bitDepth === 8 && info.width === info.height && info.width >= 256
  );
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` to RGBA; `null` for anything else (named colours, functions). */
export function parseHexColor(text: string | null | undefined): [number, number, number, number] | null {
  const match = /^#([0-9a-f]{3,8})$/i.exec((text ?? "").trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(ch => ch + ch).join("");
  if (hex.length === 6) hex += "ff";
  if (hex.length !== 8) return null;
  return [0, 2, 4, 6].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
    number,
  ];
}
