// SPDX-License-Identifier: Apache-2.0
// bun:ffi backend: the aphrody_rag_* symbols of the single aphrody-ffi library
// (crates/ai/rag-ffi, re-exported by crates/interop/ffi). Caller-owned buffers, no native allocation.
import { dlopen, FFIType, ptr, suffix } from "bun:ffi";
import { isAbsolute } from "node:path";
import { statePath } from "@aphrody/paths";
import { createRagCore, type RagCore, type RagTransport } from "./core";

export const RAG_FFI_ABI_VERSION = 1;
const INVALID = -1;
const OP_ERROR = -2;
const PANIC = -3;

export const RAG_SYMBOLS = {
  aphrody_rag_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_rag_manifest: { args: [FFIType.ptr, "usize"], returns: FFIType.i64_fast },
  aphrody_rag_call_json: {
    args: [FFIType.ptr, "usize", FFIType.ptr, "usize", FFIType.ptr, "usize"],
    returns: FFIType.i64_fast,
  },
  aphrody_rag_call_vec: {
    args: [
      FFIType.ptr,
      "usize",
      FFIType.ptr,
      "usize",
      FFIType.ptr,
      "usize",
      FFIType.ptr,
      "usize",
      FFIType.ptr,
      "usize",
    ],
    returns: FFIType.i64_fast,
  },
  aphrody_rag_take: { args: [FFIType.ptr, "usize"], returns: FFIType.i64_fast },
  aphrody_rag_last_error: { args: [FFIType.ptr, "usize"], returns: FFIType.i64_fast },
} as const;

/** Zero-length views are passed as null: the native side accepts a null pointer with length 0. */
const p = (b: Uint8Array) => (b.length === 0 ? null : ptr(b));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Default library: `APHRODY_RAG_LIBRARY`, else `aphrody_ffi` in the protected Aphrody `lib` store. */
export function defaultLibraryPath(): string {
  const filename = `${process.platform === "win32" ? "" : "lib"}aphrody_ffi.${suffix}`;
  return process.env.APHRODY_RAG_LIBRARY ?? statePath("lib", filename);
}

/** Open the library and return the typed facade. The handle stays open for the process lifetime. */
export function openRagFfi(path: string = defaultLibraryPath()): RagCore {
  if (!isAbsolute(path)) throw new Error("the aphrody-ffi library path must be absolute");
  const { symbols: s } = dlopen(path, RAG_SYMBOLS);
  if (s.aphrody_rag_abi_version() !== RAG_FFI_ABI_VERSION) {
    throw new Error(`aphrody_rag ABI mismatch (expected ${RAG_FFI_ABI_VERSION})`);
  }

  // Scratch buffer grown on demand; a result that did not fit is read back with `take`, never recomputed.
  let scratch = new Uint8Array(64 * 1024);
  const sized = (n: number): void => {
    if (n > scratch.length) scratch = new Uint8Array(Math.max(n, scratch.length * 2));
  };
  const message = (): string => {
    const need = Number(s.aphrody_rag_last_error(ptr(scratch), scratch.length));
    sized(need);
    if (need > scratch.length) s.aphrody_rag_last_error(ptr(scratch), scratch.length);
    return decoder.decode(scratch.subarray(0, need));
  };

  // Common tail: `n` is the native return; fetch a stashed result when it exceeded the scratch.
  const finish = (name: string, n: number): Uint8Array => {
    if (n === INVALID) throw new TypeError(`${name}: invalid argument`);
    if (n === PANIC) throw new Error(`${name}: native panic`);
    if (n === OP_ERROR) throw new Error(`${name}: ${message()}`);
    if (n < 0) throw new Error(`${name}: native status ${n}`);
    if (n > scratch.length) {
      scratch = new Uint8Array(n);
      const got = Number(s.aphrody_rag_take(ptr(scratch), scratch.length));
      if (got !== n) throw new Error(`${name}: stashed result lost`);
    }
    return scratch.subarray(0, n);
  };

  const transport: RagTransport = {
    manifest() {
      const n = Number(s.aphrody_rag_manifest(ptr(scratch), scratch.length));
      return decoder.decode(finish("manifest", n));
    },
    callJson(op, input) {
      const o = encoder.encode(op);
      const i = encoder.encode(input);
      const n = Number(
        s.aphrody_rag_call_json(ptr(o), o.length, p(i), i.length, ptr(scratch), scratch.length),
      );
      const text = decoder.decode(finish(op, n));
      // `{"ok":<result>}` is unwrapped by slicing, without parsing the result twice.
      if (text.startsWith('{"ok":')) return text.slice(6, -1);
      throw new Error(`${op}: ${(JSON.parse(text) as { error?: string }).error ?? "native error"}`);
    },
    callVec(op, params, a, b) {
      const o = encoder.encode(op);
      const q = encoder.encode(params);
      const n = Number(
        s.aphrody_rag_call_vec(
          ptr(o),
          o.length,
          p(q),
          q.length,
          p(a),
          a.length,
          p(b),
          b.length,
          ptr(scratch),
          scratch.length,
        ),
      );
      // The scratch is reused by the next call: hand back an owned copy.
      return finish(op, n).slice();
    },
  };
  return createRagCore(transport);
}
