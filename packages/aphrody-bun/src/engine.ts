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
// from an installed native artifact; local builds require APHRODY_FFI_DEV=1.

import { CString, type Pointer } from "bun:ffi";
import { closeNativeLibrary, loadNativeLibrary, EXPECTED_ABI_VERSION, EXPECTED_WEB_ABI_VERSION } from "./library";
export { EXPECTED_ABI_VERSION, EXPECTED_WEB_ABI_VERSION };

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

type FfiLibrary = ReturnType<typeof loadNativeLibrary>;
let liveIndexHandles = 0;
let liveDomTrees = 0;
const liveJobIds = new Set<number>();

/** @internal Shared native library handle for the Aphrody and Web exports. */
export function loadLib(): FfiLibrary {
  return loadNativeLibrary();
}

/** @internal Read and release a string owned by the native library (shared by the sub-bindings). */
export function readOwnedString(
  ptr: bigint | Pointer | null,
  free: (ptr: bigint | Pointer) => void = value => loadLib().symbols.aphrody_string_free(value),
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

/** @internal Register a submitted native job so closing the library with live jobs is refused. */
export function trackJob(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`native job submission failed (id ${id})`);
  liveJobIds.add(id);
  return id;
}

function validateJobId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError("native job id must be a positive safe integer");
}

/** Extract structured page content through the shared Rust extractor. */
export function webExtractMain(
  html: string,
  url?: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  const result = readOwnedString(
    loadLib().symbols.aphrody_web_extract_main(
      cstr(html),
      url === undefined ? null : cstr(url),
      cstr(JSON.stringify(options)),
    ),
  );
  return JSON.parse(result) as Record<string, unknown>;
}

/** Convert HTML with the same native library used by the Aphrody CLI. */
export function webHtmlToMarkdown(html: string, baseUrl?: string): string {
  return readOwnedString(
    loadLib().symbols.aphrody_web_html_to_markdown(cstr(html), baseUrl === undefined ? null : cstr(baseUrl)),
  );
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

/** Extract distinct hyperlinks through the shared native text owner. */
export function webExtractLinks(html: string, baseUrl?: string): string[] {
  const value: unknown = JSON.parse(
    readOwnedString(
      loadLib().symbols.aphrody_web_extract_links(cstr(html), baseUrl === undefined ? null : cstr(baseUrl)),
    ),
  );
  if (!Array.isArray(value) || value.some(link => typeof link !== "string"))
    throw new Error("native link extraction returned an invalid result");
  return value;
}

export function webExtractText(html: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_extract_text(cstr(html)));
}

export function webNormalizeUrl(url: string): string {
  return readOwnedString(loadLib().symbols.aphrody_web_normalize_url(cstr(url)));
}

export interface WebHttpRequestOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";
  headers?: ConstructorParameters<typeof Headers>[0];
  body?: string;
  cookies?: string;
  timeoutMs?: number;
  /** Requests return redirect status/Location without following another origin. */
  redirect?: "manual";
}

/** Authenticated API transport owned by Aphrody Web, with an isolated explicit cookie header. */
export class WebHttpClient {
  constructor(private readonly options: { stealth?: boolean; timeoutMs?: number } = {}) {}

  async fetch(url: string, options: WebHttpRequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    if (options.cookies !== undefined) {
      if (headers.has("cookie")) throw new TypeError("supply cookies through either headers or cookies");
      headers.set("cookie", options.cookies);
    }
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 0xffffffff)
      throw new RangeError("timeoutMs must be a positive u32 integer");
    const request = {
      url,
      method: options.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      body: options.body ?? "",
      stealth: this.options.stealth ?? false,
      timeoutMs,
    };
    const id = trackJob(Number(loadLib().symbols.aphrody_web_http_request_submit(cstr(JSON.stringify(request)))));
    const value: unknown = JSON.parse(await webJobWait(id, timeoutMs + 1000));
    if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) {
      const message =
        value && typeof value === "object" && "error" in value && typeof value.error === "string"
          ? value.error
          : "native HTTP request failed";
      throw new Error(message);
    }
    if (
      !("status" in value) ||
      typeof value.status !== "number" ||
      !("body" in value) ||
      typeof value.body !== "string" ||
      !("headers" in value) ||
      !value.headers ||
      typeof value.headers !== "object"
    )
      throw new Error("native HTTP response is invalid");
    const responseHeaders = new Headers();
    for (const [key, field] of Object.entries(value.headers)) {
      if (typeof field !== "string") throw new Error("native HTTP header is invalid");
      responseHeaders.set(key, field);
    }
    const response = new Response(
      [204, 205, 304].includes(value.status) || request.method === "HEAD" ? null : value.body,
      { status: value.status, headers: responseHeaders },
    );
    Object.defineProperty(response, "url", {
      value: "url" in value && typeof value.url === "string" ? value.url : url,
    });
    return response;
  }
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
    if (!Array.isArray(result) || result.some(item => typeof item !== "string")) {
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
  return readOwnedString(
    loadLib().symbols.aphrody_web_gemini_web_ask(
      cstr(cookiePath),
      cstr(prompt),
      model === undefined ? null : cstr(model),
    ),
  );
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
  return readOwnedString(
    loadLib().symbols.aphrody_web_x_community_by_rest_id(cstr(authToken), cstr(ct0), cstr(communityId)),
  );
}

/** Blocking X community timeline lookup. Use the Submit variant in async applications. */
export function webXCommunityTweets(authToken: string, ct0: string, communityId: string, count = 20): string {
  return readOwnedString(
    loadLib().symbols.aphrody_web_x_community_tweets(cstr(authToken), cstr(ct0), cstr(communityId), count),
  );
}

/** Blocking X community info and timeline lookup. Use the Submit variant in async applications. */
export function webXCommunityInfoAndTweets(authToken: string, ct0: string, communityId: string, count = 20): string {
  return readOwnedString(
    loadLib().symbols.aphrody_web_x_community_info_and_tweets(cstr(authToken), cstr(ct0), cstr(communityId), count),
  );
}

function webIndexError(): string {
  const payload = JSON.parse(readOwnedString(loadLib().symbols.aphrody_web_index_last_error())) as {
    error: string | null;
  };
  return payload.error ?? "unknown index error";
}

/** HNSW index backed by the shared Rust Web library. */
export class WebVectorIndex {
  #handle: number;

  private constructor(
    handle: number,
    readonly path: string,
    readonly rebuiltFromCorruptFile: boolean,
  ) {
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

  get dim(): number {
    return loadLib().symbols.aphrody_web_index_dim(this.#id());
  }
  get size(): number {
    return Math.max(0, Number(loadLib().symbols.aphrody_web_index_len(this.#id())));
  }

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
    const nativeKeys = BigUint64Array.from(keys, key => BigInt(key));
    if (loadLib().symbols.aphrody_web_index_add_batch(this.#id(), nativeKeys, flat, keys.length, dim) !== 0) {
      throw new Error(`index batch failed: ${webIndexError()}`);
    }
  }

  search(query: Float32Array, k: number, ef = Math.max(128, k * 2)): Array<{ key: number; score: number }> {
    const result = JSON.parse(
      readOwnedString(loadLib().symbols.aphrody_web_index_search(this.#id(), query, query.length, k, ef)),
    ) as Array<{ key: number; score: number }> | { error: string };
    if (!Array.isArray(result)) throw new Error(`index search failed: ${result.error}`);
    return result;
  }

  remove(key: number): boolean {
    return loadLib().symbols.aphrody_web_index_remove(this.#id(), key) === 1;
  }
  save(): void {
    if (loadLib().symbols.aphrody_web_index_save(this.#id()) !== 0)
      throw new Error(`index save failed: ${webIndexError()}`);
  }
  compact(): void {
    if (loadLib().symbols.aphrody_web_index_compact(this.#id()) !== 0)
      throw new Error(`index compact failed: ${webIndexError()}`);
  }
  stats(): Record<string, unknown> {
    return JSON.parse(readOwnedString(loadLib().symbols.aphrody_web_index_stats(this.#id()))) as Record<
      string,
      unknown
    >;
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
export async function webJobWait(
  id: number,
  timeoutMs = 30_000,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  validateJobId(id);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("native job timeout must be non-negative");
  }
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      options.signal?.throwIfAborted();
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
  return trackJob(
    Number(loadLib().symbols.aphrody_web_embed_submit(cstr(JSON.stringify(texts)), cstr(kind), timeoutMs)),
  );
}

export function webRerankSubmit(query: string, passages: readonly string[], timeoutMs = 30000): number {
  return trackJob(
    Number(loadLib().symbols.aphrody_web_rerank_submit(cstr(query), cstr(JSON.stringify(passages)), timeoutMs)),
  );
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
  const value = JSON.parse(
    readOwnedString(
      loadLib().symbols.aphrody_web_get_chromium_cookies(cstr(userDataPath), cstr(profile), cstr(hostKey)),
    ),
  ) as Array<Record<string, unknown>> | { error: string };
  if (!Array.isArray(value)) throw new Error(value.error);
  return value;
}

/** Start a native HTTP fetch without blocking Bun's event loop. Poll via webJobTake. */
export function webObscuraFetchSubmit(url: string, stealth = false, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_obscura_fetch_submit(cstr(url), stealth ? 1 : 0, timeoutMs)));
}

/** Extract media URLs from HTML or player JavaScript without a network request. */
export function webMediaExtract(
  source: string,
  baseUrl: string,
): {
  candidates: Array<Record<string, unknown>>;
  poster: string | null;
} {
  const result = JSON.parse(
    readOwnedString(loadLib().symbols.aphrody_web_media_extract(cstr(source), cstr(baseUrl))),
  ) as { candidates?: Array<Record<string, unknown>>; poster?: string | null; error?: string };
  if (result.error) throw new Error(result.error);
  return { candidates: result.candidates ?? [], poster: result.poster ?? null };
}

/** Start native embed resolution; read the result with webJobTake. */
export function webMediaResolveSubmit(
  embedUrl: string,
  options: {
    referer?: string;
    userAgent?: string;
    enumerateVariants?: boolean;
    maxHops?: number;
  } = {},
  timeoutMs = 30000,
): number {
  return trackJob(
    Number(
      loadLib().symbols.aphrody_web_media_resolve_submit(cstr(embedUrl), cstr(JSON.stringify(options)), timeoutMs),
    ),
  );
}

export function webDnsReconSubmit(domain: string, timeoutMs = 30000): number {
  return trackJob(Number(loadLib().symbols.aphrody_web_dns_recon_submit(cstr(domain), timeoutMs)));
}

export function webGeminiAskSubmit(cookiePath: string, prompt: string, model?: string, timeoutMs = 30000): number {
  return trackJob(
    Number(
      loadLib().symbols.aphrody_web_gemini_web_ask_submit(
        cstr(cookiePath),
        cstr(prompt),
        model === undefined ? null : cstr(model),
        timeoutMs,
      ),
    ),
  );
}

export function webXUserSubmit(authToken: string, ct0: string, handle: string, timeoutMs = 30000): number {
  return trackJob(
    Number(
      loadLib().symbols.aphrody_web_x_user_by_screen_name_submit(cstr(authToken), cstr(ct0), cstr(handle), timeoutMs),
    ),
  );
}

export function webXTweetsSubmit(
  authToken: string,
  ct0: string,
  handle: string,
  count = 20,
  timeoutMs = 30000,
): number {
  return trackJob(
    Number(
      loadLib().symbols.aphrody_web_x_user_tweets_submit(cstr(authToken), cstr(ct0), cstr(handle), count, timeoutMs),
    ),
  );
}

export function webXCommunitySubmit(authToken: string, ct0: string, communityId: string, timeoutMs = 30000): number {
  return trackJob(
    Number(
      loadLib().symbols.aphrody_web_x_community_by_rest_id_submit(
        cstr(authToken),
        cstr(ct0),
        cstr(communityId),
        timeoutMs,
      ),
    ),
  );
}

export function webXCommunityTweetsSubmit(
  authToken: string,
  ct0: string,
  communityId: string,
  count = 20,
  timeoutMs = 30000,
): number {
  return trackJob(
    Number(
      loadLib().symbols.aphrody_web_x_community_tweets_submit(
        cstr(authToken),
        cstr(ct0),
        cstr(communityId),
        count,
        timeoutMs,
      ),
    ),
  );
}

export function webXCommunityInfoAndTweetsSubmit(
  authToken: string,
  ct0: string,
  communityId: string,
  count = 20,
  timeoutMs = 30000,
): number {
  return trackJob(
    Number(
      loadLib().symbols.aphrody_web_x_community_info_and_tweets_submit(
        cstr(authToken),
        cstr(ct0),
        cstr(communityId),
        count,
        timeoutMs,
      ),
    ),
  );
}

export function webXAlgorithmRank(candidates: unknown[], context: Record<string, unknown>, topK: number): unknown {
  const result = readOwnedString(
    loadLib().symbols.aphrody_web_x_algorithm_rank(
      cstr(JSON.stringify(candidates)),
      cstr(JSON.stringify(context)),
      topK,
    ),
  );
  return JSON.parse(result) as unknown;
}

function validateCliArgs(args: string[]): void {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string" || arg.includes("\0"))) {
    throw new TypeError("CLI arguments must be strings without NUL characters");
  }
}

function parseCapturedResult(text: string, operation: string): CapturedResult {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== "object" ||
    value === null ||
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
    throw new Error(`aphrody-ffi ABI mismatch: binding expects ${EXPECTED_ABI_VERSION}, library reports ${actual}`);
  }
}

/** Close the native library handle (optional; the process exit also frees it). */
export function close(): void {
  if (liveIndexHandles > 0 || liveDomTrees > 0 || liveJobIds.size > 0) {
    throw new Error(
      `Cannot close aphrody-ffi with live native resources (${liveIndexHandles} indexes, ${liveDomTrees} DOM trees, ${liveJobIds.size} jobs)`,
    );
  }
  closeNativeLibrary();
}
