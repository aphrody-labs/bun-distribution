// SPDX-License-Identifier: Apache-2.0
// Shape of the wasm-bindgen output of crates/ai/rag-wasm (`--target web`), built by scripts/build-wasm.ts.
// `#rag-wasm-glue` maps to the generated wasm/aphrody_rag_wasm.js at run time (package.json `imports`).
declare module "#rag-wasm-glue" {
  export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;
  export default function init(input?: {
    module_or_path: InitInput | Promise<InitInput>;
  }): Promise<unknown>;
  export function initSync(input: { module: BufferSource | WebAssembly.Module }): unknown;
  export function abiVersion(): number;
  export function manifest(): string;
  export function callJson(op: string, input: string): string;
  export function callVec(op: string, params: string, a: Uint8Array, b: Uint8Array): Uint8Array;
}
