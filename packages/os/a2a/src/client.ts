// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- pagination follows each page token in turn. */
/** `A2AClient`: typed A2A 1.0 operations over the JSON-RPC or HTTP+JSON binding. */
import type {
  AgentCapabilities,
  AgentCard,
  CancelTaskRequest,
  DeleteTaskPushNotificationConfigRequest,
  GetTaskPushNotificationConfigRequest,
  GetTaskRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  ListTasksRequest,
  ListTasksResponse,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  TaskPushNotificationConfig,
} from "./generated/a2a.ts";
import { AgentCardCache, fetchAgentCard, selectInterface, type SelectOptions } from "./card.ts";
import type { CallOptions, HttpOptions } from "./http.ts";
import { sendMessageRequest } from "./helpers.ts";
import type { SupportedBinding } from "./protocol.ts";
import { JsonRpcTransport, RestTransport, type Transport } from "./transport.ts";

/** A request without its `tenant`: the client fills it from the selected interface. */
export type Params<T> = Omit<T, "tenant">;

export interface A2AClientOptions extends HttpOptions {
  /** Interface URL (from the Agent Card, or known in advance). */
  url: string;
  /** Protocol binding of that URL. Default `JSONRPC`. */
  binding?: SupportedBinding;
  /** Tenant to send with every request (the `tenant` of the Agent Card interface). */
  tenant?: string;
  /** Card the client was built from, exposed as {@link A2AClient.card}. */
  card?: AgentCard;
}

export interface ConnectOptions
  extends HttpOptions, Pick<SelectOptions, "bindings" | "protocolVersion"> {
  /** Deadline of the card request. Default 30000. */
  discoveryTimeoutMs?: number;
  signal?: AbortSignal;
  /** Share a card cache between connects (HTTP caching, spec 8.6). */
  cache?: AgentCardCache;
}

export class A2AClient {
  /** The Agent Card this client was built from, when discovery was used. */
  readonly card: AgentCard | undefined;
  readonly tenant: string | undefined;
  private readonly transport: Transport;

  constructor(options: A2AClientOptions);
  /** Use a custom transport (tests, tunnels). */
  constructor(options: { transport: Transport; tenant?: string; card?: AgentCard });
  constructor(
    options: A2AClientOptions | { transport: Transport; tenant?: string; card?: AgentCard },
  ) {
    this.tenant = options.tenant;
    this.card = options.card;
    if ("transport" in options) {
      this.transport = options.transport;
    } else {
      const { binding = "JSONRPC", ...transportOptions } = options;
      this.transport =
        binding === "HTTP+JSON"
          ? new RestTransport(transportOptions)
          : new JsonRpcTransport(transportOptions);
    }
  }

  /** Discover the Agent Card of `baseUrl` and connect to its preferred interface. */
  static async connect(baseUrl: string, options: ConnectOptions = {}): Promise<A2AClient> {
    const { bindings, protocolVersion, discoveryTimeoutMs, signal, cache, ...http } = options;
    const card = await fetchAgentCard(baseUrl, {
      fetch: http.fetch,
      headers: http.headers,
      timeoutMs: discoveryTimeoutMs,
      signal,
      cache,
    });
    return A2AClient.fromCard(card, { ...http, bindings, protocolVersion });
  }

  /** Connect to the first interface of `card` this client can use. */
  static fromCard(card: AgentCard, options: HttpOptions & SelectOptions = {}): A2AClient {
    const { bindings, protocolVersion, ...http } = options;
    const { interface: selected, binding } = selectInterface(card, { bindings, protocolVersion });
    return new A2AClient({ ...http, url: selected.url, binding, tenant: selected.tenant, card });
  }

  get binding(): SupportedBinding {
    return this.transport.binding;
  }

  get url(): string {
    return this.transport.url;
  }

  /** Capabilities declared by the card; empty when the client was built without one. */
  get capabilities(): AgentCapabilities {
    return this.card?.capabilities ?? {};
  }

  private tenanted<T extends object>(params: T): T & { tenant?: string } {
    return this.tenant ? { ...params, tenant: this.tenant } : params;
  }

  /** Send a message. A string is wrapped in a user text message. Blocks until the task settles unless `returnImmediately`. */
  sendMessage(
    request: Params<SendMessageRequest> | string,
    options?: CallOptions,
  ): Promise<SendMessageResponse> {
    const body = typeof request === "string" ? sendMessageRequest(request) : request;
    return this.transport.call("SendMessage", this.tenanted(body), options);
  }

  /** Send a message and follow the task as events: first a task or a message, then updates. */
  sendStreamingMessage(
    request: Params<SendMessageRequest> | string,
    options?: CallOptions,
  ): AsyncGenerator<StreamResponse> {
    const body = typeof request === "string" ? sendMessageRequest(request) : request;
    return this.transport.stream("SendStreamingMessage", this.tenanted(body), options);
  }

  getTask(request: string | Params<GetTaskRequest>, options?: CallOptions): Promise<Task> {
    const body = typeof request === "string" ? { id: request } : request;
    return this.transport.call("GetTask", this.tenanted(body), options);
  }

  /** One page of tasks. Absent collections of the answer are normalised to empty values. */
  async listTasks(
    params: Params<ListTasksRequest> = {},
    options?: CallOptions,
  ): Promise<ListTasksResponse> {
    const page = await this.transport.call("ListTasks", this.tenanted(params), options);
    return {
      ...page,
      tasks: page.tasks ?? [],
      nextPageToken: page.nextPageToken ?? "",
      pageSize: page.pageSize ?? (page.tasks ?? []).length,
      totalSize: page.totalSize ?? (page.tasks ?? []).length,
    };
  }

  /** Every task matching `params`, following `nextPageToken` until the list ends. */
  async *listAllTasks(
    params: Params<ListTasksRequest> = {},
    options?: CallOptions,
  ): AsyncGenerator<Task> {
    let pageToken = params.pageToken;
    do {
      const page = await this.listTasks(
        { ...params, ...(pageToken ? { pageToken } : {}) },
        options,
      );
      yield* page.tasks;
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
  }

  cancelTask(request: string | Params<CancelTaskRequest>, options?: CallOptions): Promise<Task> {
    const body = typeof request === "string" ? { id: request } : request;
    return this.transport.call("CancelTask", this.tenanted(body), options);
  }

  /** Follow a task that is not in a terminal state; terminal tasks fail with `UNSUPPORTED_OPERATION`. */
  subscribeToTask(
    request: string | Params<SubscribeToTaskRequest>,
    options?: CallOptions,
  ): AsyncGenerator<StreamResponse> {
    const body = typeof request === "string" ? { id: request } : request;
    return this.transport.stream("SubscribeToTask", this.tenanted(body), options);
  }

  createPushNotificationConfig(
    config: Params<TaskPushNotificationConfig>,
    options?: CallOptions,
  ): Promise<TaskPushNotificationConfig> {
    return this.transport.call("CreateTaskPushNotificationConfig", this.tenanted(config), options);
  }

  getPushNotificationConfig(
    request: Params<GetTaskPushNotificationConfigRequest>,
    options?: CallOptions,
  ): Promise<TaskPushNotificationConfig> {
    return this.transport.call("GetTaskPushNotificationConfig", this.tenanted(request), options);
  }

  async listPushNotificationConfigs(
    request: string | Params<ListTaskPushNotificationConfigsRequest>,
    options?: CallOptions,
  ): Promise<ListTaskPushNotificationConfigsResponse> {
    const body = typeof request === "string" ? { taskId: request } : request;
    const page = await this.transport.call(
      "ListTaskPushNotificationConfigs",
      this.tenanted(body),
      options,
    );
    return { ...page, configs: page.configs ?? [], nextPageToken: page.nextPageToken ?? "" };
  }

  async deletePushNotificationConfig(
    request: Params<DeleteTaskPushNotificationConfigRequest>,
    options?: CallOptions,
  ): Promise<void> {
    await this.transport.call("DeleteTaskPushNotificationConfig", this.tenanted(request), options);
  }

  /** The authenticated, richer card (`capabilities.extendedAgentCard`). */
  getExtendedAgentCard(options?: CallOptions): Promise<AgentCard> {
    return this.transport.call("GetExtendedAgentCard", this.tenanted({}), options);
  }
}
