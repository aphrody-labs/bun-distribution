// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createQr, drawQr, renderQrPixels, type QrCanvas, type QrOptions } from "../src/index.ts";
import fixtures from "./fixtures/qrcode-1.5.4.json" with { type: "json" };

function unpackBits(base64: string, count: number): Uint8Array {
  const bytes = Buffer.from(base64, "base64");
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = (bytes[i >> 3]! >> (7 - (i & 7))) & 1;
  return out;
}

describe("parity with qrcode 1.5.4 (generated fixtures)", () => {
  test("fixture set is substantial", () => {
    expect(fixtures.oracle).toBe("qrcode@1.5.4");
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(200);
  });

  test("every symbol is module-for-module identical", () => {
    let mismatches = 0;
    for (const fixture of fixtures.cases) {
      const symbol = createQr(fixture.text, fixture.options as QrOptions);
      const expected = unpackBits(fixture.bits, fixture.size * fixture.size);
      const same =
        symbol.version === fixture.version &&
        symbol.maskPattern === fixture.maskPattern &&
        symbol.modules.size === fixture.size &&
        symbol.modules.data.every((bit, i) => bit === expected[i]);
      if (!same) {
        mismatches += 1;
        console.error("mismatch", JSON.stringify(fixture.text).slice(0, 60), fixture.options);
      }
    }
    expect(mismatches).toBe(0);
  });
});

describe("encoder behaviour", () => {
  test("version 1 symbol has the fixed patterns", () => {
    const symbol = createQr("A", { errorCorrectionLevel: "L" });
    expect(symbol.version).toBe(1);
    expect(symbol.modules.size).toBe(21);
    const at = (row: number, col: number) => symbol.modules.data[row * 21 + col];
    expect([at(0, 0), at(0, 6), at(6, 0), at(6, 6), at(3, 3), at(1, 1)]).toEqual([
      1, 1, 1, 1, 1, 0,
    ]);
    expect(at(13, 8)).toBe(1);
  });

  test("segments switch to numeric and alphanumeric where cheaper", () => {
    const symbol = createQr("abc0123456789012345678901234567890ABCDEFGHIJKLMN");
    expect(symbol.segments.map((s) => s.mode)).toEqual(["byte", "numeric", "alphanumeric"]);
  });

  test("rejects empty input, oversize data and a too-small forced version", () => {
    expect(() => createQr("")).toThrow("No input text");
    expect(() => createQr("x".repeat(3000), { errorCorrectionLevel: "H" })).toThrow("too big");
    expect(() => createQr("x".repeat(100), { version: 1 })).toThrow("cannot contain");
  });
});

describe("renderer", () => {
  test("pixel size follows margin and scale like qrcode", () => {
    const symbol = createQr("hello", { errorCorrectionLevel: "M" });
    const { width, height, pixels } = renderQrPixels(symbol, { margin: 1, scale: 3 });
    expect(width).toBe((symbol.modules.size + 2) * 3);
    expect(height).toBe(width);
    expect(pixels.length).toBe(width * height * 4);
    expect(Array.from(pixels.slice(0, 4))).toEqual([255, 255, 255, 255]);
    const first = (1 * 3 * width + 1 * 3) * 4;
    expect(Array.from(pixels.slice(first, first + 4))).toEqual([0, 0, 0, 255]);
  });

  test("width option fits the symbol to the requested size", () => {
    const symbol = createQr("hello", { errorCorrectionLevel: "M" });
    const { width } = renderQrPixels(symbol, { width: 192, margin: 1 });
    expect(width).toBe(192);
  });

  test("drawQr sizes the canvas and writes the image", () => {
    const calls: string[] = [];
    const canvas: QrCanvas = {
      width: 1,
      height: 1,
      style: { width: "", height: "" },
      getContext: () => ({
        clearRect: () => calls.push("clear"),
        putImageData: (image: ImageData) => calls.push(`put:${image.width}x${image.height}`),
      }),
    };
    (globalThis as { ImageData?: unknown }).ImageData ??= class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    };
    drawQr(canvas, "hello", { width: 192, margin: 1, errorCorrectionLevel: "M" });
    expect(canvas.width).toBe(192);
    expect(canvas.style?.width).toBe("192px");
    expect(calls).toEqual(["clear", "put:192x192"]);
  });
});
