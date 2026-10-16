// SPDX-License-Identifier: Apache-2.0
/** Protocol bindings: one `Transport` per `AgentInterface.protocolBinding`. */
import type {
  A2AMethod,
  A2AMethodTypes,
  A2AStreamingMethod,
  StreamResponse,
} from "./generated/a2a.ts";
import {
  A2AError,
  A2ATransportError,
  a2aErrorFromRest,
  a2aErrorFromRpc,
  isRpcErrorShape,
} from "./errors.ts";
import { HttpCore, joinUrl, parseJsonLoose, type CallOptions, type HttpOptions } from "./http.ts";
import { A2A_JSON_MEDIA_TYPE, asStreamResponse, type SupportedBinding } from "./protocol.ts";
import { readSse } from "./sse.ts";

export type UnaryMethod = Exclude<A2AMethod, A2AStreamingMethod>;
export type MethodRequest<M extends A2AMethod> = A2AMethodTypes[M]["request"];
export type MethodResponse<M extends A2AMethod> = A2AMethodTypes[M]["response"];

/** One way of reaching an agent interface. Implementations are stateless between calls. */
export interface Transport {
  readonly binding: SupportedBinding;
  readonly url: string;
  call<M extends UnaryMethod>(
    method: M,
    params: MethodRequest<M>,
    options?: CallOptions,
  ): Promise<MethodResponse<M>>;
  stream<M extends A2AStreamingMethod>(
    method: M,
    params: MethodRequest<M>,
    options?: CallOptions,
  ): AsyncGenerator<StreamResponse>;
}

export interface TransportOptions extends HttpOptions {
  /** Interface URL from the Agent Card (or configured directly). */
  url: string;
}

function isEventStream(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
}

/**
 * Decode the events of an SSE response. A transport failure in the middle of the stream surfaces
 * as an {@link A2ATransportError}; A2A errors sent as events surface as {@link A2AError}.
 */
async function* decodeEvents(
  response: Response,
  release: () => void,
  decode: (data: string) => StreamResponse,
  operation: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<StreamResponse> {
  try {
    if (!response.body)
      throw new A2ATransportError("protocol", `${operation}: empty stream`, { method: operation });
    for await (const event of readSse(response.body)) yield decode(event.data);
  } catch (cause) {
    if (cause instanceof A2AError || cause instanceof A2ATransportError) throw cause;
    if (signal?.aborted) {
      throw new A2ATransportError("aborted", `${operation} aborted`, { method: operation, cause });
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new A2ATransportError("stream", `${operation} stream failed: ${reason}`, {
      method: operation,
      cause,
    });
  } finally {
    release();
    await response.body?.cancel().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 binding
// ---------------------------------------------------------------------------

interface RpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

/** JSON-RPC 2.0 over HTTP, PascalCase methods, SSE for streams (spec section 9). */
export class JsonRpcTransport implements Transport {
  readonly binding = "JSONRPC" as const;
  readonly url: string;
  private readonly core: HttpCore;
  private nextId = 1;

  constructor(options: TransportOptions) {
    this.url = options.url;
    this.core = new HttpCore(options);
  }

  private envelope(method: string, params: unknown): string {
    return JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params: params ?? {} });
  }

  async call<M extends UnaryMethod>(
    method: M,
    params: MethodRequest<M>,
    options: CallOptions = {},
  ): Promise<MethodResponse<M>> {
    const spec = {
      method: "POST" as const,
      url: this.url,
      body: this.envelope(method, params),
      contentType: "application/json",
      accept: "application/json",
      operation: method,
    };
    const { response, text } = await this.core.exchange(spec, options);
    const payload = parseJsonLoose(text) as RpcResponse | undefined;
    if (payload?.error !== undefined && isRpcErrorShape(payload.error)) {
      throw a2aErrorFromRpc(payload.error, method);
    }
    if (!response.ok) {
      throw new A2ATransportError("http", `${method}: HTTP ${response.status}`, {
        status: response.status,
        method,
      });
    }
    if (payload === undefined || typeof payload !== "object" || !("result" in payload)) {
      throw new A2ATransportError("protocol", `${method}: response is not a JSON-RPC result`, {
        status: response.status,
        method,
      });
    }
    // DeleteTaskPushNotificationConfig answers `null`: expose the empty message.
    return (payload.result ?? {}) as MethodResponse<M>;
  }

  async *stream<M extends A2AStreamingMethod>(
    method: M,
    params: MethodRequest<M>,
    options: CallOptions = {},
  ): AsyncGenerator<StreamResponse> {
    const spec = {
      method: "POST" as const,
      url: this.url,
      body: this.envelope(method, params),
      contentType: "application/json",
      accept: "text/event-stream, application/json",
      operation: method,
      stream: true,
    };
    const { response, release } = await this.core.open(spec, options);
    if (!isEventStream(response)) {
      try {
        const text = await response.text();
        const payload = parseJsonLoose(text) as RpcResponse | undefined;
        if (payload?.error !== undefined && isRpcErrorShape(payload.error)) {
          throw a2aErrorFromRpc(payload.error, method);
        }
        if (!response.ok || payload === undefined || !("result" in payload)) {
          throw new A2ATransportError(
            "http",
            `${method}: HTTP ${response.status}, no event stream`,
            {
              status: response.status,
              method,
            },
          );
        }
        yield decodeRpcResult(payload, method);
        return;
      } finally {
        release();
      }
    }
    yield* decodeEvents(
      response,
      release,
      (data) => decodeRpcEvent(data, method),
      method,
      options.signal,
    );
  }
}

function decodeRpcResult(payload: RpcResponse, method: string): StreamResponse {
  try {
    return asStreamResponse(payload.result);
  } catch (cause) {
    throw new A2ATransportError("protocol", `${method}: invalid stream event`, { method, cause });
  }
}

function decodeRpcEvent(data: string, method: string): StreamResponse {
  const payload = parseJsonLoose(data) as RpcResponse | undefined;
  if (payload === undefined || typeof payload !== "object") {
    throw new A2ATransportError("protocol", `${method}: malformed stream event`, { method });
  }
  if (payload.error !== undefined && isRpcErrorShape(payload.error)) {
    throw a2aErrorFromRpc(payload.error, method);
  }
  return decodeRpcResult(payload, method);
}

// ---------------------------------------------------------------------------
// HTTP+JSON (REST) binding
// ---------------------------------------------------------------------------

type Query = Record<string, string | number | boolean | undefined>;

function queryString(query: Query): string {
  const pairs = Object.entries(query).filter(([, v]) => v !== undefined && v !== "");
  if (pairs.length === 0) return "";
  return `?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}`;
}

interface RestCall {
  verb: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  query?: Query;
}

/** HTTP+JSON binding (spec section 11): resource URLs, ProtoJSON bodies, SSE for streams. */
export class RestTransport implements Transport {
  readonly binding = "HTTP+JSON" as const;
  readonly url: string;
  private readonly core: HttpCore;

  constructor(options: TransportOptions) {
    this.url = options.url;
    this.core = new HttpCore(options);
  }

  /** Route of one method. `tenant` moves from the body to the path prefix. */
  private route(method: A2AMethod, params: Record<string, unknown>): RestCall {
    const { tenant, ...rest } = params as { tenant?: string } & Record<string, unknown>;
    const prefix = tenant ? `/${encodeURIComponent(tenant)}` : "";
    const id = encodeURIComponent(String(rest.id ?? ""));
    const taskId = encodeURIComponent(String(rest.taskId ?? ""));
    switch (method) {
      case "SendMessage":
        return { verb: "POST", path: `${prefix}/message:send`, body: rest };
      case "SendStreamingMessage":
        return { verb: "POST", path: `${prefix}/message:stream`, body: rest };
      case "GetTask":
        return {
          verb: "GET",
          path: `${prefix}/tasks/${id}`,
          query: { historyLength: rest.historyLength as number | undefined },
        };
      case "ListTasks":
        return {
          verb: "GET",
          path: `${prefix}/tasks`,
          query: {
            contextId: rest.contextId as string | undefined,
            status: rest.status as string | undefined,
            pageSize: rest.pageSize as number | undefined,
            pageToken: rest.pageToken as string | undefined,
            historyLength: rest.historyLength as number | undefined,
            statusTimestampAfter: rest.statusTimestampAfter as string | undefined,
            includeArtifacts: rest.includeArtifacts as boolean | undefined,
          },
        };
      case "CancelTask": {
        const { id: _id, ...body } = rest;
        return { verb: "POST", path: `${prefix}/tasks/${id}:cancel`, body };
      }
      case "SubscribeToTask":
        return { verb: "POST", path: `${prefix}/tasks/${id}:subscribe` };
      case "CreateTaskPushNotificationConfig":
        return {
          verb: "POST",
          path: `${prefix}/tasks/${taskId}/pushNotificationConfigs`,
          body: rest,
        };
      case "GetTaskPushNotificationConfig":
        return { verb: "GET", path: `${prefix}/tasks/${taskId}/pushNotificationConfigs/${id}` };
      case "ListTaskPushNotificationConfigs":
        return {
          verb: "GET",
          path: `${prefix}/tasks/${taskId}/pushNotificationConfigs`,
          query: {
            pageSize: rest.pageSize as number | undefined,
            pageToken: rest.pageToken as string | undefined,
          },
        };
      case "DeleteTaskPushNotificationConfig":
        return { verb: "DELETE", path: `${prefix}/tasks/${taskId}/pushNotificationConfigs/${id}` };
      case "GetExtendedAgentCard":
        return { verb: "GET", path: `${prefix}/extendedAgentCard` };
    }
  }

  private spec(method: A2AMethod, params: unknown, stream: boolean) {
    const call = this.route(method, (params ?? {}) as Record<string, unknown>);
    const hasBody = call.body !== undefined;
    return {
      method: call.verb,
      url: joinUrl(this.url, call.path) + queryString(call.query ?? {}),
      ...(hasBody ? { body: JSON.stringify(call.body), contentType: A2A_JSON_MEDIA_TYPE } : {}),
      accept: stream
        ? "text/event-stream, application/a2a+json, application/json"
        : "application/a2a+json, application/json",
      operation: method,
      stream,
    };
  }

  private restFailure(
    response: Response,
    text: string,
    method: string,
  ): A2AError | A2ATransportError {
    const body = parseJsonLoose(text);
    if (typeof body === "object" && body !== null && "error" in body) {
      return a2aErrorFromRest(response.status, body, method);
    }
    return new A2ATransportError("http", `${method}: HTTP ${response.status}`, {
      status: response.status,
      method,
    });
  }

  async call<M extends UnaryMethod>(
    method: M,
    params: MethodRequest<M>,
    options: CallOptions = {},
  ): Promise<MethodResponse<M>> {
    const { response, text } = await this.core.exchange(this.spec(method, params, false), options);
    if (!response.ok) throw this.restFailure(response, text, method);
    const body = parseJsonLoose(text);
    if (body === undefined) {
      // DeleteTaskPushNotificationConfig answers an empty 200.
      if (method === "DeleteTaskPushNotificationConfig") return {} as MethodResponse<M>;
      throw new A2ATransportError("protocol", `${method}: empty or non-JSON body`, {
        status: response.status,
        method,
      });
    }
    return body as MethodResponse<M>;
  }

  async *stream<M extends A2AStreamingMethod>(
    method: M,
    params: MethodRequest<M>,
    options: CallOptions = {},
  ): AsyncGenerator<StreamResponse> {
    const { response, release } = await this.core.open(this.spec(method, params, true), options);
    if (!response.ok || !isEventStream(response)) {
      try {
        const text = await response.text();
        if (!response.ok) throw this.restFailure(response, text, method);
        const payload = parseJsonLoose(text);
        yield asStreamResponseFor(payload, method);
        return;
      } finally {
        release();
      }
    }
    yield* decodeEvents(
      response,
      release,
      (data) => decodeRestEvent(data, method),
      method,
      options.signal,
    );
  }
}

function asStreamResponseFor(payload: unknown, method: string): StreamResponse {
  try {
    return asStreamResponse(payload);
  } catch (cause) {
    throw new A2ATransportError("protocol", `${method}: invalid stream event`, { method, cause });
  }
}

function decodeRestEvent(data: string, method: string): StreamResponse {
  const payload = parseJsonLoose(data);
  if (typeof payload === "object" && payload !== null) {
    // A failure inside a stream is a `google.rpc.Status` envelope or a bare JSON-RPC error object.
    const nested = (payload as { error?: { code?: unknown } }).error;
    if (typeof nested === "object" && nested !== null) {
      throw a2aErrorFromRest(typeof nested.code === "number" ? nested.code : 500, payload, method);
    }
    if (isRpcErrorShape(payload)) throw a2aErrorFromRpc(payload, method);
  }
  return asStreamResponseFor(payload, method);
}
