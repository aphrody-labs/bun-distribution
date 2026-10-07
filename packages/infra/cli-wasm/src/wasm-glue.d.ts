// SPDX-License-Identifier: Apache-2.0
// Shape of the wasm-bindgen output of crates/infra/aphrody-command-wasm (`--target web`), built by
// scripts/build/rust/wasm-package.ts. `#cli-wasm-glue` maps to the generated wasm/aphrody_command_wasm.js.
declare module "#cli-wasm-glue" {
  export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;
  export default function init(input?: {
    module_or_path: InitInput | Promise<InitInput>;
  }): Promise<unknown>;
  export function initSync(input: { module: BufferSource | WebAssembly.Module }): unknown;
  export function run(args: string[], stdin: string, filesJson: string): string;
  export function version(): string;
  export function abiVersion(): number;
  export function manifest(): string;
  export function callJson(op: string, input: string): string;
  export function callVec(op: string, params: string, a: Uint8Array, b: Uint8Array): Uint8Array;
}
