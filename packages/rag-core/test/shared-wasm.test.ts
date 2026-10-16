// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { loadCliWasm, loadCliWasmSync } from "@aphrody/cli-wasm";
import { initSync } from "@aphrody/cli-wasm/wasm/aphrody_command_wasm.js";
import { loadRagWasm, loadRagWasmSync } from "../src/wasm";

test("command and typed RAG loaders share one WASM instance across sync and async calls", async () => {
  const bytes = await Bun.file(
    new URL(
      "../../cli-wasm/wasm/aphrody_command_wasm_bg.wasm",
      import.meta.url,
    ),
  ).arrayBuffer();
  const instance = initSync({ module: bytes });
  const cli = loadCliWasmSync(bytes);
  const rag = await loadRagWasm(bytes);

  expect(rag.manifest).toEqual(cli.json(["rag", "ops"]));
  expect(rag.rrf([["a", "b"], ["b"]])).toEqual(
    cli.json(["rag", "call", "rrf", '{"lists":[["a","b"],["b"]]}']),
  );
  expect(rag.dotF32(new Float32Array([1, 2]), new Float32Array([3, 4]))).toBe(
    11,
  );
  expect(() => cli.rag.callJson("missing", "{}")).toThrow(
    "unknown json operation",
  );
  expect(
    cli.text(["html", "markdown", "-"], { stdin: "<h1>Shared</h1>" }),
  ).toContain("# Shared");

  const again = await loadCliWasm(bytes);
  expect(loadRagWasmSync(bytes).manifest).toEqual(rag.manifest);
  expect(again.rag.abiVersion).toBe(1);
  expect(initSync({ module: bytes })).toBe(instance);
  expect(instance.memory).toBe(initSync({ module: bytes }).memory);
});
