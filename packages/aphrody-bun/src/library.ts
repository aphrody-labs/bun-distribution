// SPDX-License-Identifier: Apache-2.0
// One lazy native handle and symbol registry for every @aphrody/bun subpath.
import { dlopen, FFIType, suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageMetadata from "@aphrody/bun/package.json";
import { resolveInstalledNativeLibraryPath } from "@aphrody/bun/src/native-installation.js";
import {
  NATIVE_ABI_VERSIONS,
  nativeDevelopmentEnabled,
  nativeHostTriple,
  verifyNativeArtifact,
} from "@aphrody/bun/src/native-artifact.js";

export const EXPECTED_ABI_VERSION = NATIVE_ABI_VERSIONS.aphrody_abi_version;
export const EXPECTED_WEB_ABI_VERSION = NATIVE_ABI_VERSIONS.aphrody_web_bridge_abi_version;
export const EXPECTED_BUN_RS_ABI_VERSION = NATIVE_ABI_VERSIONS.bun_rs_abi_version;
export const EXPECTED_N2B_ABI_VERSION = NATIVE_ABI_VERSIONS.node2bun_abi_version;
export const EXPECTED_OXC_ABI_VERSION = NATIVE_ABI_VERSIONS.aphrody_oxc_abi_version;

/**
 * Zero-copy exports (crates/interop/ffi/src/zerocopy.rs). Kept out of
 * NATIVE_ABI_VERSIONS so existing artifact manifests stay valid.
 */
export const EXPECTED_ZEROCOPY_ABI_VERSION = 1;

const SYMBOLS = {
  aphrody_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_web_bridge_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_version: { args: [], returns: FFIType.cstring },
  aphrody_run_json: { args: [FFIType.cstring], returns: FFIType.i32 },
  aphrody_run: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  aphrody_run_captured: { args: [FFIType.cstring], returns: FFIType.ptr },
  aphrody_string_free: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_last_error: { args: [], returns: FFIType.ptr },
  aphrody_web_extract_main: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_free_string: { args: [FFIType.ptr], returns: FFIType.void },
  aphrody_web_extract_title: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_extract_links: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_extract_text: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_normalize_url: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_http_request_submit: { args: [FFIType.ptr], returns: FFIType.u64_fast },
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
  aphrody_web_x_client_open: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_x_client_close: { args: [FFIType.u64_fast], returns: FFIType.i32 },
  aphrody_web_x_call: { args: [FFIType.u64_fast, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_x_submit: {
    args: [FFIType.u64_fast, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.u64_fast,
  },
  aphrody_web_x_batch_submit: {
    args: [FFIType.u64_fast, FFIType.ptr, FFIType.ptr],
    returns: FFIType.ptr,
  },
  aphrody_web_x_batch_poll: { args: [FFIType.u64_fast, FFIType.u32], returns: FFIType.ptr },
  aphrody_web_x_batch_cancel: { args: [FFIType.u64_fast], returns: FFIType.i32 },
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
  aphrody_zerocopy_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_toolcall_repair_json: {
    args: [FFIType.ptr, "usize", FFIType.ptr, "usize"],
    returns: FFIType.i64,
  },
  aphrody_toolcall_validate_json: {
    args: [FFIType.ptr, "usize", FFIType.ptr, "usize", FFIType.ptr, "usize"],
    returns: FFIType.i64,
  },
  aphrody_raster_fill_triangle: {
    args: [
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.ptr,
      FFIType.u32,
      FFIType.u32,
      FFIType.f32,
      FFIType.ptr,
    ],
    returns: FFIType.i32,
  },
} as const;

type NativeLibrary = ReturnType<typeof dlopen<typeof SYMBOLS>>;
type NativeSymbols = NativeLibrary["symbols"];
const PIPELINE_SYMBOLS = {
  aphrody_web_pipeline_abi_version: { args: [], returns: FFIType.u32 },
  aphrody_web_pipeline_pending_count: { args: [], returns: FFIType.u64_fast },
  aphrody_web_pipeline_submit: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_command_submit: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_mcp_tool_submit: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
} as const;
type PipelineLibrary = ReturnType<typeof dlopen<typeof PIPELINE_SYMBOLS>>;
const LIBRARY_KEY = Symbol.for("aphrody.ffi.library.v1");
interface SharedNativeLibrary {
  path: string;
  library: NativeLibrary;
  owner: "@aphrody/bun";
  pipeline?: PipelineLibrary;
}
const sharedState = globalThis as typeof globalThis & { [LIBRARY_KEY]?: SharedNativeLibrary };
// The native runtime is process-wide and has no shutdown ABI. Pin its image
// after asynchronous use, so an idle Tokio thread never executes unmapped code.
// Logical close still releases extension handles and allows a fresh binding.
const PINNED_KEY = Symbol.for("aphrody.ffi.pinned-runtime-libraries.v1");
const pinnedState = globalThis as typeof globalThis & { [PINNED_KEY]?: Map<string, NativeLibrary> };

/** The explicit native library override, if any. */
function configuredLibraryOverride(): string | undefined {
  return process.env.APHRODY_FFI_LIB || undefined;
}

/** Resolve only artifacts for this host; explicit overrides must exist. */
export function resolveNativeLibraryPath(): string | undefined {
  const override = configuredLibraryOverride();
  if (override) {
    if (!existsSync(override)) throw new Error(`APHRODY_FFI_LIB points to a missing file: ${override}`);
    return resolve(override);
  }
  const file = `${process.platform === "win32" ? "" : "lib"}aphrody_ffi.${suffix}`;
  const packageRoot = dirname(fileURLToPath(import.meta.resolve("@aphrody/bun/package.json")));
  const repoRoot = join(packageRoot, "..", "..", "..");
  const configuredTarget = process.env.CARGO_TARGET_DIR;
  const target = configuredTarget
    ? isAbsolute(configuredTarget)
      ? configuredTarget
      : resolve(repoRoot, configuredTarget)
    : join(repoRoot, "target");
  const triple = nativeHostTriple();
  const candidates = [
    ...(triple ? [join(packageRoot, "native", triple, file)] : []),
    join(packageRoot, "native", file),
  ];
  const packaged = candidates.find(existsSync);
  if (packaged) return packaged;
  const installed = resolveInstalledNativeLibraryPath();
  if (installed) return installed;
  if (nativeDevelopmentEnabled()) {
    for (const profile of ["release", "runtime", "debug"]) {
      if (triple) candidates.push(join(target, triple, profile, file));
      candidates.push(join(target, profile, file));
    }
  }
  return candidates.find(existsSync);
}

/** @internal All bindings share this handle. Importing a binding never opens it. */
export function loadNativeLibrary(): NativeLibrary {
  const shared = sharedState[LIBRARY_KEY];
  const override = configuredLibraryOverride();
  if (shared && override && resolve(override) !== shared.path) {
    throw new Error(`aphrody_ffi is already loaded from ${shared.path}; native override selects ${resolve(override)}.`);
  }
  if (shared) return shared.library;
  const path = resolveNativeLibraryPath();
  if (!path)
    throw new Error(
      "aphrody-ffi native library not found; install its native package or set APHRODY_FFI_DEV=1 for a local build",
    );
  let loaded: NativeLibrary;
  verifyNativeArtifact(path, packageMetadata.version);
  try {
    loaded = dlopen(path, SYMBOLS);
  } catch (error) {
    throw new Error(`Unable to load aphrody-ffi at ${path}: ${String(error)}`, { cause: error });
  }
  try {
    for (const [name, actual, expected] of [
      ["Aphrody", loaded.symbols.aphrody_abi_version(), EXPECTED_ABI_VERSION],
      ["Web", loaded.symbols.aphrody_web_bridge_abi_version(), EXPECTED_WEB_ABI_VERSION],
      ["M3", loaded.symbols.bun_rs_abi_version(), EXPECTED_BUN_RS_ABI_VERSION],
      ["Zero-copy", loaded.symbols.aphrody_zerocopy_abi_version(), EXPECTED_ZEROCOPY_ABI_VERSION],
    ] as const) {
      if (actual !== expected)
        throw new Error(`${name} ABI mismatch at ${path}: expected ${expected}, found ${actual}`);
    }
  } catch (error) {
    loaded.close();
    throw error;
  }
  sharedState[LIBRARY_KEY] = { path, library: loaded, owner: "@aphrody/bun" };
  return loaded;
}

/** @internal Close only after the engine binding has checked live resources. */
export function closeNativeLibrary(): void {
  if (nativePipelinePendingCount() > 0)
    throw new Error("Cannot close aphrody-ffi while native Web workflows are stopping");
  const shared = sharedState[LIBRARY_KEY];
  if (shared?.pipeline) {
    const pinned = (pinnedState[PINNED_KEY] ??= new Map());
    if (!pinned.has(shared.path)) pinned.set(shared.path, shared.library);
    shared.pipeline.close();
    if (pinned.get(shared.path) !== shared.library) shared.library.close();
  } else {
    shared?.library.close();
  }
  delete sharedState[LIBRARY_KEY];
}

/** @internal Query a loaded extension without opening a new native handle. */
export function nativePipelinePendingCount(): number {
  return Number(sharedState[LIBRARY_KEY]?.pipeline?.symbols.aphrody_web_pipeline_pending_count() ?? 0);
}

/** Optional workflow symbols from the same verified native artifact. Old
 * libraries remain usable by existing bindings; this feature requires its
 * additive extension only when called. Both handles share one mapped library,
 * runtime and allocator, and close together after the engine's resource guard. */
export function loadPipelineSymbols(): PipelineLibrary["symbols"] {
  loadNativeLibrary();
  const shared = sharedState[LIBRARY_KEY]!;
  if (shared.pipeline) return shared.pipeline.symbols;
  const loaded = dlopen(shared.path, PIPELINE_SYMBOLS);
  try {
    const version = loaded.symbols.aphrody_web_pipeline_abi_version();
    if (version !== 1) throw new Error(`Web pipeline ABI mismatch: expected 1, found ${version}`);
  } catch (error) {
    loaded.close();
    throw error;
  }
  shared.pipeline = loaded;
  return loaded.symbols;
}

/** @internal Observe lazy loading without opening a library. */
export function nativeLibraryLoaded(): boolean {
  return sharedState[LIBRARY_KEY] !== undefined;
}

// Resolve functions on use so every subpath follows handle close/reload safely.
export const nativeSymbols = new Proxy({} as NativeSymbols, {
  get(_target, property: string | symbol) {
    if (typeof property !== "string" || !(property in SYMBOLS)) return undefined;
    return loadNativeLibrary().symbols[property as keyof NativeSymbols];
  },
});
