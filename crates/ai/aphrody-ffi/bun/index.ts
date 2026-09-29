// SPDX-License-Identifier: Apache-2.0
//
// Bun `bun:ffi` binding for the aphrody native library (crate `aphrody-ffi`).
//
// Loads the cdylib and exposes the full aphrody command surface in-process:
//
//   import { run, runCaptured, version } from "./index.ts";
//   const r = runCaptured(["doctor", "--json"]);   // { code, stdout, stderr }
//   console.log(JSON.parse(r.stdout));
//
// Set APHRODY_FFI_LIB to override the library path; otherwise it is resolved
// from target/{release,debug}/ relative to this file.

import { CString, dlopen, FFIType, suffix, type Pointer } from "bun:ffi";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** ABI version this binding is written against. */
export const EXPECTED_ABI_VERSION = 1;
export const EXPECTED_WEB_ABI_VERSION = 4;
export const EXPECTED_SHENRON_ABI_VERSION = 1;
export const EXPECTED_MANGA_ABI_VERSION = 1;

const ENCODER = new TextEncoder();

/**
 * Encode a JS string as a NUL-terminated UTF-8 buffer for a `cstring` argument.
 * Pass an explicit `Uint8Array` so the buffer remains owned by this call.
 * Bun also accepts JS strings for `cstring` arguments, but these symbols use
 * pointer arguments and share this helper across the ABI.
 */
/** @internal NUL-terminated UTF-8 marshaling shared by this crate's sub-bindings. */
export function cstr(text: string): Uint8Array {
  if (text.includes("\0")) throw new TypeError("C string values must not contain NUL characters");
  return ENCODER.encode(`${text}\0`);
}

function resolveLibPath(): string {
  const override = process.env.APHRODY_FFI_LIB;
  if (override) {
    if (!existsSync(override)) throw new Error(`APHRODY_FFI_LIB points to a missing file: ${override}`);
    return override;
  }

  // On Windows the cdylib is `aphrody_ffi.dll`; elsewhere `libaphrody_ffi.{so,dylib}`.
  const prefix = process.platform === "win32" ? "" : "lib";
  const fileName = `${prefix}aphrody_ffi.${suffix}`;

  const here = dirname(fileURLToPath(import.meta.url));
  // crates/ai/aphrody-ffi/bun -> repository root is four levels up.
  const targetDir = join(here, "..", "..", "..", "..", "target");

  const candidates: string[] = [];
  for (const profile of ["release", "debug"]) {
    candidates.push(join(targetDir, profile, fileName));
  }
  // Also probe target/<triple>/{release,debug}/ — present when .cargo/config
  // pins a default --target (aphrody defaults to x86_64-pc-windows-msvc).
  try {
    for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const profile of ["release", "debug"]) {
        candidates.push(join(targetDir, entry.name, profile, fileName));
      }
    }
  } catch {
    // target/ may not exist yet; fall through to the bare name.
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`aphrody-ffi native library not found; build aphrody-ffi or set APHRODY_FFI_LIB (searched ${targetDir})`);
}

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
  shenron_rag_search: { args: [FFIType.cstring, FFIType.i32, FFIType.cstring], returns: FFIType.ptr },
  shenron_rag_stats: { args: [], returns: FFIType.ptr },
  shenron_auth_status: { args: [], returns: FFIType.ptr },
  shenron_persona_prompt: { args: [], returns: FFIType.cstring },
  shenron_persona_ask: { args: [FFIType.cstring], returns: FFIType.ptr },
  manga_abi_version: { args: [], returns: FFIType.u32 },
  manga_detect_bubbles: { args: [FFIType.ptr, FFIType.u64_fast], returns: FFIType.ptr },
  manga_typeset_fit: { args: [FFIType.cstring, FFIType.f32, FFIType.f32, FFIType.f32, FFIType.f32, FFIType.i32], returns: FFIType.ptr },
  manga_pipeline_run: { args: [FFIType.ptr, FFIType.u64_fast, FFIType.cstring], returns: FFIType.ptr },
  manga_scanlate_cdn: { args: [FFIType.cstring, FFIType.cstring], returns: FFIType.ptr },
  manga_scanlate_databook: { args: [FFIType.u64, FFIType.u32, FFIType.cstring], returns: FFIType.ptr },
  manga_scanlate_chapter: { args: [FFIType.u64, FFIType.u32, FFIType.cstring], returns: FFIType.ptr },
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
  aphrody_web_media_resolve_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_html_to_markdown: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_simhash64: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_index_last_error: { args: [], returns: FFIType.ptr },
  aphrody_web_index_open: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.i32], returns: FFIType.u64_fast },
  aphrody_web_index_len: { args: [FFIType.u64_fast], returns: FFIType.i64_fast },
  aphrody_web_index_dim: { args: [FFIType.u64_fast], returns: FFIType.u32 },
  aphrody_web_index_add: { args: [FFIType.u64_fast, FFIType.u64_fast, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  aphrody_web_index_add_batch: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
  aphrody_web_index_search: { args: [FFIType.u64_fast, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32], returns: FFIType.ptr },
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
  aphrody_web_embed_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_rerank_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_embed_info: { args: [], returns: FFIType.ptr },
  aphrody_web_embed_install_submit: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_get_chromium_cookies: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_obscura_fetch_submit: { args: [FFIType.ptr, FFIType.u8, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_obscura_fetch: { args: [FFIType.ptr, FFIType.u8, FFIType.u32], returns: FFIType.ptr },
  aphrody_web_dns_recon: { args: [FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_gemini_web_ask: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_x_user_by_screen_name: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_x_user_tweets: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  aphrody_web_x_community_by_rest_id: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  aphrody_web_x_community_tweets: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  aphrody_web_x_community_info_and_tweets: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  aphrody_web_dns_recon_submit: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_gemini_web_ask_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_x_user_by_screen_name_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_x_user_tweets_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_x_community_by_rest_id_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_x_community_tweets_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_x_community_info_and_tweets_submit: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.u64_fast },
  aphrody_web_x_algorithm_rank: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
} as const;

type FfiLibrary = ReturnType<typeof dlopen<typeof SYMBOLS>>;
let lib: FfiLibrary | undefined;
let liveIndexHandles = 0;
let liveDomTrees = 0;
const liveJobIds = new Set<number>();

/** @internal Shared native library handle for the Aphrody, Shenron, Web and Manga exports. */
export function loadLib(): FfiLibrary {
  if (!lib) {
    const libraryPath = resolveLibPath();
    let loaded: FfiLibrary;
    try {
      loaded = dlopen(libraryPath, SYMBOLS);
    } catch (error) {
      throw new Error(`Unable to load aphrody-ffi at ${libraryPath}: ${String(error)}`, { cause: error });
    }
    const actual = loaded.symbols.aphrody_abi_version();
    if (actual !== EXPECTED_ABI_VERSION) {
      loaded.close();
      throw new Error(
        `aphrody-ffi ABI mismatch: binding expects ${EXPECTED_ABI_VERSION}, library reports ${actual}`,
      );
    }
    const webActual = loaded.symbols.aphrody_web_bridge_abi_version();
    if (webActual !== EXPECTED_WEB_ABI_VERSION) {
      loaded.close();
      throw new Error(
        `aphrody-ffi Web ABI mismatch: binding expects ${EXPECTED_WEB_ABI_VERSION}, library reports ${webActual}`,
      );
    }
    const shenronActual = loaded.symbols.shenron_abi_version();
    if (shenronActual !== EXPECTED_SHENRON_ABI_VERSION) {
      loaded.close();
      throw new Error(
        `shenron ABI mismatch: binding expects ${EXPECTED_SHENRON_ABI_VERSION}, library reports ${shenronActual}`,
      );
    }
    const mangaActual = loaded.symbols.manga_abi_version();
    if (mangaActual !== EXPECTED_MANGA_ABI_VERSION) {
      loaded.close();
      throw new Error(
        `Manga ABI mismatch: binding expects ${EXPECTED_MANGA_ABI_VERSION}, library reports ${mangaActual}`,
      );
    }
    lib = loaded;
  }
  return lib;
}

function readOwnedString(
  ptr: bigint | Pointer | null,
  free: (ptr: bigint | Pointer) => void = (value) => loadLib().symbols.aphrody_string_free(value),
): string {
  if (!ptr) throw new Error("aphrody-ffi returned a null string");
  try {
    return new CString(ptr).toString();
  } finally {
    free(ptr);
  }
}

function readOptionalOwnedString(ptr: bigint | Pointer | null): string | null {
  return ptr ? readOwnedString(ptr) : null;
}

function trackJob(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`native job submission failed (id ${id})`);
  liveJobIds.add(id);
  return id;
}

function validateJobId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError("native job id must be a positive safe integer");
}

/** Extract structured page content through the shared Rust extractor. */
export function webExtractMain(html: string, url?: string, options: Record<string, unknown> = {}): Record<string, unknown> {
  const result = readOwnedString(loadLib().symbols.aphrody_web_extract_main(
    cstr(html),
    url === undefined ? null : cstr(url),
    cstr(JSON.stringify(options)),
  ));
  return JSON.parse(result) as Record<string, unknown>;
}

/** Convert HTML with the same native library used by the Aphrody CLI. */
export function webHtmlToMarkdown(html: string, baseUrl?: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_html_to_markdown(
    cstr(html),
    baseUrl === undefined ? null : cstr(baseUrl),
  ));
}

/** Return the 64-bit SimHash as a sixteen-character lowercase hex string. */
export function webSimhash64(text: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_simhash64(cstr(text)));
}

/** Extract an HTML document's title. */
export function webExtractTitle(html: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_extract_title(cstr(html)));
}

/** Strip HTML tags with the native fast path. */
export function webStripTags(html: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_strip_tags(cstr(html)));
}

/** Owned DOM handle. Always call `close()` when finished; `Symbol.dispose` is also supported. */
export class WebDomTree {
  #tree: Pointer | bigint | null;

  constructor(tree: Pointer | bigint) {
    this.#tree = tree;
    liveDomTrees++;
  }

  #handle(): Pointer | bigint {
    if (this.#tree === null) throw new Error("WebDomTree is closed");
    return this.#tree;
  }

  querySelector(selector: string): string | null {
    return readOptionalOwnedString(loadLib().symbols.aphrody_web_query_selector(this.#handle(), cstr(selector)));
  }

  querySelectorAll(selector: string): string[] {
    const payload = readOwnedString(loadLib().symbols.aphrody_web_query_selector_all(this.#handle(), cstr(selector)));
    const result: unknown = JSON.parse(payload);
    if (!Array.isArray(result) || result.some((item) => typeof item !== "string")) {
      throw new Error("native DOM query returned an invalid result");
    }
    return result;
  }

  close(): void {
    if (this.#tree === null) return;
    loadLib().symbols.aphrody_web_tree_destroy(this.#tree);
    this.#tree = null;
    liveDomTrees--;
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/** Parse HTML into an owned native DOM tree. Call `close()` or use `using`. */
export function webParseHtml(html: string): WebDomTree {
  const tree = loadLib().symbols.aphrody_web_parse_html(cstr(html));
  if (!tree) throw new Error("aphrody_web_parse_html returned NULL");
  return new WebDomTree(tree);
}

/** Blocking native Obscura fetch. Use the Submit variant in async applications. */
export function webObscuraFetch(url: string, stealth = false, timeoutMs = 30000): string {
  return readOwnedString(loadLib().symbols.aphrody_web_obscura_fetch(cstr(url), stealth ? 1 : 0, timeoutMs));
}

/** Blocking DNS reconnaissance. Use the Submit variant in async applications. */
export function webDnsRecon(domain: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_dns_recon(cstr(domain)));
}

/** Blocking Gemini web ask. Use the Submit variant in async applications. */
export function webGeminiAsk(cookiePath: string, prompt: string, model?: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_gemini_web_ask(
    cstr(cookiePath), cstr(prompt), model === undefined ? null : cstr(model),
  ));
}

/** Blocking X user lookup. Use the Submit variant in async applications. */
export function webXUser(authToken: string, ct0: string, handle: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_x_user_by_screen_name(cstr(authToken), cstr(ct0), cstr(handle)));
}

/** Blocking X user timeline lookup. Use the Submit variant in async applications. */
export function webXTweets(authToken: string, ct0: string, handle: string, count = 20): string {
  return readOwnedString(loadLib().symbols.aphrody_web_x_user_tweets(cstr(authToken), cstr(ct0), cstr(handle), count));
}

/** Blocking X community lookup. Use the Submit variant in async applications. */
export function webXCommunity(authToken: string, ct0: string, communityId: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_x_community_by_rest_id(cstr(authToken), cstr(ct0), cstr(communityId)));
}

/** Blocking X community timeline lookup. Use the Submit variant in async applications. */
export function webXCommunityTweets(authToken: string, ct0: string, communityId: string, count = 20): string {
  return readOwnedString(loadLib().symbols.aphrody_web_x_community_tweets(cstr(authToken), cstr(ct0), cstr(communityId), count));
}

/** Blocking X community info and timeline lookup. Use the Submit variant in async applications. */
export function webXCommunityInfoAndTweets(authToken: string, ct0: string, communityId: string, count = 20): string {
  return readOwnedString(loadLib().symbols.aphrody_web_x_community_info_and_tweets(
    cstr(authToken), cstr(ct0), cstr(communityId), count,
  ));
}

function webIndexError(): string {
  const payload = JSON.parse(readOwnedString(loadLib().symbols.aphrody_web_index_last_error())) as { error: string | null };
  return payload.error ?? "unknown index error";
}

/** HNSW index backed by the shared Rust Web library. */
export class WebVectorIndex {
  #handle: number;

  private constructor(handle: number, readonly path: string, readonly rebuiltFromCorruptFile: boolean) {
    this.#handle = handle;
    liveIndexHandles++;
  }

  static open(path: string, dim: number, params: Record<string, unknown> = {}): WebVectorIndex {
    const handle = Number(loadLib().symbols.aphrody_web_index_open(cstr(path), dim, cstr(JSON.stringify(params)), 1));
    if (!handle) throw new Error(`index open failed: ${webIndexError()}`);
    return new WebVectorIndex(handle, path, webIndexError().startsWith("corrupt"));
  }

  #id(): number {
    if (!this.#handle) throw new Error("WebVectorIndex is closed");
    return this.#handle;
  }

  get dim(): number { return loadLib().symbols.aphrody_web_index_dim(this.#id()); }
  get size(): number { return Math.max(0, Number(loadLib().symbols.aphrody_web_index_len(this.#id()))); }

  add(key: number, vector: Float32Array): void {
    if (!Number.isSafeInteger(key) || key < 0) throw new RangeError("index key must be a non-negative safe integer");
    if (loadLib().symbols.aphrody_web_index_add(this.#id(), key, vector, vector.length) !== 0) {
      throw new Error(`index add failed: ${webIndexError()}`);
    }
  }

  addBatch(keys: readonly number[], vectors: readonly Float32Array[]): void {
    if (keys.length !== vectors.length) throw new RangeError("key and vector counts differ");
    if (keys.length === 0) return;
    const dim = this.dim;
    const flat = new Float32Array(keys.length * dim);
    vectors.forEach((vector, i) => {
      if (!Number.isSafeInteger(keys[i]) || keys[i]! < 0 || vector.length !== dim) {
        throw new RangeError("invalid index key or vector dimension");
      }
      flat.set(vector, i * dim);
    });
    const nativeKeys = BigUint64Array.from(keys, (key) => BigInt(key));
    if (loadLib().symbols.aphrody_web_index_add_batch(this.#id(), nativeKeys, flat, keys.length, dim) !== 0) {
      throw new Error(`index batch failed: ${webIndexError()}`);
    }
  }

  search(query: Float32Array, k: number, ef = Math.max(128, k * 2)): Array<{ key: number; score: number }> {
    const result = JSON.parse(readOwnedString(loadLib().symbols.aphrody_web_index_search(
      this.#id(), query, query.length, k, ef,
    ))) as Array<{ key: number; score: number }> | { error: string };
    if (!Array.isArray(result)) throw new Error(`index search failed: ${result.error}`);
    return result;
  }

  remove(key: number): boolean { return loadLib().symbols.aphrody_web_index_remove(this.#id(), key) === 1; }
  save(): void {
    if (loadLib().symbols.aphrody_web_index_save(this.#id()) !== 0) throw new Error(`index save failed: ${webIndexError()}`);
  }
  compact(): void {
    if (loadLib().symbols.aphrody_web_index_compact(this.#id()) !== 0) throw new Error(`index compact failed: ${webIndexError()}`);
  }
  stats(): Record<string, unknown> {
    return JSON.parse(readOwnedString(loadLib().symbols.aphrody_web_index_stats(this.#id()))) as Record<string, unknown>;
  }
  close(): void {
    if (!this.#handle) return;
    const status = loadLib().symbols.aphrody_web_index_close(this.#handle);
    if (status !== 0) throw new Error(`index close failed: ${status}`);
    this.#handle = 0;
    liveIndexHandles--;
  }
}

/** Inspect an asynchronous native job without blocking the Bun event loop. */
export function webJobStatus(id: number): -1 | 0 | 1 {
  validateJobId(id);
  return loadLib().symbols.aphrody_web_job_status(id) as -1 | 0 | 1;
}

/** Take a completed job result. Returns null while it is still pending. */
export function webJobTake(id: number): string | null {
  validateJobId(id);
  const result = loadLib().symbols.aphrody_web_job_take(id);
  if (!result) return null;
  liveJobIds.delete(id);
  return readOwnedString(result);
}

/** Cancel a job and discard its result. */
export function webJobCancel(id: number): boolean {
  validateJobId(id);
  const removed = loadLib().symbols.aphrody_web_job_cancel(id) === 1;
  if (removed) liveJobIds.delete(id);
  return removed;
}

/** Wait for a native job without blocking Bun, then release its handle. */
export async function webJobWait(id: number, timeoutMs = 30_000): Promise<string> {
  validateJobId(id);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("native job timeout must be non-negative");
  }
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      const result = webJobTake(id);
      if (result !== null) return result;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`native job ${id} timed out after ${timeoutMs} ms`);
      // Each poll depends on the preceding native job state.
      // eslint-disable-next-line no-await-in-loop
      await Bun.sleep(Math.min(25, remaining));
    }
  } finally {
    webJobCancel(id);
  }
}

export function webJobCompletedSeq(): number {
  return Number(loadLib().symbols.aphrody_web_job_completed_seq());
}

export function webJobPendingCount(): number {
  return loadLib().symbols.aphrody_web_job_pending_count();
}

export function webEmbedSubmit(texts: readonly string[], kind = "passage", timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_embed_submit(cstr(JSON.stringify(texts)), cstr(kind), timeoutMs)));
}

export function webRerankSubmit(query: string, passages: readonly string[], timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_rerank_submit(cstr(query), cstr(JSON.stringify(passages)), timeoutMs)));
}

export function webEmbedInfo(): Record<string, unknown> {
  return JSON.parse(readOwnedString(loadLib().symbols.aphrody_web_embed_info())) as Record<string, unknown>;
}

export function webEmbedInstallSubmit(modelId: string, timeoutMs = 600000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_embed_install_submit(cstr(modelId), timeoutMs)));
}

/** Read cookies from an explicitly selected local Chromium profile. */
export function webGetChromiumCookies(
  userDataPath: string,
  profile: string,
  hostKey: string,
): Array<Record<string, unknown>> {
  const value = JSON.parse(readOwnedString(loadLib().symbols.aphrody_web_get_chromium_cookies(
    cstr(userDataPath), cstr(profile), cstr(hostKey),
  ))) as Array<Record<string, unknown>> | { error: string };
  if (!Array.isArray(value)) throw new Error(value.error);
  return value;
}

/** Start a native HTTP fetch without blocking Bun's event loop. Poll via webJobTake. */
export function webObscuraFetchSubmit(url: string, stealth = false, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_obscura_fetch_submit(cstr(url), stealth ? 1 : 0, timeoutMs)));
}

/** Extract media URLs from HTML or player JavaScript without a network request. */
export function webMediaExtract(source: string, baseUrl: string): {
  candidates: Array<Record<string, unknown>>;
  poster: string | null;
} {
  const result = JSON.parse(readOwnedString(loadLib().symbols.aphrody_web_media_extract(
    cstr(source), cstr(baseUrl),
  ))) as { candidates?: Array<Record<string, unknown>>; poster?: string | null; error?: string };
  if (result.error) throw new Error(result.error);
  return { candidates: result.candidates ?? [], poster: result.poster ?? null };
}

/** Start native embed resolution; read the result with webJobTake. */
export function webMediaResolveSubmit(
  embedUrl: string,
  options: { referer?: string; userAgent?: string; enumerateVariants?: boolean; maxHops?: number } = {},
  timeoutMs = 30000,
): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_media_resolve_submit(
    cstr(embedUrl), cstr(JSON.stringify(options)), timeoutMs,
  )));
}

export function webDnsReconSubmit(domain: string, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_dns_recon_submit(cstr(domain), timeoutMs)));
}

export function webGeminiAskSubmit(cookiePath: string, prompt: string, model?: string, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_gemini_web_ask_submit(
    cstr(cookiePath), cstr(prompt), model === undefined ? null : cstr(model), timeoutMs,
  )));
}

export function webXUserSubmit(authToken: string, ct0: string, handle: string, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_x_user_by_screen_name_submit(
    cstr(authToken), cstr(ct0), cstr(handle), timeoutMs,
  )));
}

export function webXTweetsSubmit(authToken: string, ct0: string, handle: string, count = 20, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_x_user_tweets_submit(
    cstr(authToken), cstr(ct0), cstr(handle), count, timeoutMs,
  )));
}

export function webXCommunitySubmit(authToken: string, ct0: string, communityId: string, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_x_community_by_rest_id_submit(
    cstr(authToken), cstr(ct0), cstr(communityId), timeoutMs,
  )));
}

export function webXCommunityTweetsSubmit(authToken: string, ct0: string, communityId: string, count = 20, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_x_community_tweets_submit(
    cstr(authToken), cstr(ct0), cstr(communityId), count, timeoutMs,
  )));
}

export function webXCommunityInfoAndTweetsSubmit(authToken: string, ct0: string, communityId: string, count = 20, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_x_community_info_and_tweets_submit(
    cstr(authToken), cstr(ct0), cstr(communityId), count, timeoutMs,
  )));
}

export function webXAlgorithmRank(candidates: unknown[], context: Record<string, unknown>, topK: number): unknown {
  const result = readOwnedString(loadLib().symbols.aphrody_web_x_algorithm_rank(
    cstr(JSON.stringify(candidates)), cstr(JSON.stringify(context)), topK,
  ));
  return JSON.parse(result) as unknown;
}

/** Runtime ABI revision of the Shenron command and service exports. */
export function shenronAbiVersion(): number {
  return loadLib().symbols.shenron_abi_version();
}

/** Shenron CLI version. */
export function shenronVersion(): string {
  const value = loadLib().symbols.shenron_version();
  if (value === null) throw new Error("aphrody-ffi returned a null Shenron version");
  return value.toString();
}

/** Run a Shenron command with inherited stdio. Arguments exclude `shenron`. */
export function shenronRun(args: string[]): number {
  validateCliArgs(args);
  return loadLib().symbols.shenron_run_json(cstr(JSON.stringify(args)));
}

/** Run a Shenron command and capture stdout and stderr without spawning a process. */
export function shenronRunCaptured(args: string[]): CapturedResult {
  validateCliArgs(args);
  const pointer = loadLib().symbols.shenron_run_captured(cstr(JSON.stringify(args)));
  return parseCapturedResult(readOwnedString(pointer, (value) => loadLib().symbols.shenron_string_free(value)), "Shenron");
}

/** Search Shenron RAG; the returned JSON carries the CLI code, stdout and stderr. */
export function shenronRagSearch(query: string, limit = 10, kind?: string): CapturedResult {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("RAG limit must be a positive integer");
  const pointer = loadLib().symbols.shenron_rag_search(
    cstr(query), limit, kind === undefined ? null : cstr(kind),
  );
  return parseCapturedResult(readOwnedString(pointer, (value) => loadLib().symbols.shenron_string_free(value)), "Shenron RAG search");
}

/** Read Shenron RAG statistics; the returned JSON carries code/stdout/stderr. */
export function shenronRagStats(): CapturedResult {
  const pointer = loadLib().symbols.shenron_rag_stats();
  return parseCapturedResult(readOwnedString(pointer, (value) => loadLib().symbols.shenron_string_free(value)), "Shenron RAG stats");
}

/** Read sanitized Shenron authentication status; secret values are never returned. */
export function shenronAuthStatus(): CapturedResult {
  const pointer = loadLib().symbols.shenron_auth_status();
  return parseCapturedResult(readOwnedString(pointer, (value) => loadLib().symbols.shenron_string_free(value)), "Shenron auth status");
}

/** Read the canonical local Shenron persona prompt. */
export function shenronPersonaPrompt(): string {
  const value = loadLib().symbols.shenron_persona_prompt();
  if (value === null) throw new Error("shenron_persona_prompt returned a null pointer");
  return value.toString();
}

/** Ask the Shenron persona; result carries code/stdout/stderr. */
export function shenronPersonaAsk(question: string): CapturedResult {
  const pointer = loadLib().symbols.shenron_persona_ask(cstr(question));
  return parseCapturedResult(readOwnedString(pointer, (value) => loadLib().symbols.shenron_string_free(value)), "Shenron persona");
}

function validateCliArgs(args: string[]): void {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("CLI arguments must be strings without NUL characters");
  }
}

function parseCapturedResult(text: string, operation: string): CapturedResult {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== "object" || value === null ||
    !Number.isInteger((value as any).code) ||
    typeof (value as any).stdout !== "string" ||
    typeof (value as any).stderr !== "string"
  ) {
    throw new Error(`${operation} returned an invalid captured-result payload`);
  }
  return value as CapturedResult;
}

/** Native ABI version reported by the loaded library. */
export function abiVersion(): number {
  return loadLib().symbols.aphrody_abi_version();
}

/** aphrody version string. */
export function version(): string {
  const value = loadLib().symbols.aphrody_version();
  if (value === null) throw new Error("aphrody-ffi returned a null version");
  return value.toString();
}

/** The last error recorded on this thread by the native library, if any. */
export function lastError(): string | null {
  const ptr = loadLib().symbols.aphrody_last_error();
  if (!ptr) return null;
  const text = new CString(ptr).toString();
  return text.length > 0 ? text : null;
}

/**
 * Run an aphrody command with stdout/stderr inherited by the host process.
 * Returns the exit code. Arguments exclude the program name.
 */
export function run(args: string[]): number {
  validateCliArgs(args);
  return loadLib().symbols.aphrody_run_json(cstr(JSON.stringify(args)));
}

/** Structured result of a captured run. */
export interface CapturedResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run an aphrody command capturing stdout AND stderr in-process. Arguments
 * exclude the program name, e.g. `runCaptured(["version", "--json"])`.
 */
export function runCaptured(args: string[]): CapturedResult {
  validateCliArgs(args);
  const resultPtr = loadLib().symbols.aphrody_run_captured(cstr(JSON.stringify(args)));
  if (!resultPtr) throw new Error(lastError() ?? "aphrody_run_captured returned NULL");
  return parseCapturedResult(readOwnedString(resultPtr), "Aphrody CLI");
}

/** Throws if the loaded library's ABI does not match this binding. */
export function assertCompatible(): void {
  const actual = abiVersion();
  if (actual !== EXPECTED_ABI_VERSION) {
    throw new Error(
      `aphrody-ffi ABI mismatch: binding expects ${EXPECTED_ABI_VERSION}, library reports ${actual}`,
    );
  }
}

/** Close the native library handle (optional; the process exit also frees it). */
export function close(): void {
  if (liveIndexHandles > 0 || liveDomTrees > 0 || liveJobIds.size > 0) {
    throw new Error(
      `Cannot close aphrody-ffi with live native resources (${liveIndexHandles} indexes, ${liveDomTrees} DOM trees, ${liveJobIds.size} jobs)`,
    );
  }
  lib?.close();
  lib = undefined;
}
