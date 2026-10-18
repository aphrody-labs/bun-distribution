import type {
  AssembledModelJson,
  CpkEntry,
  Dbxv2,
  Dbxv2CpkRanged,
  FormatInfo,
  IndexEntry,
  ModelJson,
  RangeReader,
  Summary,
} from "./types.ts";

/**
 * The wasm-bindgen module of `bun-re` built with `--features wasm` (add `dbxv2` for audio, PNG
 * and video): `wasm-pack build crates/re --target web --features wasm`. Its exports are the
 * `wasm_*` functions of `crates/re/src/game/wasm.rs`; `default` initialises the module.
 */
export interface Dbxv2WasmGlue {
  default(input?: unknown): Promise<unknown>;
  wasm_identify_format(bytes: Uint8Array, fileName: string): FormatInfo;
  wasm_triage_cpk(bytes: Uint8Array): { entries: CpkEntry[] };
  wasm_extract_cpk_file(bytes: Uint8Array, name: string): Uint8Array;
  wasm_summarize(bytes: Uint8Array, fileName: string): Summary;
  wasm_model_json(name: string, emd: Uint8Array, emb?: Uint8Array, esk?: Uint8Array): ModelJson;
  wasm_model_assembled_json(name: string, emd: Uint8Array, emb?: Uint8Array, esk?: Uint8Array): AssembledModelJson;
  wasm_model_glb(name: string, emd: Uint8Array, emb?: Uint8Array, esk?: Uint8Array): Uint8Array;
  wasm_font_to_sfnt(bytes: Uint8Array): Uint8Array;
  wasm_xz_decode(bytes: Uint8Array): Uint8Array;
  wasm_cpk_find(read: RangeReader, label: string, query: string): IndexEntry[];
  wasm_cpk_read(read: RangeReader, label: string, path: string, start: number, len: number): Uint8Array;
  /** The next three exist only when the module was built with the `dbxv2` feature as well. */
  wasm_audio_to_wav?(bytes: Uint8Array): Uint8Array[];
  wasm_emb_to_png?(bytes: Uint8Array, index: number): Uint8Array;
  wasm_usm_to_video?(bytes: Uint8Array): { extension: string; bytes: Uint8Array };
}

function needs<T>(fn: T | undefined, what: string): T {
  if (!fn) throw new Error(`this wasm build lacks the dbxv2 feature: ${what} is unavailable`);
  return fn;
}

/** Initialise the glue (optionally from explicit wasm bytes or URL) and return the operations. */
export async function loadDbxv2Wasm(glue: Dbxv2WasmGlue, wasm?: unknown): Promise<Dbxv2 & Dbxv2CpkRanged> {
  await glue.default(wasm);
  return {
    identify: (bytes, fileName = "") => glue.wasm_identify_format(bytes, fileName),
    cpkList: bytes => glue.wasm_triage_cpk(bytes).entries,
    cpkExtract: (bytes, name) => glue.wasm_extract_cpk_file(bytes, name),
    summarize: (bytes, fileName = "") => glue.wasm_summarize(bytes, fileName),
    audioToWav: bytes => needs(glue.wasm_audio_to_wav, "audio decoding")(bytes),
    embToPng: (bytes, index) => needs(glue.wasm_emb_to_png, "PNG encoding")(bytes, index),
    modelJson: (name, emd, emb, esk) => glue.wasm_model_json(name, emd, emb, esk),
    modelAssembledJson: (name, emd, emb, esk) => glue.wasm_model_assembled_json(name, emd, emb, esk),
    modelGlb: (name, emd, emb, esk) => glue.wasm_model_glb(name, emd, emb, esk),
    usmToVideo: bytes => needs(glue.wasm_usm_to_video, "video remux")(bytes).bytes,
    fontToSfnt: bytes => glue.wasm_font_to_sfnt(bytes),
    xzDecode: bytes => glue.wasm_xz_decode(bytes),
    cpkFind: (read, label, query = "") => glue.wasm_cpk_find(read, label, query),
    cpkRead: (read, label, entry, range) =>
      glue.wasm_cpk_read(read, label, entry, range?.start ?? 0, range?.length ?? 0),
  };
}
