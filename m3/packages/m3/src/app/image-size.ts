// SPDX-License-Identifier: Apache-2.0
// Intrinsic size of PNG, JPEG, GIF, WebP and SVG images, read from their headers.

export interface ImageSize {
  width: number;
  height: number;
}

function svgSize(bytes: Uint8Array): ImageSize | undefined {
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return undefined;
  const attr = (name: string) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']([\\d.]+)(px)?["']`, "i").exec(tag);
    return m ? Number(m[1]) : undefined;
  };
  let width = attr("width");
  let height = attr("height");
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i
    .exec(tag)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4) {
    width ??= viewBox[2];
    height ??= viewBox[3];
  }
  return width && height ? { width, height } : undefined;
}

function jpegSize(view: DataView): ImageSize | undefined {
  let offset = 2;
  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return undefined;
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    offset += 2 + length;
  }
  return undefined;
}

function webpSize(view: DataView, bytes: Uint8Array): ImageSize | undefined {
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X")
    return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) };
  if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return undefined;
}

/** Size of an encoded image, or `undefined` when the format is not recognised. */
export function imageSize(bytes: Uint8Array, ext = ""): ImageSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50)
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49)
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(view);
  if (bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF") return webpSize(view, bytes);
  if (ext.toLowerCase() === ".svg" || bytes[0] === 0x3c) return svgSize(bytes);
  return undefined;
}
