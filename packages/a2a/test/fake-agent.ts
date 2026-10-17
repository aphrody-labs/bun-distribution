// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- the fake agent streams events one after the other. */
/**
 * In-process A2A 1.0 agent for the client tests: Agent Card, JSON-RPC and HTTP+JSON bindings, SSE,
 * push configs. It speaks ProtoJSON like the Rust server and records every request it receives.
 */
import type {
  AgentCard,
  JsonValue,
  Message,
  Part,
  SendMessageRequest,
  StreamResponse,
  Task,
  TaskPushNotificationConfig,
  TaskState,
} from "../src/index.ts";
import { A2A_ERROR_CODES, TERMINAL_TASK_STATES, type A2AErrorReason } from "../src/index.ts";

export interface Recorded {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

export interface FakeAgentOptions {
  /** Require `Authorization: Bearer <token>` on every non-card request. */
  bearer?: string;
  /** Tenant announced in both interfaces of the card. */
  tenant?: string;
  /** Serve a pre-1.0 card (single `url`, protocolVersion 0.3). */
  legacyCard?: boolean;
  /** Pause between stream events, in milliseconds. */
  streamDelayMs?: number;
}

class FakeFailure extends Error {
  constructor(
    readonly reason: A2AErrorReason,
    message: string,
    readonly metadata: Record<string, string> = {},
  ) {
    super(message);
  }
}

const HTTP_STATUS: Partial<Record<A2AErrorReason, number>> = {
  TASK_NOT_FOUND: 404,
  METHOD_NOT_FOUND: 501,
  INTERNAL_ERROR: 500,
  INVALID_AGENT_RESPONSE: 500,
};

function errorDetails(failure: FakeFailure) {
  return [
    {
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: failure.reason,
      domain: "a2a-protocol.org",
      metadata: { ...failure.metadata, timestamp: "2026-10-06T10:00:00.000Z" },
    },
  ];
}

function textOf(message: Message): string {
  return message.parts.map((p: Part) => p.text ?? "").join("\n");
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class FakeAgent {
  readonly requests: Recorded[] = [];
  readonly tasks = new Map<string, Task>();
  readonly pushConfigs = new Map<string, TaskPushNotificationConfig[]>();
  cardFetches = 0;
  conditionalCardFetches = 0;
  private counter = 0;
  private server: ReturnType<typeof Bun.serve>;

  constructor(private readonly options: FakeAgentOptions = {}) {
    this.server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 30,
      fetch: req => this.route(req),
    });
  }

  get url(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  stop(): void {
    this.server.stop(true);
  }

  card(): AgentCard {
    const tenant = this.options.tenant ? { tenant: this.options.tenant } : {};
    return {
      name: "Fake Agent",
      description: "Test agent",
      version: "1.2.3",
      supportedInterfaces: [
        {
          url: `${this.url}/rpc`,
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
          ...tenant,
        },
        {
          url: `${this.url}/rest`,
          protocolBinding: "HTTP+JSON",
          protocolVersion: "1.0",
          ...tenant,
        },
      ],
      capabilities: {
        streaming: true,
        pushNotifications: true,
        extendedAgentCard: true,
      },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: "echo",
          name: "Echo",
          description: "Repeats the text",
          tags: ["echo"],
        },
      ],
    };
  }

  // ---- HTTP plumbing -------------------------------------------------------

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const text = req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    this.requests.push({
      method: req.method,
      path: url.pathname + url.search,
      headers: req.headers,
      body,
    });

    if (url.pathname === "/.well-known/agent-card.json") return this.serveCard(req);
    if (this.options.bearer && req.headers.get("authorization") !== `Bearer ${this.options.bearer}`) {
      return new Response("unauthorized", { status: 401 });
    }
    if (url.pathname === "/rpc" && req.method === "POST") return this.rpc(req, body);
    if (url.pathname.startsWith("/rest")) return this.rest(req, url, body);
    return new Response("not found", { status: 404 });
  }

  private serveCard(req: Request): Response {
    this.cardFetches++;
    const etag = '"card-v1"';
    if (req.headers.get("if-none-match")) this.conditionalCardFetches++;
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": "max-age=0" },
      });
    }
    const card = this.options.legacyCard
      ? {
          name: "Legacy Agent",
          description: "pre-1.0",
          version: "0.9.0",
          url: `${this.url}/rpc`,
          protocolVersion: "0.3.0",
          preferredTransport: "JSONRPC",
          supportsAuthenticatedExtendedCard: true,
          capabilities: { streaming: true },
          skills: [],
        }
      : this.card();
    return Response.json(card, {
      headers: { etag, "cache-control": "max-age=0" },
    });
  }

  // ---- JSON-RPC ------------------------------------------------------------

  private rpcError(id: unknown, failure: FakeFailure): Response {
    return Response.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: A2A_ERROR_CODES[failure.reason],
        message: failure.message,
        data: errorDetails(failure),
      },
    });
  }

  private versionOk(req: Request): boolean {
    return req.headers.get("a2a-version") === "1.0";
  }

  private async rpc(req: Request, body: unknown): Promise<Response> {
    const { id, method, params } = (body ?? {}) as {
      id?: unknown;
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      if (!this.versionOk(req)) {
        throw new FakeFailure("VERSION_NOT_SUPPORTED", "version not supported", {
          requested: req.headers.get("a2a-version") ?? "",
        });
      }
      if (method === "SendStreamingMessage" || method === "SubscribeToTask") {
        const events =
          method === "SendStreamingMessage"
            ? this.streamSend(params as unknown as SendMessageRequest)
            : this.streamSubscribe(String(params?.id));
        // Resolve the first event before choosing the response form: a failure becomes a JSON error.
        const iterator = events[Symbol.asyncIterator]();
        const first = await iterator.next();
        return this.sse(
          (async function* () {
            if (!first.done) yield first.value;
            for (;;) {
              const next = await iterator.next();
              if (next.done) return;
              yield next.value;
            }
          })(),
          event => ({ jsonrpc: "2.0", id, result: event }),
          failure => ({
            jsonrpc: "2.0",
            id,
            error: {
              code: A2A_ERROR_CODES[failure.reason],
              message: failure.message,
              data: errorDetails(failure),
            },
          }),
        );
      }
      const result = await this.unary(method ?? "", params ?? {});
      return Response.json({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (cause) {
      if (cause instanceof FakeFailure) return this.rpcError(id, cause);
      throw cause;
    }
  }

  // ---- REST ----------------------------------------------------------------

  private restError(failure: FakeFailure): Response {
    const status = HTTP_STATUS[failure.reason] ?? 400;
    return Response.json(
      {
        error: {
          code: status,
          status: "FAILED",
          message: failure.message,
          details: errorDetails(failure),
        },
      },
      { status },
    );
  }

  private async rest(req: Request, url: URL, body: unknown): Promise<Response> {
    try {
      if (!this.versionOk(req)) throw new FakeFailure("VERSION_NOT_SUPPORTED", "version not supported");
      let path = url.pathname.slice("/rest".length);
      let tenant: string | undefined;
      if (this.options.tenant && path.startsWith(`/${this.options.tenant}/`)) {
        tenant = this.options.tenant;
        path = path.slice(this.options.tenant.length + 1);
      }
      const q = url.searchParams;
      const send = body as SendMessageRequest;
      let match: RegExpMatchArray | null;
      if (req.method === "POST" && path === "/message:send")
        return Response.json(await this.unary("SendMessage", send));
      if (req.method === "POST" && path === "/message:stream") {
        return await this.restStream(this.streamSend(send));
      }
      if (req.method === "GET" && path === "/tasks") {
        return Response.json(
          await this.unary("ListTasks", {
            contextId: q.get("contextId") ?? undefined,
            status: q.get("status") ?? undefined,
            pageSize: q.has("pageSize") ? Number(q.get("pageSize")) : undefined,
            pageToken: q.get("pageToken") ?? undefined,
          }),
        );
      }
      if ((match = path.match(/^\/tasks\/([^/]+):cancel$/)) && req.method === "POST") {
        return Response.json(
          await this.unary("CancelTask", {
            id: decodeURIComponent(match[1] as string),
          }),
        );
      }
      if ((match = path.match(/^\/tasks\/([^/]+):subscribe$/)) && req.method === "POST") {
        return await this.restStream(this.streamSubscribe(decodeURIComponent(match[1] as string)));
      }
      if ((match = path.match(/^\/tasks\/([^/]+)\/pushNotificationConfigs\/([^/]+)$/))) {
        const params = {
          taskId: decodeURIComponent(match[1] as string),
          id: decodeURIComponent(match[2] as string),
        };
        if (req.method === "GET") return Response.json(await this.unary("GetTaskPushNotificationConfig", params));
        if (req.method === "DELETE") {
          await this.unary("DeleteTaskPushNotificationConfig", params);
          return new Response(null, { status: 200 });
        }
      }
      if ((match = path.match(/^\/tasks\/([^/]+)\/pushNotificationConfigs$/))) {
        const taskId = decodeURIComponent(match[1] as string);
        if (req.method === "POST") {
          return Response.json(
            await this.unary("CreateTaskPushNotificationConfig", {
              ...(body as object),
              taskId,
            }),
          );
        }
        if (req.method === "GET") return Response.json(await this.unary("ListTaskPushNotificationConfigs", { taskId }));
      }
      if ((match = path.match(/^\/tasks\/([^/:]+)$/)) && req.method === "GET") {
        return Response.json(
          await this.unary("GetTask", {
            id: decodeURIComponent(match[1] as string),
            historyLength: q.has("historyLength") ? Number(q.get("historyLength")) : undefined,
          }),
        );
      }
      if (req.method === "GET" && path === "/extendedAgentCard") {
        return Response.json(await this.unary("GetExtendedAgentCard", { tenant }));
      }
      return new Response("not found", { status: 404 });
    } catch (cause) {
      if (cause instanceof FakeFailure) return this.restError(cause);
      throw cause;
    }
  }

  private async restStream(events: AsyncIterable<StreamResponse>): Promise<Response> {
    const iterator = events[Symbol.asyncIterator]();
    const first = await iterator.next();
    const rest = async function* () {
      if (!first.done) yield first.value;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    };
    return this.sse(
      rest(),
      event => event,
      failure => ({
        error: {
          code: HTTP_STATUS[failure.reason] ?? 400,
          message: failure.message,
          details: errorDetails(failure),
        },
      }),
    );
  }

  private sse(
    events: AsyncIterable<StreamResponse>,
    wrap: (event: StreamResponse) => unknown,
    wrapError: (failure: FakeFailure) => unknown,
  ): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of events)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(wrap(event))}\n\n`));
        } catch (cause) {
          if (cause instanceof FakeFailure)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(wrapError(cause))}\n\n`));
          else throw cause;
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  }

  // ---- Agent behaviour -----------------------------------------------------

  private nextId(prefix: string): string {
    return `${prefix}-${++this.counter}`;
  }

  private newTask(message: Message, state: TaskState, answer?: string, metadata?: Record<string, JsonValue>): Task {
    const id = message.taskId ?? this.nextId("task");
    const task: Task = {
      id,
      contextId: message.contextId ?? this.nextId("ctx"),
      status: { state, timestamp: "2026-10-06T10:00:00.000Z" },
      history: [message],
      ...(metadata ? { metadata } : {}),
      ...(answer === undefined
        ? {}
        : {
            artifacts: [
              {
                artifactId: this.nextId("art"),
                name: "answer",
                parts: [{ text: answer, mediaType: "text/plain" }],
              },
            ],
          }),
    };
    this.tasks.set(id, task);
    return task;
  }

  private checkMessage(request: SendMessageRequest): {
    message: Message;
    text: string;
  } {
    const message = request?.message;
    if (!message || !Array.isArray(message.parts) || message.parts.length === 0) {
      throw new FakeFailure("INVALID_PARAMS", "message.parts must not be empty");
    }
    const text = textOf(message);
    const fail = /^fail:(\w+)$/.exec(text);
    if (fail) throw new FakeFailure(fail[1] as A2AErrorReason, `forced ${fail[1]}`);
    if (message.taskId) {
      const existing = this.tasks.get(message.taskId);
      if (!existing)
        throw new FakeFailure("TASK_NOT_FOUND", `task not found: ${message.taskId}`, {
          taskId: message.taskId,
        });
      if (TERMINAL_TASK_STATES.includes(existing.status.state)) {
        throw new FakeFailure("UNSUPPORTED_OPERATION", "task is in a terminal state");
      }
    }
    return { message, text };
  }

  private async unary(method: string, input: object): Promise<unknown> {
    const params = input as Record<string, unknown>;
    switch (method) {
      case "SendMessage": {
        const { message, text } = this.checkMessage(params as unknown as SendMessageRequest);
        if (text === "message") {
          return {
            message: {
              messageId: this.nextId("msg"),
              role: "ROLE_AGENT",
              parts: [{ text: "direct reply" }],
            },
          };
        }
        const requestMetadata = (params as unknown as SendMessageRequest).metadata;
        const returnImmediately = (params as unknown as SendMessageRequest).configuration?.returnImmediately;
        if (returnImmediately)
          return {
            task: this.newTask(message, "TASK_STATE_WORKING", undefined, requestMetadata),
          };
        return {
          task: this.newTask(message, "TASK_STATE_COMPLETED", `echo: ${text}`, requestMetadata),
        };
      }
      case "GetTask": {
        const task = this.tasks.get(String(params.id));
        if (!task)
          throw new FakeFailure("TASK_NOT_FOUND", `task not found: ${params.id}`, {
            taskId: String(params.id),
          });
        const length = params.historyLength;
        if (typeof length !== "number") return task;
        const { history, ...rest } = task;
        return length === 0 ? rest : { ...rest, history: (history ?? []).slice(-length) };
      }
      case "ListTasks": {
        let tasks = [...this.tasks.values()];
        if (params.contextId) tasks = tasks.filter(t => t.contextId === params.contextId);
        if (params.status) tasks = tasks.filter(t => t.status.state === params.status);
        const pageSize = typeof params.pageSize === "number" ? params.pageSize : 50;
        const offset = params.pageToken ? Number(params.pageToken) : 0;
        const page = tasks.slice(offset, offset + pageSize);
        const next = offset + pageSize < tasks.length ? String(offset + pageSize) : "";
        // Like ProtoJSON, omit empty collections and default scalars.
        return {
          ...(page.length > 0 ? { tasks: page } : {}),
          ...(next ? { nextPageToken: next } : {}),
          pageSize,
          totalSize: tasks.length,
        };
      }
      case "CancelTask": {
        const task = this.tasks.get(String(params.id));
        if (!task)
          throw new FakeFailure("TASK_NOT_FOUND", `task not found: ${params.id}`, {
            taskId: String(params.id),
          });
        if (TERMINAL_TASK_STATES.includes(task.status.state)) {
          throw new FakeFailure("TASK_NOT_CANCELABLE", `task cannot be canceled: ${task.id}`, {
            taskId: task.id,
          });
        }
        task.status = { state: "TASK_STATE_CANCELED" };
        return task;
      }
      case "CreateTaskPushNotificationConfig": {
        const config = params as unknown as TaskPushNotificationConfig;
        if (!config.url) throw new FakeFailure("INVALID_PARAMS", "url is required");
        const stored = { ...config, id: config.id ?? this.nextId("cfg") };
        const list = this.pushConfigs.get(String(config.taskId)) ?? [];
        this.pushConfigs.set(String(config.taskId), [...list, stored]);
        return stored;
      }
      case "GetTaskPushNotificationConfig": {
        const found = this.pushConfigs.get(String(params.taskId))?.find(c => c.id === params.id);
        if (!found)
          throw new FakeFailure("TASK_NOT_FOUND", "push config not found", {
            taskId: String(params.taskId),
          });
        return found;
      }
      case "ListTaskPushNotificationConfigs": {
        const configs = this.pushConfigs.get(String(params.taskId)) ?? [];
        return configs.length > 0 ? { configs } : {};
      }
      case "DeleteTaskPushNotificationConfig": {
        const list = this.pushConfigs.get(String(params.taskId)) ?? [];
        this.pushConfigs.set(
          String(params.taskId),
          list.filter(c => c.id !== params.id),
        );
        return null;
      }
      case "GetExtendedAgentCard":
        return { ...this.card(), description: "extended" };
      default:
        throw new FakeFailure("METHOD_NOT_FOUND", `method not found: ${method}`);
    }
  }

  private async *streamSend(request: SendMessageRequest): AsyncGenerator<StreamResponse> {
    const { message, text } = this.checkMessage(request);
    if (text === "message") {
      yield {
        message: {
          messageId: this.nextId("msg"),
          role: "ROLE_AGENT",
          parts: [{ text: "direct reply" }],
        },
      };
      return;
    }
    const delay = this.options.streamDelayMs ?? 0;
    const task = this.newTask(message, "TASK_STATE_SUBMITTED", undefined, request.metadata);
    yield { task: { ...task } };
    await sleep(delay);
    yield {
      statusUpdate: {
        taskId: task.id,
        contextId: task.contextId ?? "",
        status: { state: "TASK_STATE_WORKING" },
      },
    };
    await sleep(delay);
    const artifactId = this.nextId("art");
    yield {
      artifactUpdate: {
        taskId: task.id,
        contextId: task.contextId ?? "",
        artifact: { artifactId, name: "answer", parts: [{ text: "echo: " }] },
      },
    };
    if (text === "error-mid") throw new FakeFailure("INTERNAL_ERROR", "agent crashed");
    await sleep(delay);
    yield {
      artifactUpdate: {
        taskId: task.id,
        contextId: task.contextId ?? "",
        artifact: { artifactId, parts: [{ text }] },
        append: true,
        lastChunk: true,
      },
    };
    const done: Task = {
      ...task,
      status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [{ artifactId, name: "answer", parts: [{ text: "echo: " }, { text }] }],
    };
    this.tasks.set(task.id, done);
    yield {
      statusUpdate: {
        taskId: task.id,
        contextId: task.contextId ?? "",
        status: { state: "TASK_STATE_COMPLETED" },
      },
    };
  }

  private async *streamSubscribe(id: string): AsyncGenerator<StreamResponse> {
    const task = this.tasks.get(id);
    if (!task)
      throw new FakeFailure("TASK_NOT_FOUND", `task not found: ${id}`, {
        taskId: id,
      });
    if (TERMINAL_TASK_STATES.includes(task.status.state)) {
      throw new FakeFailure("UNSUPPORTED_OPERATION", "task is already in a terminal state", {
        taskId: id,
      });
    }
    yield { task: { ...task } };
    await sleep(this.options.streamDelayMs ?? 0);
    task.status = { state: "TASK_STATE_COMPLETED" };
    yield {
      statusUpdate: {
        taskId: id,
        contextId: task.contextId ?? "",
        status: { state: "TASK_STATE_COMPLETED" },
      },
    };
  }
}

export function startFakeAgent(options: FakeAgentOptions = {}): FakeAgent {
  return new FakeAgent(options);
}
