// SPDX-License-Identifier: Apache-2.0
import React, { useState } from 'react';

export const FFIExplorer: React.FC = () => {
  const [abiVersion, setAbiVersion] = useState<number>(140);
  const [bufferLen, setBufferLen] = useState<number>(1024);
  const [copied, setCopied] = useState(false);

  const cHeaderCode = `// crates/engine/yolo-runtime/include/yolo_runtime.h
// Strict C ABI contract for Bun FFI and native extensions

#ifndef YOLO_RUNTIME_H
#define YOLO_RUNTIME_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint8_t* data;
    size_t len;
    size_t cap;
} YoloBuffer;

// Query current ABI version (e.g. 140 for 1.4.0)
uint32_t yolo_abi_version(void);

// Query engine system stats into caller-provided or library-allocated buffer
int32_t yolo_system_stats(uint64_t runtime_handle, YoloBuffer* output);

// Release library-owned buffer
void yolo_buffer_free(YoloBuffer* buffer);

#ifdef __cplusplus
}
#endif

#endif // YOLO_RUNTIME_H`;

  const rustConsumerCode = `// examples/runtime-rust-extension/src/lib.rs
// Rust extension consuming yolo_runtime.h ABI without monorepo engine dependency

use std::ptr;

#[repr(C)]
pub struct YoloBuffer {
    pub data: *mut u8,
    pub len: usize,
    pub cap: usize,
}

unsafe extern "C" {
    fn yolo_abi_version() -> u32;
    fn yolo_system_stats(runtime: u64, output: *mut YoloBuffer) -> i32;
    fn yolo_buffer_free(buffer: *mut YoloBuffer);
}

pub fn check_compatibility() -> bool {
    unsafe { yolo_abi_version() >= 140 }
}

pub fn read_stats(runtime_handle: u64) -> Result<Vec<u8>, i32> {
    let mut buf = YoloBuffer {
        data: ptr::null_mut(),
        len: 0,
        cap: 0,
    };
    let status = unsafe { yolo_system_stats(runtime_handle, &mut buf) };
    if status != 0 {
        return Err(status);
    }
    let slice = unsafe { std::slice::from_raw_parts(buf.data, buf.len) };
    let copy = slice.to_vec();
    unsafe { yolo_buffer_free(&mut buf) };
    Ok(copy)
}`;

  const bunFfiBindingCode = `// packages/engine/runtime/src/ffi.ts
import { dlopen, FFIType, ptr } from "bun:ffi";

const lib = dlopen("libyolo_runtime.so", {
  yolo_abi_version: {
    args: [],
    returns: FFIType.u32,
  },
  yolo_system_stats: {
    args: [FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  yolo_buffer_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  }
});

export function getAbiVersion(): number {
  return lib.symbols.yolo_abi_version();
}`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <span className="text-xs font-bold tracking-wider uppercase text-[var(--md-sys-color-primary)]">
          Unified Native Interop & FFI
        </span>
        <h2 className="text-3xl font-black text-[var(--md-sys-color-on-surface)]">
          Native C ABI & bun:ffi Contract
        </h2>
        <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-1 max-w-2xl">
          Fulfilling the Single FFI architecture: zero-copy pointer exchanges, C ABI stability, TinyCC JIT call thunks, and Rust extension consumer contract.
        </p>
      </div>

      {/* Memory Buffer Layout Visualizer */}
      <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)]">
        <h3 className="text-base font-bold text-[var(--md-sys-color-on-surface)] mb-4">
          YoloBuffer Memory Contract Visualizer
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
          <div className="p-4 rounded-2xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]">
            <span className="text-[10px] uppercase font-bold text-[var(--md-sys-color-primary)] block mb-1">
              data: *mut uint8_t (64-bit)
            </span>
            <div className="text-lg font-bold text-[var(--md-sys-color-on-surface)]">
              0x00007FF6B4A0
            </div>
            <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
              Heap pointer allocated by engine allocator (mimalloc)
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]">
            <span className="text-[10px] uppercase font-bold text-[var(--md-sys-color-primary)] block mb-1">
              len: size_t (64-bit)
            </span>
            <div className="text-lg font-bold text-cyan-400">
              {bufferLen.toLocaleString()} bytes
            </div>
            <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
              Active initialized byte payload length
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]">
            <span className="text-[10px] uppercase font-bold text-[var(--md-sys-color-primary)] block mb-1">
              cap: size_t (64-bit)
            </span>
            <div className="text-lg font-bold text-emerald-400">
              {(bufferLen * 2).toLocaleString()} bytes
            </div>
            <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
              Total buffer allocated capacity
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <span className="text-xs text-[var(--md-sys-color-on-surface-variant)]">Simulate buffer size:</span>
          <input
            type="range"
            min="256"
            max="65536"
            step="256"
            value={bufferLen}
            onChange={e => setBufferLen(Number(e.target.value))}
            className="w-64"
          />
          <span className="font-mono text-xs font-bold text-[var(--md-sys-color-primary)]">
            {bufferLen} bytes
          </span>
        </div>
      </div>

      {/* Code Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* C Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-[var(--md-sys-color-primary)]">
              yolo_runtime.h (C ABI)
            </span>
            <button
              onClick={() => copyToClipboard(cHeaderCode)}
              className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="rounded-2xl bg-[#1e1e1e] p-4 font-mono text-xs text-gray-300 overflow-x-auto h-80">
            <pre><code>{cHeaderCode}</code></pre>
          </div>
        </div>

        {/* Rust Extension Consumer */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-emerald-400">
              extension.rs (Rust Consumer)
            </span>
            <button
              onClick={() => copyToClipboard(rustConsumerCode)}
              className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="rounded-2xl bg-[#1e1e1e] p-4 font-mono text-xs text-gray-300 overflow-x-auto h-80">
            <pre><code>{rustConsumerCode}</code></pre>
          </div>
        </div>
      </div>
    </div>
  );
};
