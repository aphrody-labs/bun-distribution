// SPDX-License-Identifier: Apache-2.0
// WebAssembly backend (wasm-bindgen `--target web`, built from crates/ai/rag-wasm).
import init, {
  abiVersion,
  callJson,
  callVec,
  initSync,
  manifest,
  type InitInput,
} from "#rag-wasm-glue";
import { createRagCore, EXPECTED_ABI, type RagCore, type RagTransport } from "./core";

const transport: RagTransport = { manifest, callJson, callVec };

/**
 * Instantiate the module and return the typed facade. In a browser pass nothing (the `.wasm` is
 * fetched next to the glue through `import.meta.url`) or a URL/Response; in Bun/Node pass the bytes.
 */
export async function loadRagWasm(source?: InitInput | Promise<InitInput>): Promise<RagCore> {
  await init(source === undefined ? undefined : { module_or_path: source });
  return open();
}

/** Synchronous variant for hosts that already hold the bytes or a compiled module. */
export function loadRagWasmSync(module: BufferSource | WebAssembly.Module): RagCore {
  initSync({ module });
  return open();
}

function open(): RagCore {
  if (abiVersion() !== EXPECTED_ABI) {
    throw new Error(
      `aphrody-rag-wasm ABI ${abiVersion()} does not match the facade (${EXPECTED_ABI})`,
    );
  }
  return createRagCore(transport);
}
