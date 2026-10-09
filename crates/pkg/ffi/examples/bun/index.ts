// SPDX-License-Identifier: Apache-2.0
import { dlopen, FFIType, ptr } from "bun:ffi";
/** Explicit library path and UTF-8 root; no implicit credential/cache migration. */
export function openPackageStore(library: string, root: string) {
  const { symbols, close } = dlopen(library, {
    aphrody_pkg_abi_version: { args: [], returns: FFIType.u32 },
    aphrody_pkg_store_open: {
      args: [FFIType.ptr, FFIType.usize, FFIType.ptr],
      returns: FFIType.i32,
    },
    aphrody_pkg_store_put: {
      args: [FFIType.u64, FFIType.ptr, FFIType.usize, FFIType.ptr, FFIType.usize, FFIType.ptr],
      returns: FFIType.i32,
    },
    aphrody_pkg_store_verify: {
      args: [FFIType.u64, FFIType.ptr, FFIType.usize],
      returns: FFIType.i32,
    },
    aphrody_pkg_store_stats: {
      args: [FFIType.u64, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    aphrody_pkg_buffer_copy: {
      args: [FFIType.u64, FFIType.ptr, FFIType.usize],
      returns: FFIType.i32,
    },
    aphrody_pkg_release: { args: [FFIType.u64], returns: FFIType.i32 },
  });
  const check = (status: number) => {
    if (status !== 0) throw new Error(`package ABI status ${status}`);
  };
  if (symbols.aphrody_pkg_abi_version() !== 1) {
    close();
    throw new Error("unsupported package ABI");
  }
  const output = new BigUint64Array(1);
  const rootBytes = new TextEncoder().encode(root);
  try {
    check(symbols.aphrody_pkg_store_open(ptr(rootBytes), rootBytes.length, ptr(output)));
  } catch (error) {
    close();
    throw error;
  }
  const handle = output[0]!;
  let closed = false;
  const live = () => {
    if (closed) throw new Error("package store is closed");
  };
  return {
    put(data: Uint8Array) {
      live();
      const digest = new BigUint64Array(1);
      check(
        symbols.aphrody_pkg_store_put(
          handle,
          data.length ? ptr(data) : null,
          data.length,
          null,
          0,
          ptr(digest),
        ),
      );
      try {
        const value = new Uint8Array(64);
        check(symbols.aphrody_pkg_buffer_copy(digest[0]!, ptr(value), 64));
        return new TextDecoder().decode(value);
      } finally {
        check(symbols.aphrody_pkg_release(digest[0]!));
      }
    },
    verify(digest: string) {
      live();
      const bytes = new TextEncoder().encode(digest);
      check(
        symbols.aphrody_pkg_store_verify(handle, bytes.length ? ptr(bytes) : null, bytes.length),
      );
    },
    stats() {
      live();
      const count = new BigUint64Array(1),
        bytes = new BigUint64Array(1);
      check(symbols.aphrody_pkg_store_stats(handle, ptr(count), ptr(bytes)));
      return { blobs: count[0]!, bytes: bytes[0]! };
    },
    close() {
      if (!closed) {
        check(symbols.aphrody_pkg_release(handle));
        closed = true;
        close();
      }
    },
  };
}
