// SPDX-License-Identifier: Apache-2.0
// Typed RAG backend over the canonical CLI WASM module; no second binary or loader.
import {
  loadCliWasm,
  loadCliWasmSync,
  type WasmInput,
  type WasmRagTransport,
} from "@aphrody/cli-wasm";
import { createRagCore, EXPECTED_ABI, type RagCore } from "./core";

/**
 * Instantiate the module and return the typed facade. In a browser pass nothing (the `.wasm` is
 * fetched next to the glue through `import.meta.url`) or a URL/Response; in Bun/Node pass the bytes.
 */
export async function loadRagWasm(
  source?: WasmInput | Promise<WasmInput>,
): Promise<RagCore> {
  return open((await loadCliWasm(source)).rag);
}

/** Synchronous variant for hosts that already hold the bytes or a compiled module. */
export function loadRagWasmSync(
  module: BufferSource | WebAssembly.Module,
): RagCore {
  return open(loadCliWasmSync(module).rag);
}

function open(transport: WasmRagTransport): RagCore {
  if (transport.abiVersion !== EXPECTED_ABI) {
    throw new Error(
      `aphrody-command-wasm RAG ABI ${transport.abiVersion} does not match the facade (${EXPECTED_ABI})`,
    );
  }
  return createRagCore(transport);
}
