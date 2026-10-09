// SPDX-License-Identifier: Apache-2.0
//
// Bun binding of the aphrody-x native job API (Web ABI 5, crates/interop/ffi/src/web/x.rs).
//
// One generic, versioned JSON surface over the Rust X client: open a client once (the cookies cross
// the boundary a single time, or Rust discovers them exactly as the CLI does), then run operations
// by name with JSON arguments. Retry, rate-limit waiting, pacing, bounded concurrency and the JSONL
// checkpoint all live in Rust; this module only marshals and polls.
//
//   const { client } = xClientOpen(null);                                  // discovery, like `aphrody x`
//   const user = await xSubmit(client, "user_by_screen_name", { handle: "aphrody_code" });
//   const { batch } = xBatchSubmit(client, ops, { concurrency: 8, checkpoint: "run.jsonl" });
//   for (;;) { const poll = xBatchPoll(batch); /* poll.items, poll.done, poll.summary */ }
//
// The operation table (names, arguments, retry class) is served by `xCall(0, "meta")`. The
// high-level package is `@aphrody/x`, which builds `XClient` and `xBatch` on top of this module.

import { cstr, loadLib, readOwnedString, trackJob } from "./engine";
import { webJobCancel, webJobTake } from "./engine";

/** How a failure should be treated (see crates/web/x/src/policy.rs). */
export type XErrorKind = "auth" | "terminal" | "rate_limit" | "transient" | "invalid" | "other";

export interface XNativeErrorInfo {
  message: string;
  kind: XErrorKind;
  /** The X API error code, when the failure carried one. */
  code?: number;
  /** The HTTP status, when the failure was a bare HTTP status. */
  status?: number;
  /** For a rate limit: the epoch second at which the window reopens, when known. */
  reset_epoch?: number;
}

export interface XRateLimitSnapshot {
  limit: number;
  remaining: number;
  reset_epoch: number;
}

interface XEnvelopeBase {
  op: string;
  /** The caller identity of the operation, when it had one. */
  id: string | null;
  /** The rate-limit window seen by this call itself. */
  rate_limit: XRateLimitSnapshot | null;
  attempts: number;
  elapsed_ms: number;
  /** Set on a batch result replayed from the checkpoint instead of being executed again. */
  resumed?: boolean;
}

export interface XEnvelopeOk<T = unknown> extends XEnvelopeBase {
  ok: true;
  data: T;
}

export interface XEnvelopeErr extends XEnvelopeBase {
  ok: false;
  error: XNativeErrorInfo;
}

/** The result of one operation. */
export type XEnvelope<T = unknown> = XEnvelopeOk<T> | XEnvelopeErr;

/** A failure of the native layer itself (opening a client, submitting a batch). */
export class XNativeError extends Error {
  readonly kind: XErrorKind;
  readonly code?: number;
  readonly status?: number;
  readonly resetEpoch?: number;

  constructor(info: XNativeErrorInfo) {
    super(info.message);
    this.name = "XNativeError";
    this.kind = info.kind;
    this.code = info.code;
    this.status = info.status;
    this.resetEpoch = info.reset_epoch;
  }
}

// ---------------------------------------------------------------------------
// Options (camelCase here, snake_case on the wire)
// ---------------------------------------------------------------------------

export type XSessionInput =
  | { auth_token: string; ct0: string; handle?: string; transaction_id?: string }
  | { cookie_string: string }
  | { session_file: string }
  | string
  | null
  | undefined;

export interface XClientOptions {
  /** Replaces `https://x.com/i/api` (loopback servers in tests). Credentials are sent there. */
  apiBase?: string;
  uploadBase?: string;
  /** Total timeout of one HTTP request, in milliseconds (default 60 000). */
  timeoutMs?: number;
  /** Write a rotated `ct0` / `auth_token` back to the session file (default: when it came from one). */
  persistSession?: boolean;
  queryIdsPath?: string;
  queryIdsTtlSecs?: number;
  /** Pages scanned when a queryId must be refreshed; an empty list disables discovery. */
  discoveryPages?: string[];
}

export interface XRetryPolicy {
  /** Retries after the first attempt for transient failures (default 3). */
  maxRetries?: number;
  baseMs?: number;
  maxBackoffMs?: number;
  jitter?: number;
  maxRateLimitWaits?: number;
  /** Longest single wait for a rate-limit window, in seconds (default 900). */
  maxWaitSecs?: number;
  rateLimitMarginMs?: number;
  /** Also retry operations that are not idempotent after an ambiguous failure (default false). */
  retryNonIdempotent?: boolean;
  /** Wait out rate limits for mutations too (default: batches wait, single calls report them). */
  waitRateLimitMutations?: boolean;
}

export interface XPacing {
  perWindow?: number;
  perDay?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  reserve?: number;
}

export interface XCallOptions {
  /** Echoed in the envelope. */
  id?: string;
  /** Per-request timeout in milliseconds (default 120 000). */
  timeoutMs?: number;
  retry?: XRetryPolicy;
  /** Cancels the native job and rejects with an AbortError. */
  signal?: AbortSignal;
}

export interface XBatchOptions {
  /** Operations in flight at once, 1 to 256 (default 4). */
  concurrency?: number;
  retry?: XRetryPolicy;
  /** Pacing of mutating operations (off by default). */
  pacing?: XPacing;
  /** JSONL results file: completed operations are appended, a rerun resumes from it. */
  checkpoint?: string;
  timeoutMs?: number;
  /** Results that may wait to be drained before dispatching pauses (default 10 000). */
  buffer?: number;
  /** Stop dispatching after an `auth` failure (default true). */
  stopOnAuth?: boolean;
}

export interface XBatchOpInput {
  /** Unique, stable identity: it keys the checkpoint. Default: a hash of the operation and arguments. */
  id?: string;
  op: string;
  args?: unknown;
}

export interface XBatchSummary {
  total: number;
  ok: number;
  failed: number;
  resumed: number;
  not_run: number;
  elapsed_ms: number;
  stopped_by: "auth" | "error" | null;
  error?: string;
}

export interface XBatchPoll {
  items: XEnvelope[];
  /** True with the last poll: the batch finished and everything was drained. */
  done: boolean;
  pending: number;
  completed: number;
  total: number;
  summary: XBatchSummary | null;
}

function defined<T extends Record<string, unknown>>(entries: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

/** @internal Wire form of the client options. */
export function clientOptionsJson(options: XClientOptions): Record<string, unknown> {
  return defined({
    api_base: options.apiBase,
    upload_base: options.uploadBase,
    timeout_ms: options.timeoutMs,
    persist_session: options.persistSession,
    query_ids_path: options.queryIdsPath,
    query_ids_ttl_secs: options.queryIdsTtlSecs,
    discovery_pages: options.discoveryPages,
  });
}

/** @internal Wire form of a retry policy. */
export function retryJson(retry: XRetryPolicy | undefined): Record<string, unknown> | undefined {
  if (!retry) return undefined;
  return defined({
    max_retries: retry.maxRetries,
    base_ms: retry.baseMs,
    max_backoff_ms: retry.maxBackoffMs,
    jitter: retry.jitter,
    max_rate_limit_waits: retry.maxRateLimitWaits,
    max_wait_secs: retry.maxWaitSecs,
    rate_limit_margin_ms: retry.rateLimitMarginMs,
    retry_non_idempotent: retry.retryNonIdempotent,
    wait_rate_limit_mutations: retry.waitRateLimitMutations,
  });
}

function pacingJson(pacing: XPacing | undefined): Record<string, unknown> | undefined {
  if (!pacing) return undefined;
  return defined({
    per_window: pacing.perWindow,
    per_day: pacing.perDay,
    min_delay_ms: pacing.minDelayMs,
    max_delay_ms: pacing.maxDelayMs,
    reserve: pacing.reserve,
  });
}

// ---------------------------------------------------------------------------
// Marshaling
// ---------------------------------------------------------------------------

function parseJson(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`aphrody-ffi returned invalid JSON for ${what}`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`aphrody-ffi returned a non-object for ${what}`);
  return value as Record<string, unknown>;
}

function failure(value: Record<string, unknown>): XNativeError {
  const error = value.error;
  if (error && typeof error === "object" && "message" in error)
    return new XNativeError(error as XNativeErrorInfo);
  return new XNativeError({ message: String(error ?? "native call failed"), kind: "other" });
}

/** Fill what a failure raised before the runner (a bad argument, a null pointer) leaves out. */
function normalize(value: Record<string, unknown>, op: string): XEnvelope {
  if (value.ok === true || value.ok === false) {
    return {
      op,
      id: null,
      rate_limit: null,
      attempts: 0,
      elapsed_ms: 0,
      ...value,
    } as XEnvelope;
  }
  // A legacy `{"error": "..."}` job result (a job timeout, a native panic).
  return {
    ok: false,
    op,
    id: null,
    rate_limit: null,
    attempts: 0,
    elapsed_ms: 0,
    error: { message: String(value.error ?? "unknown native failure"), kind: "other" },
  };
}

function jsonText(value: unknown, what: string): string {
  const text = JSON.stringify(value ?? {});
  if (text === undefined) throw new TypeError(`${what} must be JSON-serializable`);
  return text;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface XClientHandle {
  /** The native client handle (pass it to every other function). */
  client: number;
  /** The handle (screen name) of the session, when it declared one. */
  handle?: string;
  apiBase: string;
}

/**
 * Open a native X client. `session` is explicit tokens, a cookie string, a session file, or
 * `null`/`undefined` to let Rust discover the credentials as `aphrody x` does (`X_COOKIE_STRING`,
 * `~/.aphrody/x-session.json`, `X_AUTH_TOKEN` + `X_CT0`). Throws `XNativeError` when it cannot.
 */
export function xClientOpen(
  session: XSessionInput = null,
  options: XClientOptions = {},
): XClientHandle {
  const lib = loadLib().symbols;
  const reply = parseJson(
    readOwnedString(
      lib.aphrody_web_x_client_open(
        session === null || session === undefined ? null : cstr(JSON.stringify(session)),
        cstr(JSON.stringify(clientOptionsJson(options))),
      ),
    ),
    "x client open",
  );
  if (reply.ok !== true) throw failure(reply);
  return {
    client: Number(reply.client),
    handle: typeof reply.handle === "string" ? reply.handle : undefined,
    apiBase: String(reply.api_base),
  };
}

/** Release a client. Operations still running on it finish normally. */
export function xClientClose(client: number): boolean {
  return loadLib().symbols.aphrody_web_x_client_close(client) === 1;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Run a **local** operation synchronously (parsers, catalog, ranking, store, client state).
 * `client` is `0` for operations that need no session. Network operations are refused: use
 * {@link xSubmit}.
 */
export function xCall<T = unknown>(client: number, op: string, args: unknown = {}): XEnvelope<T> {
  const lib = loadLib().symbols;
  const reply = parseJson(
    readOwnedString(lib.aphrody_web_x_call(client, cstr(op), cstr(jsonText(args, "args")))),
    `x call ${op}`,
  );
  return normalize(reply, op) as XEnvelope<T>;
}

/** Like {@link xCall}, returning the data or throwing the failure as an `XNativeError`. */
export function xCallData<T = unknown>(client: number, op: string, args: unknown = {}): T {
  const envelope = xCall<T>(client, op, args);
  if (!envelope.ok) throw new XNativeError(envelope.error);
  return envelope.data;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/** Wait for a job with an adaptive poll: tight while results are expected soon, relaxed after. */
async function waitJob(id: number, signal?: AbortSignal): Promise<string> {
  let delay = 1;
  try {
    for (;;) {
      const text = webJobTake(id);
      if (text !== null) return text;
      if (signal?.aborted) throw abortReason(signal);
      // Each poll depends on the preceding job state.
      // oxlint-disable-next-line no-await-in-loop -- poll loop: each poll depends on the preceding job state
      await Bun.sleep(delay);
      delay = Math.min(delay * 2, 16);
    }
  } finally {
    // A no-op once the result was taken; cancels the Rust task when we stop waiting early.
    webJobCancel(id);
  }
}

/**
 * Run any operation (local or network) as a native job and resolve with its envelope. Failures of
 * the operation are data (`ok: false`, with a `kind`), not exceptions; only an aborted `signal`
 * rejects. Retry, rate-limit waiting and the per-request timeout are applied in Rust.
 */
export async function xSubmit<T = unknown>(
  client: number,
  op: string,
  args: unknown = {},
  options: XCallOptions = {},
): Promise<XEnvelope<T>> {
  if (options.signal?.aborted) throw abortReason(options.signal);
  const wire = defined({
    id: options.id,
    timeout_ms: options.timeoutMs,
    retry: retryJson(options.retry),
  });
  const id = trackJob(
    Number(
      loadLib().symbols.aphrody_web_x_submit(
        client,
        cstr(op),
        cstr(jsonText(args, "args")),
        cstr(JSON.stringify(wire)),
      ),
    ),
  );
  const text = await waitJob(id, options.signal);
  return normalize(parseJson(text, `x job ${op}`), op) as XEnvelope<T>;
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/**
 * Start a batch. Throws `XNativeError` for what is wrong before anything runs: unparsable
 * operations, duplicate ids, an unknown client.
 */
export function xBatchSubmit(
  client: number,
  ops: readonly XBatchOpInput[],
  options: XBatchOptions = {},
): { batch: number; total: number } {
  const wire = defined({
    concurrency: options.concurrency,
    retry: retryJson(options.retry),
    pacing: pacingJson(options.pacing),
    checkpoint: options.checkpoint,
    timeout_ms: options.timeoutMs,
    buffer: options.buffer,
    stop_on_auth: options.stopOnAuth,
  });
  const reply = parseJson(
    readOwnedString(
      loadLib().symbols.aphrody_web_x_batch_submit(
        client,
        cstr(jsonText(ops, "ops")),
        cstr(JSON.stringify(wire)),
      ),
    ),
    "x batch submit",
  );
  if (reply.ok !== true) throw failure(reply);
  return { batch: Number(reply.batch), total: Number(reply.total) };
}

/** Take up to `max` finished results of a batch. The last poll (`done`) forgets the batch. */
export function xBatchPoll(batch: number, max = 256): XBatchPoll {
  const reply = parseJson(
    readOwnedString(loadLib().symbols.aphrody_web_x_batch_poll(batch, max)),
    "x batch poll",
  );
  if (reply.ok === false) throw failure(reply);
  return reply as unknown as XBatchPoll;
}

/** Stop a batch: nothing more is dispatched and operations in flight are aborted. */
export function xBatchCancel(batch: number): boolean {
  return loadLib().symbols.aphrody_web_x_batch_cancel(batch) === 1;
}
