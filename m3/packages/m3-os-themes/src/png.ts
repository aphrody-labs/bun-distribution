// SPDX-License-Identifier: Apache-2.0
// Minimal PNG encoder (8-bit RGB, no interlace) so theme images need no native dependency.
import { rgb } from "./color.ts";
import { deflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)) >>> 0);
  return out;
}

export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  // PNG IDAT requires a zlib stream; Bun.deflateSync emits raw DEFLATE on this runtime.
  const idat = deflateSync(raw);
  const parts = [
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/** Vertical gradient between two `#rrggbb` colours. */
export function gradientPng(
  width: number,
  height: number,
  top: string,
  bottom: string,
): Uint8Array {
  const a = rgb(top);
  const b = rgb(bottom);
  return encodePng(width, height, (_x, y) => {
    const t = height <= 1 ? 0 : y / (height - 1);
    return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as [
      number,
      number,
      number,
    ];
  });
}
