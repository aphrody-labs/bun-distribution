// SPDX-License-Identifier: Apache-2.0
// One lazy native handle and symbol registry for every @aphrody/bun subpath.
import { dlopen, FFIType, suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const EXPECTED_ABI_VERSION = 1;
export const EXPECTED_WEB_ABI_VERSION = 4;
export const EXPECTED_SHENRON_ABI_VERSION = 1;
export const EXPECTED_MANGA_ABI_VERSION = 1;
export const EXPECTED_BUN_RS_ABI_VERSION = 1;

const SYMBOLS = {
  aphrody_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_web_bridge_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_version: { args: [], returns: FFIType.cstring },
  aphrody_run_json: { args: [FFIType.cstring], returns: FFIType.i32 },
  aphrody_run: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  aphrody_run_captured: { args: [FFIType.cstring], returns: FFIType.ptr },
  aphrody_string_free: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_last_error: { args: [], returns: FFIType.ptr },
  shenron_abi_version: { args: [], returns: FFIType.u32 },
  shenron_version: { args: [], returns: FFIType.cstring },
  shenron_string_free: { args: [FFIType.ptr], returns: FFIType.void },
  shenron_run_json: { args: [FFIType.cstring], returns: FFIType.i32 },
  shenron_run: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  shenron_run_captured: { args: [FFIType.cstring], returns: FFIType.ptr },
  shenron_rag_search: {
    args: [FFIType.cstring, FFIType.i32, FFIType.cstring],
    returns: FFIType.ptr,
  },
  shenron_rag_stats: { args: [], returns: FFIType.ptr },
  shenron_auth_status: { args: [], returns: FFIType.ptr },
  shenron_persona_prompt: { args: [], returns: FFIType.cstring },
  shenron_persona_ask: { args: [FFIType.cstring], returns: FFIType.ptr },
  manga_abi_version: { args: [], returns: FFIType.u32 },
  manga_detect_bubbles: { args: [FFIType.ptr, FFIType.u64_fast], returns: FFIType.ptr },
  manga_typeset_fit: {
    args: [FFIType.cstring, FFIType.f32, FFIType.f32, FFIType.f32, FFIType.f32, FFIType.i32],
    returns: FFIType.ptr,
  },
  manga_pipeline_run: {
    args: [FFIType.ptr, FFIType.u64_fast, FFIType.cstring],
    returns: FFIType.ptr,
  },
  manga_scanlate_cdn: { args: [FFIType.cstring, FFIType.cstring], returns: FFIType.ptr },
  manga_scanlate_databook: {
    args: [FFIType.u64, FFIType.u32, FFIType.cstring],
    returns: FFIType.ptr,
  },
  manga_scanlate_chapter: {
    args: [FFIType.u64, FFIType.u32, FFIType.cstring],
    returns: FFIType.ptr,
  },
  manga_string_free: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_web_extract_main: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_free_string: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_web_extract_title: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_strip_tags: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_parse_html: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_tree_destroy: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_web_query_selector: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_query_selector_all: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_media_extract: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_media_resolve_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_html_to_markdown: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_simhash64: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_index_last_error: { args: [], returns: FFIType.ptr },
  aphrody_web_index_open: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.i32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_index_len: { args: [FFIType.u64_fast], returns: FFIType.i64_fast },
  aphrody_web_index_dim: { args: [FFIType.u64_fast], returns: FFIType.u32 },
  aphrody_web_index_add: {
    args: [FFIType.u64_fast, FFIType.u64_fast, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
  aphrody_web_index_add_batch: {
    args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.i32,
  },
  aphrody_web_index_search: {
    args: [FFIType.u64_fast, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32],
    returns: FFIType.ptr,
  },
  aphrody_web_index_remove: { args: [FFIType.u64_fast, FFIType.u64_fast], returns: FFIType.i32 },
  aphrody_web_index_save: { args: [FFIType.u64_fast], returns: FFIType.i32 },
  aphrody_web_index_compact: { args: [FFIType.u64_fast], returns: FFIType.i32 },
  aphrody_web_index_stats: { args: [FFIType.u64_fast], returns: FFIType.ptr },
  aphrody_web_index_close: { args: [FFIType.u64_fast], returns: FFIType.i32 },
  aphrody_web_job_completed_seq: { args: [], returns: FFIType.u64_fast },
  aphrody_web_job_pending_count: { args: [], returns: FFIType.u32 },
  aphrody_web_job_status: { args: [FFIType.u64_fast], returns: FFIType.i32 },
  aphrody_web_job_take: { args: [FFIType.u64_fast], returns: FFIType.ptr },
  aphrody_web_job_cancel: { args: [FFIType.u64_fast], returns: FFIType.i32 },
  aphrody_web_embed_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_rerank_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_embed_info: { args: [], returns: FFIType.ptr },
  aphrody_web_embed_install_submit: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_get_chromium_cookies: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
  aphrody_web_obscura_fetch_submit: {
    args: [FFIType.ptr, FFIType.u8, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_obscura_fetch: { args: [FFIType.ptr, FFIType.u8, FFIType.u32], returns: FFIType.ptr },
  aphrody_web_dns_recon: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_gemini_web_ask: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
  aphrody_web_x_user_by_screen_name: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
  aphrody_web_x_user_tweets: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.ptr,
  },
  aphrody_web_x_community_by_rest_id: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
  aphrody_web_x_community_tweets: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.ptr,
  },
  aphrody_web_x_community_info_and_tweets: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.ptr,
  },
  aphrody_web_dns_recon_submit: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_gemini_web_ask_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_x_user_by_screen_name_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_x_user_tweets_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_x_community_by_rest_id_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_x_community_tweets_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_x_community_info_and_tweets_submit: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32],
    returns: FFIType.u64_fast,
  },
  aphrody_web_x_algorithm_rank: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
    returns: FFIType.ptr,
  },
  bun_rs_version: {
    args: [],
    returns: "cstring",
  },
  bun_rs_add: {
    args: ["i32", "i32"],
    returns: "i32",
  },
  bun_rs_count_char: {
    args: ["ptr", "usize", "u8"],
    returns: "usize",
  },
  bun_rs_find_bytes: {
    args: ["ptr", "usize", "ptr", "usize"],
    returns: "i64",
  },
  bun_rs_hct_to_argb: {
    args: ["f32", "f32", "f32"],
    returns: "u32",
  },
  bun_rs_argb_to_hct: {
    args: ["u32", "ptr", "ptr", "ptr"],
    returns: "void",
  },
  bun_rs_hct_tones: {
    args: ["f32", "f32", "f32", "ptr"],
    returns: "void",
  },
  bun_rs_derive_scheme: {
    args: ["f32", "f32", "bool", "ptr"],
    returns: "void",
  },
  bun_rs_compile_sass: {
    args: ["ptr", "usize", "ptr", "usize", "i32", "bool", "ptr"],
    returns: "ptr",
  },
  bun_rs_compile_sass_file: {
    args: ["ptr", "usize", "ptr", "usize", "i32", "bool", "ptr"],
    returns: "ptr",
  },
  bun_rs_free_string: {
    args: ["ptr"],
    returns: "void",
  },
  bun_rs_validate_spec: {
    args: ["ptr", "usize"],
    returns: "ptr",
  },
  bun_rs_m3_css: {
    args: ["ptr", "usize"],
    returns: "ptr",
  },
  bun_rs_icon_svg: {
    args: ["ptr", "usize"],
    returns: "ptr",
  },
  bun_rs_icon_names: {
    args: ["ptr", "usize"],
    returns: "ptr",
  },
  bun_rs_svg: { args: ["ptr", "usize"], returns: "ptr" },
  bun_rs_render_png: {
    args: ["ptr", "usize", "ptr"],
    returns: "ptr",
  },
  bun_rs_render3d_png: {
    args: ["ptr", "usize", "u32", "ptr"],
    returns: "ptr",
  },
  bun_rs_render_free: {
    args: ["ptr", "usize"],
    returns: "void",
  },
  bun_rs_m3_reproduce: {
    args: ["u8", "ptr", "usize"],
    returns: "ptr",
  },
  bun_rs_m3_seed_from_image: {
    args: ["ptr", "usize"],
    returns: "u32",
  },
  bun_rs_abi_version: { args: [], returns: FFIType.u32 },
} as const;

type NativeLibrary = ReturnType<typeof dlopen<typeof SYMBOLS>>;
type NativeSymbols = NativeLibrary["symbols"];
let library: NativeLibrary | undefined;

function hostTriple(): string | undefined {
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : undefined;
  if (!arch) return undefined;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "linux") {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    return `${arch}-unknown-linux-${report?.header?.glibcVersionRuntime ? "gnu" : "musl"}`;
  }
  return undefined;
}

/** Resolve only artifacts for this host; explicit overrides must exist. */
export function resolveNativeLibraryPath(): string | undefined {
  const override = process.env.APHRODY_FFI_LIB;
  if (override) {
    if (!existsSync(override))
      throw new Error(`APHRODY_FFI_LIB points to a missing file: ${override}`);
    return resolve(override);
  }
  const file = `${process.platform === "win32" ? "" : "lib"}aphrody_ffi.${suffix}`;
  const packageRoot = join(import.meta.dir, "..");
  const repoRoot = join(packageRoot, "..", "..", "..");
  const configuredTarget = process.env.CARGO_TARGET_DIR;
  const target = configuredTarget
    ? isAbsolute(configuredTarget)
      ? configuredTarget
      : resolve(repoRoot, configuredTarget)
    : join(repoRoot, "target");
  const triple = hostTriple();
  const candidates = [
    ...(triple ? [join(packageRoot, "native", triple, file)] : []),
    join(packageRoot, "native", file),
  ];
  for (const profile of ["release", "debug"]) {
    if (triple) candidates.push(join(target, triple, profile, file));
    candidates.push(join(target, profile, file));
  }
  return candidates.find(existsSync);
}

/** @internal All bindings share this handle. Importing a binding never opens it. */
export function loadNativeLibrary(): NativeLibrary {
  if (library) return library;
  const path = resolveNativeLibraryPath();
  if (!path)
    throw new Error(
      "aphrody-ffi native library not found; build aphrody-ffi or set APHRODY_FFI_LIB",
    );
  let loaded: NativeLibrary;
  try {
    loaded = dlopen(path, SYMBOLS);
  } catch (error) {
    throw new Error(`Unable to load aphrody-ffi at ${path}: ${String(error)}`, { cause: error });
  }
  try {
    for (const [name, actual, expected] of [
      ["Aphrody", loaded.symbols.aphrody_abi_version(), EXPECTED_ABI_VERSION],
      ["Web", loaded.symbols.aphrody_web_bridge_abi_version(), EXPECTED_WEB_ABI_VERSION],
      ["Shenron", loaded.symbols.shenron_abi_version(), EXPECTED_SHENRON_ABI_VERSION],
      ["Manga", loaded.symbols.manga_abi_version(), EXPECTED_MANGA_ABI_VERSION],
      ["M3", loaded.symbols.bun_rs_abi_version(), EXPECTED_BUN_RS_ABI_VERSION],
    ] as const) {
      if (actual !== expected)
        throw new Error(`${name} ABI mismatch at ${path}: expected ${expected}, found ${actual}`);
    }
  } catch (error) {
    loaded.close();
    throw error;
  }
  library = loaded;
  return loaded;
}

/** @internal Close only after the engine binding has checked live resources. */
export function closeNativeLibrary(): void {
  library?.close();
  library = undefined;
}

/** @internal Observe lazy loading without opening a library. */
export function nativeLibraryLoaded(): boolean {
  return library !== undefined;
}

// Resolve functions on use so every subpath follows handle close/reload safely.
export const nativeSymbols = new Proxy({} as NativeSymbols, {
  get(_target, property: string | symbol) {
    if (typeof property !== "string" || !(property in SYMBOLS)) return undefined;
    return loadNativeLibrary().symbols[property as keyof NativeSymbols];
  },
});
