// SPDX-License-Identifier: Apache-2.0
/** Portable HTTP/JSON transport. Domain schemas, credentials and policy belong to callers. */
export interface JsonRequestOptions {
  timeoutMs: number;
  fetch?: typeof fetch;
  /** Read a domain error envelope. By default error bodies are discarded. */
  readErrorBody?: boolean;
  /** Successful absence (e.g. a missing RAG document). The body is cancelled. */
  emptyStatus?: number;
}
export class JsonTransportError extends Error {
  constructor(
    readonly stage: "request" | "body" | "json",
    readonly timedOut: boolean,
    cause: unknown,
  ) {
    super(`HTTP JSON ${stage} failed`, { cause });
    this.name = "JsonTransportError";
  }
}
export interface JsonResponse {
  response: Response;
  value: unknown;
}

/**
 * One fetch and one body read, with a deadline covering both. Resolve global fetch at call time.
 * Redirects are refused so credentials cannot cross a service boundary implicitly.
 * This transport never retries a request or formats its URL, body or credentials into an error.
 */
export async function requestJson(
  url: URL | string,
  init: RequestInit,
  options: JsonRequestOptions,
): Promise<JsonResponse> {
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const signal = init.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
  const failure = (stage: JsonTransportError["stage"], cause: unknown) =>
    new JsonTransportError(
      stage,
      deadline.aborted || (cause instanceof Error && cause.name === "TimeoutError"),
      cause,
    );
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      ...init,
      redirect: "error",
      signal,
    });
  } catch (cause) {
    throw failure("request", cause);
  }
  if (response.status === options.emptyStatus || (!response.ok && !options.readErrorBody)) {
    await response.body?.cancel().catch(() => undefined);
    return { response, value: undefined };
  }
  let body: string;
  try {
    body = await response.text();
  } catch (cause) {
    throw failure("body", cause);
  }
  try {
    return { response, value: JSON.parse(body) as unknown };
  } catch (cause) {
    // An HTTP failure retains its status even if the optional error body is not JSON.
    if (!response.ok) return { response, value: undefined };
    throw failure("json", cause);
  }
}

/** Seconds from Retry-After, accepting delta seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const date = Date.parse(text);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}
