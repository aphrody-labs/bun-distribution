// SPDX-License-Identifier: Apache-2.0
/** Bounded Bun HTTP transport for the existing native OpenAI-compatible model servers. */
export interface InferenceTransportOptions {
  readonly apiKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxResponseBytes?: number | undefined;
}

export class InferenceError extends Error {
  override readonly name = "InferenceError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function lease(options: InferenceTransportOptions) {
  const timeout = options.timeoutMs ?? 30_000;
  const limit = options.maxResponseBytes ?? 1_048_576;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647)
    throw new InferenceError("timeoutMs must be an integer between 1 and 2147483647");
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new InferenceError("maxResponseBytes must be a positive safe integer");
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const timer = setTimeout(
    () => controller.abort(new DOMException("Inference timed out", "TimeoutError")),
    timeout,
  );
  return { signal, limit, dispose: () => clearTimeout(timer) };
}

async function post(
  endpoint: string,
  body: unknown,
  options: InferenceTransportOptions,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new InferenceError(
      `Inference provider returned HTTP ${response.status}`,
      response.status,
    );
  }
  if (!response.body) throw new InferenceError("Inference provider returned no response body");
  return response;
}

export async function postInferenceJson(
  endpoint: string,
  body: unknown,
  options: InferenceTransportOptions,
): Promise<unknown> {
  const active = lease(options);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await post(endpoint, body, options, active.signal);
    reader = response.body!.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle d'un flux HTTP : chaque segment doit être borné et décodé dans l'ordre
      const chunk = await reader.read();
      active.signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > active.limit)
        throw new InferenceError("Inference response exceeds maxResponseBytes");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new InferenceError("Inference provider returned invalid JSON");
    }
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    active.dispose();
  }
}

/** Yield SSE data records as received, including the provider's terminal [DONE] record. */
export async function* postInferenceEvents(
  endpoint: string,
  body: unknown,
  options: InferenceTransportOptions,
): AsyncGenerator<string> {
  const active = lease(options);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await post(endpoint, body, options, active.signal);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
      await response.body?.cancel();
      throw new InferenceError("Inference streaming requires text/event-stream");
    }
    reader = response.body!.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "";
    let data: string[] = [];
    let eventBytes = 0;
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle d'un flux SSE : les événements doivent être émis dans l'ordre d'arrivée
      const chunk = await reader.read();
      active.signal.throwIfAborted();
      pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      while (true) {
        const separator = /\r\n|\r|\n/.exec(pending);
        if (!separator) break;
        if (!chunk.done && separator[0] === "\r" && separator.index === pending.length - 1) break;
        const line = pending.slice(0, separator.index);
        if (eventBytes + Buffer.byteLength(line) > active.limit)
          throw new InferenceError("Inference stream event exceeds maxResponseBytes");
        pending = pending.slice(separator.index + separator[0].length);
        if (line === "") {
          if (data.length > 0) yield data.join("\n");
          data = [];
          eventBytes = 0;
        } else if (line.startsWith("data:")) {
          const value = line.slice(5).replace(/^ /, "");
          eventBytes += Buffer.byteLength(value) + (data.length ? 1 : 0);
          if (eventBytes > active.limit)
            throw new InferenceError("Inference stream event exceeds maxResponseBytes");
          data.push(value);
        }
      }
      if (eventBytes + Buffer.byteLength(pending) > active.limit)
        throw new InferenceError("Inference stream event exceeds maxResponseBytes");
      if (chunk.done) {
        if (pending.startsWith("data:")) data.push(pending.slice(5).replace(/^ /, ""));
        if (data.length > 0) yield data.join("\n");
        break;
      }
    }
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    active.dispose();
  }
}
