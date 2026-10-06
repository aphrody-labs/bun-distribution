// SPDX-License-Identifier: Apache-2.0
/** Shared HTTP plumbing of the transports: headers, deadlines, abort mapping. */
import { A2A_EXTENSIONS_HEADER, A2A_PROTOCOL_VERSION, A2A_VERSION_HEADER } from "./protocol.ts";
import { A2ATransportError } from "./errors.ts";

export type HeadersProvider = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

export interface HttpOptions {
  /** `fetch` implementation, resolved at call time when omitted. */
  fetch?: typeof fetch;
  /** Extra request headers (credentials, tracing); a function is awaited before every request. */
  headers?: HeadersProvider;
  /** Deadline of a unary exchange, or of the response headers of a stream. 0 disables. Default 120000. */
  timeoutMs?: number;
  /** Extension URIs sent in `A2A-Extensions`. */
  extensions?: readonly string[];
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Overrides the client deadline for this call. 0 disables. */
  timeoutMs?: number;
  /** Extra headers for this call only. */
  headers?: HeadersInit;
}

export const DEFAULT_TIMEOUT_MS = 120_000;

export interface RequestSpec {
  method: "GET" | "POST" | "DELETE";
  url: string;
  body?: string;
  contentType?: string;
  accept: string;
  /** Name used in error messages (JSON-RPC method). */
  operation: string;
  /** A stream keeps its body open after the headers: the deadline only covers the headers. */
  stream?: boolean;
}

/** One HTTP exchange with A2A service parameters, deadline and abort handling. */
export class HttpCore {
  constructor(private readonly options: HttpOptions) {}

  private async headers(extra: HeadersInit | undefined, spec: RequestSpec): Promise<Headers> {
    const headers = new Headers();
    const base = this.options.headers;
    const resolved = typeof base === "function" ? await base() : base;
    for (const source of [resolved, extra]) {
      if (source) new Headers(source).forEach((value, key) => headers.set(key, value));
    }
    headers.set(A2A_VERSION_HEADER, A2A_PROTOCOL_VERSION);
    const extensions = this.options.extensions;
    if (extensions && extensions.length > 0)
      headers.set(A2A_EXTENSIONS_HEADER, extensions.join(","));
    headers.set("accept", spec.accept);
    if (spec.contentType) headers.set("content-type", spec.contentType);
    return headers;
  }

  /** Unary exchange: the deadline covers the headers and the whole body. */
  async exchange(
    spec: RequestSpec,
    call: CallOptions = {},
  ): Promise<{ response: Response; text: string }> {
    return this.run(spec, call, false, async (response) => ({
      response,
      text: await response.text(),
    }));
  }

  /**
   * Streaming exchange: the deadline only covers the response headers. The caller owns the body and
   * must call `release()` once it is done, to detach the abort listener of its signal.
   */
  async open(
    spec: RequestSpec,
    call: CallOptions = {},
  ): Promise<{ response: Response; release: () => void }> {
    const detach: { run?: () => void } = {};
    const response = await this.run(spec, call, true, async (r) => r, detach);
    return { response, release: () => detach.run?.() };
  }

  private async run<T>(
    spec: RequestSpec,
    call: CallOptions,
    headersOnly: boolean,
    read: (response: Response) => Promise<T>,
    detach: { run?: () => void } = {},
  ): Promise<T> {
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    const headers = await this.headers(call.headers, spec);
    const timeoutMs = call.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : undefined;
    const onAbort = () => controller.abort();
    if (call.signal?.aborted) controller.abort();
    else call.signal?.addEventListener("abort", onAbort, { once: true });
    // A stream outlives this call: only an abort of the caller's signal may cut it later.
    const unlink = () => call.signal?.removeEventListener("abort", onAbort);
    detach.run = unlink;
    const settle = () => {
      if (timer) clearTimeout(timer);
      if (!headersOnly) unlink();
    };
    try {
      const response = await fetchImpl(spec.url, {
        method: spec.method,
        headers,
        body: spec.body,
        // A redirect must never carry credentials to another service implicitly.
        redirect: "error",
        signal: controller.signal,
      });
      if (headersOnly && timer) clearTimeout(timer);
      return await read(response);
    } catch (cause) {
      unlink();
      throw this.failure(cause, call.signal, timedOut, spec);
    } finally {
      settle();
    }
  }

  private failure(
    cause: unknown,
    signal: AbortSignal | undefined,
    timedOut: boolean,
    spec: RequestSpec,
  ): A2ATransportError {
    if (signal?.aborted) {
      return new A2ATransportError("aborted", `${spec.operation} aborted`, {
        method: spec.operation,
        cause,
      });
    }
    const name = cause instanceof Error ? cause.name : "";
    if (timedOut || name === "TimeoutError" || name === "AbortError") {
      return new A2ATransportError("timeout", `${spec.operation} timed out`, {
        method: spec.operation,
        cause,
      });
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    return new A2ATransportError("network", `${spec.operation} failed: ${reason}`, {
      method: spec.operation,
      cause,
    });
  }
}

/** Join an interface URL and a path without doubling or dropping slashes. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export function parseJsonLoose(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
