// SPDX-License-Identifier: Apache-2.0
// Runtime tests for the zero-copy exports. They skip until the cdylib exists
// (cargo build -p aphrody-ffi, then APHRODY_FFI_DEV=1 or APHRODY_FFI_LIB=...).
import { expect, test } from "bun:test";
import { resolveNativeLibraryPath } from "../src/library";

let available = false;
try {
  available = resolveNativeLibraryPath() !== undefined;
} catch {
  available = false;
}
const native = test.skipIf(!available);

native("repairJson recovers fenced, trailing-comma JSON and reports repairs", async () => {
  const { repairJson } = await import("../src/zerocopy");
  const result = repairJson('```json\n{"a": 1, "b": [1, 2,],}\n```');
  expect(result.error).toBeUndefined();
  expect(result.value).toEqual({ a: 1, b: [1, 2] });
  expect(result.repairs?.length ?? 0).toBeGreaterThan(0);
});

native("repairJson is the identity on valid JSON and grows its scratch buffer", async () => {
  const { repairJson } = await import("../src/zerocopy");
  const big = { items: Array.from({ length: 2000 }, (_, i) => `value-${i}`) };
  const result = repairJson(JSON.stringify(big));
  expect(result.value).toEqual(big);
  expect(result.repairs).toEqual([]);
});

native("repairJson reports an error document for empty input", async () => {
  const { repairJson } = await import("../src/zerocopy");
  expect(repairJson("").error).toBeString();
});

native("validateArguments flags a missing required property", async () => {
  const { validateArguments } = await import("../src/zerocopy");
  const schema = { type: "object", required: ["x"], properties: { x: { type: "string" } } };
  const bad = validateArguments({}, schema);
  expect("violations" in bad && bad.violations.length > 0).toBe(true);
  const good = validateArguments({ x: "ok" }, schema);
  expect("violations" in good && good.violations.length === 0).toBe(true);
});

native("fillTriangle mutates the JavaScript-owned buffers in place", async () => {
  const { createFramebuffer, fillTriangle } = await import("../src/zerocopy");
  const fb = createFramebuffer(8, 8);
  const pixels = fb.pixels;
  fillTriangle(fb, [0, 0, 1], [8, 0, 1], [0, 8, 1], { baseRgb: [255, 0, 0] });
  expect(fb.pixels).toBe(pixels);
  expect([...pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  expect(Number.isFinite(fb.depth[0]!)).toBe(true);
  // Bottom-right pixel lies outside the triangle and stays untouched.
  expect([...pixels.subarray(63 * 4, 63 * 4 + 4)]).toEqual([0, 0, 0, 0]);
});

native("fillTriangle samples a texture and keeps the nearer triangle", async () => {
  const { createFramebuffer, fillTriangle } = await import("../src/zerocopy");
  const fb = createFramebuffer(4, 4);
  const texture = new Uint8Array([0, 255, 0, 255]);
  fillTriangle(fb, [0, 0, 1], [8, 0, 1], [0, 8, 1], { texture, textureWidth: 1, textureHeight: 1 });
  expect([...fb.pixels.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
  fillTriangle(fb, [0, 0, 2], [8, 0, 2], [0, 8, 2], { baseRgb: [255, 0, 0] });
  expect([...fb.pixels.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
});

native("fillTriangle rejects inconsistent buffers before crossing the boundary", async () => {
  const { fillTriangle } = await import("../src/zerocopy");
  const bad = { width: 4, height: 4, pixels: new Uint8Array(3), depth: new Float32Array(16) };
  expect(() => fillTriangle(bad, [0, 0, 1], [1, 0, 1], [0, 1, 1])).toThrow(RangeError);
});
