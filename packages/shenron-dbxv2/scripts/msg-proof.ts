// Reads a decoded .msg through wasm (and bun:ffi when the shared library has the symbol).
// Usage: bun scripts/msg-proof.ts <file.msg>
import { readFileSync } from "node:fs";
import { loadDbxv2WasmFromDir } from "../src/wasm-node.ts";

const path = process.argv[2];
if (!path) throw new Error("usage: bun scripts/msg-proof.ts <file.msg>");
const bytes = new Uint8Array(readFileSync(path));
const wasm = await loadDbxv2WasmFromDir();
const msg = wasm.msgRead(bytes);
const lines = msg.tables.reduce((sum, t) => sum + t.lines.length, 0);
const encodings = new Set(msg.tables.flatMap(t => [t.key, ...t.lines]).map(s => s.encoding));
console.log(`tables=${msg.tables.length} lines=${lines} encodings=${[...encodings].join(",")}`);
const first = msg.tables[0];
if (first) console.log(`first: id=${first.id} key=${JSON.stringify(first.key.text)} line0=${JSON.stringify(first.lines[0]?.text)}`);
const support = wasm.support();
console.log(`support: ${support.length} formats; bac=${support.find(s => s.format === "bac")?.state}`);
try {
  const { loadDbxv2Ffi } = await import("../src/ffi.ts");
  const ffi = loadDbxv2Ffi();
  console.log(`ffi == wasm: ${JSON.stringify(ffi.msgRead(bytes)) === JSON.stringify(msg)}`);
  ffi.close();
} catch (error) {
  console.log(`ffi comparison skipped: ${(error as Error).message}`);
}
