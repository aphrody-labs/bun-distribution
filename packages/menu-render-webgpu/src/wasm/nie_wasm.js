/* @ts-self-types="./nie_wasm.d.ts" */
import * as wasm_module from "./nie_wasm_bg.wasm";
import { __wbg_set_wasm } from "./nie_wasm_bg.js";

let wasm = wasm_module;
if (typeof wasm === "string" || (wasm && wasm.default && typeof wasm.default === "string")) {
  const wasmPath = typeof wasm === "string" ? wasm : wasm.default;
  const fs = require("fs");
  const bytes = fs.readFileSync(wasmPath);
  const mod = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(mod, {
    "./nie_wasm_bg.js": require("./nie_wasm_bg.js"),
  });
  wasm = instance.exports;
}

__wbg_set_wasm(wasm);
if (wasm.__wbindgen_start) {
  wasm.__wbindgen_start();
}

export {
  aura_lookup,
  calculate_stats,
  cfgbin_parse_json,
  cpk_extract_file,
  cpk_parse_entries,
  crilayla_decompress,
  detect_format,
  final_score,
  g4md_parse_json,
  g4mg_extract_json,
  init_panic_hook,
  item_lookup,
  match_tick,
  rarity_to_growth_rank,
  single_stat,
  skill_lookup,
  utf_table_json,
} from "./nie_wasm_bg.js";
