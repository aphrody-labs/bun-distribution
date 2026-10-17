#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Build the Windows icon (PNG-compressed ICO, 16-256 px) from the creator page icon.
// Usage: bun tools/make-ico.ts [source.png] [out.ico]
import { join } from "node:path";

const here = import.meta.dir;
const source = process.argv[2] ?? join(here, "../../../web/creator/assets/icon-256.png");
const out = process.argv[3] ?? join(here, "../assets/creator-kit.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const input = new Uint8Array(await Bun.file(source).arrayBuffer());
const images = await Promise.all(
  SIZES.map(async size => new Uint8Array(await new Bun.Image(input).resize(size, size).png().toBuffer())),
);

const header = new DataView(new ArrayBuffer(6 + 16 * SIZES.length));
header.setUint16(2, 1, true); // type: icon
header.setUint16(4, SIZES.length, true);
let offset = header.byteLength;
SIZES.forEach((size, i) => {
  const at = 6 + 16 * i;
  header.setUint8(at, size === 256 ? 0 : size);
  header.setUint8(at + 1, size === 256 ? 0 : size);
  header.setUint16(at + 4, 1, true); // planes
  header.setUint16(at + 6, 32, true); // bit count
  header.setUint32(at + 8, images[i]!.byteLength, true);
  header.setUint32(at + 12, offset, true);
  offset += images[i]!.byteLength;
});
await Bun.write(out, new Blob([header.buffer, ...images]));
console.log(`${out} (${SIZES.join(", ")})`);
