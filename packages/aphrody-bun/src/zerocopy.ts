// SPDX-License-Identifier: Apache-2.0
// Zero-copy bindings: JavaScript owns every buffer, Rust only borrows it.
// See docs/architecture/interop/FFI.md (crate side: crates/interop/ffi/src/zerocopy.rs).
import { ptr } from "bun:ffi";
import { loadNativeLibrary } from "./library";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Status codes shared with the Rust side. */
export const ZC_INVALID = -1;
export const ZC_PANIC = -3;

/** Growable scratch buffer reused across calls so the hot path never allocates. */
let scratch = new Uint8Array(4096);

/** Call `fill(out, cap)` until the native document fits; return its decoded JSON. */
function callJson(name: string, fill: (out: Uint8Array) => number | bigint): unknown {
  for (let attempt = 0; attempt < 2; attempt++) {
    const needed = Number(fill(scratch));
    if (needed === ZC_INVALID) throw new TypeError(`${name}: invalid argument`);
    if (needed === ZC_PANIC) throw new Error(`${name}: native panic`);
    if (needed < 0) throw new Error(`${name}: native error ${needed}`);
    if (needed <= scratch.length) {
      return JSON.parse(decoder.decode(scratch.subarray(0, needed))) as unknown;
    }
    scratch = new Uint8Array(needed);
  }
  throw new Error(`${name}: result size changed between calls`);
}

export interface RepairResult {
  /** Recovered value; undefined when `error` is set. */
  value?: unknown;
  /** Repair kinds applied, in order (empty for already-valid JSON). */
  repairs?: string[];
  error?: string;
}

/** Recover JSON from malformed model output (fences, trailing commas, truncation, ...). */
export function repairJson(input: string | Uint8Array): RepairResult {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  const { symbols } = loadNativeLibrary();
  const source = bytes.length === 0 ? new Uint8Array(1) : bytes;
  return callJson("repairJson", out =>
    symbols.aphrody_toolcall_repair_json(ptr(source), bytes.length, ptr(out), out.length),
  ) as RepairResult;
}

export interface Violation {
  pointer: string;
  message: string;
}

/** Validate tool-call arguments (JSON) against a JSON-Schema subset. */
export function validateArguments(args: unknown, schema: unknown): { violations: Violation[] } | { error: string } {
  const argBytes = encoder.encode(JSON.stringify(args));
  const schemaBytes = encoder.encode(JSON.stringify(schema));
  const { symbols } = loadNativeLibrary();
  return callJson("validateArguments", out =>
    symbols.aphrody_toolcall_validate_json(
      ptr(argBytes),
      argBytes.length,
      ptr(schemaBytes),
      schemaBytes.length,
      ptr(out),
      out.length,
    ),
  ) as { violations: Violation[] } | { error: string };
}

/** Screen-space vertex: pixel x, pixel y (downwards), view depth (> 0). */
export type ScreenVertex = readonly [x: number, y: number, depth: number];

export interface Framebuffer {
  readonly width: number;
  readonly height: number;
  /** RGBA8, width * height * 4 bytes, mutated in place. */
  readonly pixels: Uint8Array;
  /** width * height depths, mutated in place; starts at Infinity. */
  readonly depth: Float32Array;
}

/** Allocate a framebuffer in JavaScript; Rust never owns it. */
export function createFramebuffer(width: number, height: number): Framebuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("Framebuffer size must be positive integers");
  }
  return {
    width,
    height,
    pixels: new Uint8Array(width * height * 4),
    depth: new Float32Array(width * height).fill(Infinity),
  };
}

export interface TriangleOptions {
  /** [u0, v0, u1, v1, u2, v2]; defaults to zeros. */
  uv?: Float32Array | readonly number[];
  /** RGBA8 texture, textureWidth * textureHeight * 4 bytes. */
  texture?: Uint8Array;
  textureWidth?: number;
  textureHeight?: number;
  /** Light multiplier, default 1. */
  shade?: number;
  /** Flat colour 0..255 when untextured, default white. */
  baseRgb?: readonly [number, number, number];
}

/** Rasterize one triangle into `target` in place (z-buffered, no allocation in Rust). */
export function fillTriangle(
  target: Framebuffer,
  a: ScreenVertex,
  b: ScreenVertex,
  c: ScreenVertex,
  options: TriangleOptions = {},
): void {
  const { width, height, pixels, depth } = target;
  if (pixels.length !== width * height * 4 || depth.length !== width * height) {
    throw new RangeError("Framebuffer buffers do not match its dimensions");
  }
  const verts = new Float32Array([...a, ...b, ...c]);
  const uv = options.uv === undefined ? null : Float32Array.from(options.uv);
  if (uv !== null && uv.length !== 6) throw new RangeError("uv must hold 6 numbers");
  const texture = options.texture ?? null;
  const tw = options.textureWidth ?? 0;
  const th = options.textureHeight ?? 0;
  if (texture !== null && texture.length !== tw * th * 4) {
    throw new RangeError("texture must hold textureWidth * textureHeight * 4 bytes");
  }
  const base = options.baseRgb === undefined ? null : Float32Array.from(options.baseRgb);
  const { symbols } = loadNativeLibrary();
  const status = symbols.aphrody_raster_fill_triangle(
    ptr(pixels),
    ptr(depth),
    width,
    height,
    ptr(verts),
    uv === null ? null : ptr(uv),
    texture === null ? null : ptr(texture),
    tw,
    th,
    options.shade ?? 1,
    base === null ? null : ptr(base),
  );
  if (status !== 0) throw new Error(`fillTriangle failed with status ${status}`);
}
