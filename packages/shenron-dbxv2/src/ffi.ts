import { dlopen, FFIType, ptr, toArrayBuffer } from "bun:ffi";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CpkEntry, Dbxv2, Dbxv2CpkFiles, FormatInfo, IndexEntry, ModelJson, Summary } from "./types.ts";

/** ABI version this loader was written against (`shenron_dbxv2_abi_version`). */
export const EXPECTED_ABI_VERSION = 1;

const SUFFIX = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
const PREFIX = process.platform === "win32" ? "" : "lib";

/** Library path: explicit argument, `SHENRON_DBXV2_LIB`, then the workspace `target/` profiles. */
export function resolveLibraryPath(explicit?: string): string {
  if (explicit) return resolve(explicit);
  const fromEnv = process.env.SHENRON_DBXV2_LIB;
  if (fromEnv) return resolve(fromEnv);
  const root = resolve(import.meta.dir, "../../..");
  const file = `${PREFIX}shenron_dbxv2.${SUFFIX}`;
  for (const profile of ["release", "debug"]) {
    const candidate = join(root, "target", profile, file);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${file} not found: build crates/shenron-dbxv2 or set SHENRON_DBXV2_LIB`);
}

const symbols = {
  shenron_dbxv2_abi_version: { args: [], returns: FFIType.u32 },
  shenron_dbxv2_last_error: { args: [], returns: FFIType.cstring },
  shenron_dbxv2_buf_free: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.void },
  shenron_dbxv2_identify: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_cpk_list: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  shenron_dbxv2_cpk_extract: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_summarize: {
    args: [FFIType.ptr, FFIType.u64, FFIType.cstring, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_audio_to_wav: {
    args: [FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_cpk_find_file: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_cpk_read_file: {
    args: [FFIType.cstring, FFIType.cstring, FFIType.u64, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_emb_to_png: {
    args: [FFIType.ptr, FFIType.u64, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_model_json: {
    args: [FFIType.cstring, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_model_glb: {
    args: [FFIType.cstring, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  shenron_dbxv2_usm_to_video: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  shenron_dbxv2_font_to_sfnt: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
} as const;

/** NUL-terminated UTF-8 argument for a `const char *` parameter. */
function cstr(value: string): Uint8Array {
  return Buffer.from(`${value}\0`, "utf8");
}

/** Load the C ABI and return the typed operations. Throws on an ABI version mismatch. */
export function loadDbxv2Ffi(libraryPath?: string): Dbxv2 & Dbxv2CpkFiles & { close(): void } {
  const library = dlopen(resolveLibraryPath(libraryPath), symbols);
  const native = library.symbols;
  const abi = native.shenron_dbxv2_abi_version();
  if (abi !== EXPECTED_ABI_VERSION) {
    library.close();
    throw new Error(`shenron_dbxv2 ABI ${abi} != expected ${EXPECTED_ABI_VERSION}`);
  }

  /** Run one native call, copy its output buffer into JS memory and free the native one. */
  function call(invoke: (out: Uint8Array) => number): Uint8Array {
    const slot = new BigUint64Array(2);
    const status = invoke(new Uint8Array(slot.buffer));
    if (status !== 0) {
      throw new Error(`shenron_dbxv2: ${String(native.shenron_dbxv2_last_error())}`);
    }
    const address = Number(slot[0]);
    const length = Number(slot[1]);
    if (address === 0 || length === 0) return new Uint8Array(0);
    const copy = new Uint8Array(toArrayBuffer(address as never, 0, length)).slice();
    native.shenron_dbxv2_buf_free(address as never, BigInt(length));
    return copy;
  }

  const json = <T>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;
  const size = (bytes?: Uint8Array) => BigInt(bytes?.byteLength ?? 0);
  /** Optional input: a null pointer with length 0 when absent or empty. */
  const opt = (bytes?: Uint8Array) => (bytes && bytes.byteLength > 0 ? ptr(bytes) : null);

  return {
    identify: (bytes, fileName = "") =>
      json<FormatInfo>(
        call(out => native.shenron_dbxv2_identify(ptr(bytes), size(bytes), cstr(fileName) as never, ptr(out))),
      ),
    cpkList: bytes => json<CpkEntry[]>(call(out => native.shenron_dbxv2_cpk_list(ptr(bytes), size(bytes), ptr(out)))),
    cpkExtract: (bytes, name) =>
      call(out => native.shenron_dbxv2_cpk_extract(ptr(bytes), size(bytes), cstr(name) as never, ptr(out))),
    summarize: (bytes, fileName = "") =>
      json<Summary>(
        call(out => native.shenron_dbxv2_summarize(ptr(bytes), size(bytes), cstr(fileName) as never, ptr(out))),
      ),
    audioToWav: bytes => {
      const packed = call(out => native.shenron_dbxv2_audio_to_wav(ptr(bytes), size(bytes), ptr(out)));
      if (packed.byteLength === 0) return [];
      const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
      const count = view.getUint32(0, true);
      const waves: Uint8Array[] = [];
      let cursor = 4;
      for (let index = 0; index < count; index += 1) {
        const length = view.getUint32(cursor, true);
        cursor += 4;
        waves.push(packed.slice(cursor, cursor + length));
        cursor += length;
      }
      return waves;
    },
    cpkFind: (cpkPath, query = "") =>
      json<IndexEntry[]>(
        call(out => native.shenron_dbxv2_cpk_find_file(cstr(cpkPath) as never, cstr(query) as never, ptr(out))),
      ),
    cpkRead: (cpkPath, entry, range) =>
      call(out =>
        native.shenron_dbxv2_cpk_read_file(
          cstr(cpkPath) as never,
          cstr(entry) as never,
          BigInt(range?.start ?? 0),
          BigInt(range?.length ?? 0),
          ptr(out),
        ),
      ),
    embToPng: (bytes, index) => call(out => native.shenron_dbxv2_emb_to_png(ptr(bytes), size(bytes), index, ptr(out))),
    modelJson: (name, emd, emb, esk) =>
      json<ModelJson>(
        call(out =>
          native.shenron_dbxv2_model_json(
            cstr(name) as never,
            ptr(emd),
            size(emd),
            opt(emb),
            size(emb),
            opt(esk),
            size(esk),
            ptr(out),
          ),
        ),
      ),
    modelGlb: (name, emd, emb, esk) =>
      call(out =>
        native.shenron_dbxv2_model_glb(
          cstr(name) as never,
          ptr(emd),
          size(emd),
          opt(emb),
          size(emb),
          opt(esk),
          size(esk),
          ptr(out),
        ),
      ),
    usmToVideo: bytes => call(out => native.shenron_dbxv2_usm_to_video(ptr(bytes), size(bytes), ptr(out))),
    fontToSfnt: bytes => call(out => native.shenron_dbxv2_font_to_sfnt(ptr(bytes), size(bytes), ptr(out))),
    close: () => library.close(),
  };
}
