// SPDX-License-Identifier: Apache-2.0
// Regenerates icons/icon-{16,32,48,128}.png (rounded square with three sort bars). Run: bun tools/make-icons.ts
import { deflateSync } from "node:zlib";

const BG = [229, 57, 53];
const FG = [255, 255, 255];
const SS = 4; // supersampling per axis

function covered(
  x: number,
  y: number,
  size: number,
): { bg: boolean; fg: boolean } {
  const u = x / size;
  const v = y / size;
  const r = 0.22;
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  const bg = (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
  const bars: [number, number][] = [
    [0.32, 0.6],
    [0.5, 0.48],
    [0.68, 0.36],
  ];
  const fg = bars.some(
    ([yc, w]) => Math.abs(v - yc) <= 0.05 && u >= 0.2 && u <= 0.2 + w,
  );
  return { bg, fg };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(
    8 + data.length,
    Bun.hash.crc32(out.subarray(4, 8 + data.length)),
  );
  return out;
}

function png(size: number): Uint8Array {
  const raw = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let a = 0;
      let f = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = covered(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size);
          if (c.bg) a++;
          if (c.bg && c.fg) f++;
        }
      }
      const n = SS * SS;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const mix = a ? f / a : 0;
      for (let k = 0; k < 3; k++)
        raw[i + k] = Math.round(BG[k] * (1 - mix) + FG[k] * mix);
      raw[i + 3] = Math.round((a / n) * 255);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  return Buffer.concat(parts);
}

await Promise.all(
  [16, 32, 48, 128].map((size) =>
    Bun.write(`${import.meta.dir}/../icons/icon-${size}.png`, png(size)),
  ),
);
console.log("icons written");
