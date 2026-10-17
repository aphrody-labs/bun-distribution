// SPDX-License-Identifier: Apache-2.0
// loadIcon() outside a browser: format detection, symbol grammar and CDN layout, ICO directory and
// entry choice, sizes, SVG output, errors. The cases mirror the crate's unit tests (src/loader.rs).
import { afterAll, describe, expect, test } from "bun:test";
import {
  bestEntry,
  detectFormat,
  dimensions,
  icoEntries,
  icoEntryBlob,
  LoadIconError,
  loadIcon,
  parseColor,
  parseSymbol,
  symbolUrl,
} from "./load";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="#000"><path d="M240-200h480v-360L480-740 240-560v360Z"/></svg>`;
const hits: string[] = [];
const cdn = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    hits.push(path);
    if (path.includes("/home/")) return new Response(SVG);
    if (path.includes("/evil/")) return new Response(SVG.replace("<path", "<script>alert(1)</script><path"));
    if (path.includes("/broken/")) return new Response("", { status: 500 });
    return new Response("", { status: 404 });
  },
});
afterAll(() => cdn.stop(true));
const origin = cdn.url.href;

/** ICO with a BMP header per entry (40-byte DIB) and a PNG entry carrying only its IHDR. */
function ico(entries: { side: number; bits: number; png?: boolean }[]): Uint8Array<ArrayBuffer> {
  const blobs = entries.map(({ side, bits, png }) => {
    if (png) {
      const d = new Uint8Array(33);
      d.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(d.buffer).setUint32(16, side);
      new DataView(d.buffer).setUint32(20, side);
      return d;
    }
    const d = new Uint8Array(40);
    const v = new DataView(d.buffer);
    v.setUint32(0, 40, true);
    v.setInt32(4, side, true);
    v.setInt32(8, side * 2, true);
    v.setUint16(14, bits, true);
    return d;
  });
  const out = new Uint8Array(6 + entries.length * 16 + blobs.reduce((n, b) => n + b.length, 0));
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, entries.length, true);
  let offset = 6 + entries.length * 16;
  entries.forEach((e, i) => {
    const at = 6 + i * 16;
    out[at] = out[at + 1] = e.side >= 256 ? 0 : e.side;
    v.setUint16(at + 6, e.png ? 0 : e.bits, true);
    v.setUint32(at + 8, blobs[i]!.length, true);
    v.setUint32(at + 12, offset, true);
    out.set(blobs[i]!, offset);
    offset += blobs[i]!.length;
  });
  return out;
}

const b = (...x: number[]) => new Uint8Array(x);
const text = (s: string) => new TextEncoder().encode(s);
const entry = (side: number, bits: number) => ({
  width: side,
  height: side,
  bits,
  png: false,
});

test("detectFormat reads magic bytes like Format::detecter", () => {
  expect(detectFormat(b(0x89, 0x50, 0x4e, 0x47, 13, 10))).toBe("png");
  expect(detectFormat(b(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
  expect(detectFormat(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
  expect(detectFormat(text("GIF89a"))).toBe("gif");
  expect(detectFormat(b(0, 0, 1, 0, 1, 0))).toBe("ico");
  expect(detectFormat(b(0, 0, 1, 0, 0, 0))).toBeUndefined();
  expect(detectFormat(text(`\uFEFF<?xml version="1.0"?><!-- c --><!DOCTYPE svg><svg/>`))).toBe("svg");
  expect(detectFormat(text("<svgx>"))).toBeUndefined();
  expect(detectFormat(text("hello"))).toBeUndefined();
});

describe("symbols", () => {
  test("grammar and CDN layout (same paths as symbols::cdn_path)", () => {
    expect(symbolUrl(parseSymbol("symbol:home"), "https://cdn.aphrody.com")).toBe(
      "https://cdn.aphrody.com/s/i/short-term/release/materialsymbolsoutlined/home/default/24px.svg",
    );
    expect(symbolUrl(parseSymbol("symbol:settings?style=rounded&wght=300&grad=-25&fill=1&opsz=48"))).toBe(
      "https://cdn.aphrody.com/s/i/short-term/release/materialsymbolsrounded/settings/wght300gradN25fill1/48px.svg",
    );
    for (const bad of ["symbol:Home", "symbol:home?style=bold", "symbol:home?wght=450", "symbol:home?x=1"]) {
      expect(() => parseSymbol(bad)).toThrow(LoadIconError);
    }
  });

  test("SVG output: sized to opsz × scale or to size and tinted", async () => {
    const plain = await loadIcon("symbol:home", { origin, output: "svg" });
    expect(plain).toMatchObject({
      format: "symbol",
      intrinsic: [24, 24],
      width: 24,
      height: 24,
    });
    expect(plain.svg).toStartWith(`<svg width="24" height="24" xmlns=`);

    const big = await loadIcon("symbol:home?style=sharp&fill=1&opsz=48", {
      origin,
      output: "svg",
      size: 32,
      scale: 2,
      tint: "#6750a4",
    });
    expect(big).toMatchObject({ intrinsic: [48, 48], width: 64, height: 64 });
    expect(big.svg).toStartWith(`<svg width="64" height="64" fill="#6750a4" color="#6750a4" xmlns=`);
    expect(big.svg).not.toContain(`fill="#000"`);
    expect(hits).toContain("/s/i/short-term/release/materialsymbolssharp/home/fill1/48px.svg");

    const filled = await loadIcon(new TextEncoder().encode(SVG.replace('width="24"', 'width="48"')), {
      output: "svg",
      size: 24,
      fit: "fill",
    });
    expect(filled).toMatchObject({
      format: "svg",
      intrinsic: [48, 24],
      width: 24,
      height: 24,
    });
    expect(filled.svg).toContain(`preserveAspectRatio="none"`);
  });

  test("errors name their cause", async () => {
    const svg = { origin, output: "svg" } as const;
    await expect(loadIcon("symbol:no_such_icon", svg)).rejects.toThrow('unknown symbol "no_such_icon"');
    await expect(loadIcon("symbol:broken", svg)).rejects.toThrow("HTTP 500");
    await expect(loadIcon("symbol:evil", svg)).rejects.toThrow("scripts, event handlers");
    await expect(loadIcon("symbol:home", { ...svg, tint: "purple" })).rejects.toThrow("tint purple");
    await expect(loadIcon("symbol:home", { ...svg, scale: 0 })).rejects.toThrow("scale 0");
    await expect(loadIcon("symbol:home", { ...svg, size: 20_000 })).rejects.toThrow("out of 1..16384");
    await expect(loadIcon(new Uint8Array([1, 2, 3]))).rejects.toThrow("unknown image format");
    await expect(loadIcon(ico([{ side: 16, bits: 32 }]), { output: "svg" })).rejects.toThrow("no SVG output");
    await expect(loadIcon("symbol:home", { origin })).rejects.toThrow("createImageBitmap");
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(loadIcon("symbol:home", { ...svg, fetch: down })).rejects.toThrow("offline");
  });
});

describe("ico", () => {
  test("directory: BMP sizes from the directory, PNG sizes from IHDR, 256 written as 0", () => {
    const entries = icoEntries(
      ico([
        { side: 16, bits: 4 },
        { side: 48, bits: 24 },
        { side: 256, bits: 32, png: true },
      ]),
    );
    expect(entries.map(({ width, height, bits, png }) => [width, height, bits, png])).toEqual([
      [16, 16, 4, false],
      [48, 48, 24, false],
      [256, 256, 32, true],
    ]);
    expect(() => icoEntries(ico([{ side: 16, bits: 4 }]).subarray(0, 30))).toThrow("past the end");
    expect(() => icoEntries(new Uint8Array([0, 0, 1, 0, 9, 0]))).toThrow("truncated");
  });

  test("bestEntry: same answers as meilleure_entree (crate test choix_d_entree)", () => {
    const entries = [entry(16, 32), entry(32, 8), entry(32, 32), entry(48, 32), entry(256, 32)];
    expect([24, 32, 49, 512].map(t => bestEntry(entries, t))).toEqual([2, 2, 4, 4]);
    expect(bestEntry(entries)).toBe(4);
    expect(bestEntry([], 16)).toBe(-1);
  });

  test("icoEntryBlob: PNG as is, BMP wrapped in a one-entry ICO", async () => {
    const [bmp, png] = icoEntries(
      ico([
        { side: 24, bits: 8 },
        { side: 300, bits: 32, png: true },
      ]),
    );
    const one = new Uint8Array(await icoEntryBlob(bmp!).arrayBuffer());
    expect(icoEntryBlob(bmp!).type).toBe("image/x-icon");
    expect(icoEntries(one).map(({ width, bits, png: isPng }) => [width, bits, isPng])).toEqual([[24, 8, false]]);
    expect(one.subarray(22)).toEqual(bmp!.data);
    expect(icoEntryBlob(png!).type).toBe("image/png");
    expect(icoEntryBlob(png!).size).toBe(png!.data.length);
  });
});

test("dimensions and colours: same arithmetic as the crate", () => {
  expect(dimensions([200, 100], { size: 50, fit: "contain" })).toEqual({
    width: 50,
    height: 25,
  });
  expect(dimensions([200, 100], { size: 50, fit: "cover" })).toEqual({
    width: 100,
    height: 50,
    crop: 50,
  });
  expect(dimensions([200, 100], { size: 50, fit: "fill" })).toEqual({
    width: 50,
    height: 50,
  });
  expect(dimensions([200, 100], { size: 50, fit: "none" })).toEqual({
    width: 200,
    height: 100,
  });
  expect(dimensions([20, 10], { scale: 2 })).toEqual({ width: 40, height: 20 });
  expect(() => dimensions([1, 1], { size: 20_000, fit: "fill" })).toThrow(LoadIconError);
  expect(() => dimensions([0, 1], {})).toThrow("zero size");
  expect(parseColor("#6750a4")).toEqual([0x67, 0x50, 0xa4, 255]);
  expect(parseColor("#fff")).toEqual([255, 255, 255, 255]);
  expect(parseColor("#00000080")).toEqual([0, 0, 0, 0x80]);
  expect(parseColor("6750a4")).toBeUndefined();
  expect(parseColor("#ggg")).toBeUndefined();
});
