// Runs `modelAssembledJson` on decoded game files through the wasm module and, when the shared
// library is present, through bun:ffi, and compares both outputs.
// Usage: bun scripts/model-proof.ts <name> <emd> [emb|-] [esk|-]
import { readFileSync } from "node:fs";
import { loadDbxv2WasmFromDir } from "../src/wasm-node.ts";

const [name, emdPath, embPath, eskPath] = process.argv.slice(2);
if (!name || !emdPath) throw new Error("usage: bun scripts/model-proof.ts <name> <emd> [emb|-] [esk|-]");
const read = (path?: string) => (path && path !== "-" ? new Uint8Array(readFileSync(path)) : undefined);
const [emd, emb, esk] = [read(emdPath)!, read(embPath), read(eskPath)];

const wasm = await loadDbxv2WasmFromDir();
const model = wasm.modelAssembledJson(name, emd, emb, esk);
const vertices = model.primitives.reduce((sum, p) => sum + p.positions.length, 0);
const triangles = model.primitives.reduce((sum, p) => sum + p.indices.length / 3, 0);
console.log(
  `wasm: primitives=${model.primitives.length} vertices=${vertices} triangles=${triangles} bones=${model.skeleton?.bones.length ?? 0} textures=${model.report.textures.length}`,
);
console.log(`fields: ${Object.keys(model).join(",")}`);
console.log(`bone[1]: ${JSON.stringify(model.skeleton?.bones[1]?.name)} parent=${model.skeleton?.bones[1]?.parent}`);

try {
  const { loadDbxv2Ffi } = await import("../src/ffi.ts");
  const ffi = loadDbxv2Ffi();
  const viaFfi = ffi.modelAssembledJson(name, emd, emb, esk);
  console.log(`ffi == wasm: ${JSON.stringify(viaFfi) === JSON.stringify(model)}`);
  ffi.close();
} catch (error) {
  console.log(`ffi comparison skipped: ${(error as Error).message}`);
}
