// Runs the wasm module on a real CPK read through a synchronous read(offset, len) callback:
// finds `ext:emb`, reads an entry (CRILAYLA decompressed), converts it to PNG and checks it.
// Usage: bun scripts/wasm-proof.ts <file.cpk> [wasm dir]
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { loadDbxv2WasmFromDir } from "../src/wasm-node.ts";

const cpk = process.argv[2];
if (!cpk) throw new Error("usage: bun scripts/wasm-proof.ts <file.cpk> [wasm dir]");
const dbx = await loadDbxv2WasmFromDir(process.argv[3]);

const fd = openSync(cpk, "r");
let reads = 0;
let bytesRead = 0;
const read = (offset: number, length: number): Uint8Array => {
  const buffer = new Uint8Array(length);
  const got = readSync(fd, buffer, 0, length, offset);
  reads++;
  bytesRead += got;
  return buffer.subarray(0, got);
};

console.log(`cpk: ${cpk} (${statSync(cpk).size} bytes)`);
const rows = dbx.cpkFind(read, cpk, "ext:emb");
console.log(`cpkFind ext:emb -> ${rows.length} entries; I/O so far: ${reads} reads, ${bytesRead} bytes`);
const entry = rows.find(row => row.compressed) ?? rows[0];
if (!entry) throw new Error("no emb entry");
console.log(`entry: ${entry.path} size=${entry.size} extract_size=${entry.extract_size} compressed=${entry.compressed}`);
const bytes = dbx.cpkRead(read, cpk, entry.path);
console.log(`cpkRead -> ${bytes.length} bytes; magic ${Buffer.from(bytes.subarray(0, 4)).toString("latin1")}`);
console.log(`length == extract_size: ${bytes.length === entry.extract_size}`);

try {
  const { loadDbxv2Ffi } = await import("../src/ffi.ts");
  const ffi = loadDbxv2Ffi();
  const viaFfi = ffi.cpkRead(cpk, entry.path);
  console.log(`ffi cpkRead -> ${viaFfi.length} bytes; identical to wasm: ${Buffer.compare(viaFfi, bytes) === 0}`);
  ffi.close();
} catch (error) {
  console.log(`ffi comparison skipped: ${(error as Error).message}`);
}

const png = dbx.embToPng(bytes, 0);
const magic = Buffer.from(png.subarray(0, 8)).toString("hex");
console.log(`embToPng(entry 0) -> ${png.length} bytes; magic ${magic} (png: ${magic === "89504e470d0a1a0a"})`);
console.log(`I/O total: ${reads} reads, ${bytesRead} bytes of ${statSync(cpk).size}`);
closeSync(fd);
