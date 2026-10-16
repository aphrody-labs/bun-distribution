// SPDX-License-Identifier: Apache-2.0
// Backend-neutral entry. Pick a backend: `@aphrody/rag-core/wasm` (browser, Bun, Node) or
// `@aphrody/rag-core/ffi` (Bun backend through bun:ffi).
export { createRagCore, EXPECTED_ABI } from "./core";
export type { RagCore, RagTransport } from "./core";
export type * from "./types";
