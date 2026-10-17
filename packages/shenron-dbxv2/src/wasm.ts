import type { CpkEntry, Dbxv2, FormatInfo, Summary } from "./types.ts";

/**
 * The wasm-bindgen module of `bun-re` built with `--features wasm` (add `dbxv2` for audio):
 * `wasm-pack build crates/re --target web --features wasm`. Its exports are the `wasm_*`
 * functions of `crates/re/src/game/wasm.rs`; `default` initialises the module.
 */
export interface Dbxv2WasmGlue {
  default(input?: unknown): Promise<unknown>;
  wasm_identify_format(bytes: Uint8Array, fileName: string): FormatInfo;
  wasm_triage_cpk(bytes: Uint8Array): { entries: CpkEntry[] };
  wasm_extract_cpk_file(bytes: Uint8Array, name: string): Uint8Array;
  wasm_summarize(bytes: Uint8Array, fileName: string): Summary;
  /** Present only when the module was built with the `dbxv2` feature as well. */
  wasm_audio_to_wav?(bytes: Uint8Array): Uint8Array[];
}

/** Initialise the glue (optionally from explicit wasm bytes or URL) and return the operations. */
export async function loadDbxv2Wasm(glue: Dbxv2WasmGlue, wasm?: unknown): Promise<Dbxv2> {
  await glue.default(wasm);
  return {
    identify: (bytes, fileName = "") => glue.wasm_identify_format(bytes, fileName),
    cpkList: bytes => glue.wasm_triage_cpk(bytes).entries,
    cpkExtract: (bytes, name) => glue.wasm_extract_cpk_file(bytes, name),
    summarize: (bytes, fileName = "") => glue.wasm_summarize(bytes, fileName),
    audioToWav: bytes => {
      if (!glue.wasm_audio_to_wav) {
        throw new Error("this wasm build lacks the `dbxv2` feature: audio decoding is unavailable");
      }
      return glue.wasm_audio_to_wav(bytes);
    },
  };
}
