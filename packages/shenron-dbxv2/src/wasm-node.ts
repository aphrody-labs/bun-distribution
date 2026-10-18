import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Dbxv2, Dbxv2CpkRanged } from "./types.ts";
import { type Dbxv2WasmGlue, loadDbxv2Wasm } from "./wasm.ts";

/** Directory `build:wasm` writes the wasm-bindgen output to (git-ignored, under the workspace `target/`). */
export function resolveWasmDir(explicit?: string): string {
  if (explicit) return resolve(explicit);
  const fromEnv = process.env.SHENRON_DBXV2_WASM;
  if (fromEnv) return resolve(fromEnv);
  const dir = join(resolve(import.meta.dir, "../../.."), "target", "shenron-dbxv2-wasm");
  if (existsSync(join(dir, "shenron_dbxv2.js"))) return dir;
  throw new Error(`${dir}/shenron_dbxv2.js not found: run \`bun run build:wasm\` in packages/shenron-dbxv2`);
}

/** Load the module built by `build:wasm` (wasm-bindgen `--target web` output) in Bun or Node. */
export async function loadDbxv2WasmFromDir(dir?: string): Promise<Dbxv2 & Dbxv2CpkRanged> {
  const root = resolveWasmDir(dir);
  const glue = (await import(pathToFileURL(join(root, "shenron_dbxv2.js")).href)) as Dbxv2WasmGlue;
  const bytes = await readFile(join(root, "shenron_dbxv2_bg.wasm"));
  return loadDbxv2Wasm(glue, { module_or_path: bytes });
}
