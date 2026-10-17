// SPDX-License-Identifier: Apache-2.0
/**
 * Bun client for the Aphrody OS kernel.
 *
 * A Bun process joins the OS as a subsystem with {@link registerSubsystem}: its tools are
 * published to every agent next to the native ones and the kernel routes their calls back
 * here. {@link KernelClient} also calls any OS tool or skill directly.
 *
 * Wire format: newline-delimited JSON-RPC 2.0 over the per-user local endpoint (Unix socket or
 * Windows named pipe), the same one `aphrody kernel` and the desktop serve.
 */
import { connect, type Socket } from "node:net";
import { join } from "node:path";

const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

/** The per-user endpoint, identical to `aphrody_kernel::transport::default_endpoint`. */
export function defaultEndpoint(): string {
  const override = process.env.APHRODY_OS_SOCKET;
  if (override) return override;
  const user = (process.env.USERNAME ?? process.env.USER ?? "user").replace(/[^A-Za-z0-9_-]/g, "");
  if (process.platform === "win32") return `\\\\.\\pipe\\aphrody-os-${user}`;
  const runtime = process.env.XDG_RUNTIME_DIR;
  return runtime ? join(runtime, "aphrody-os.sock") : `/tmp/aphrody-os-${user}.sock`;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Message {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
  result?: Json;
  error?: { code: number; message: string };
}
export class KernelError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

/** A JSON-RPC connection to the kernel. */
export class KernelClient {
  #socket: Socket;
  #buffer = "";
  #bufferBytes = 0;
  #nextId = 1;
  #pending = new Map<string, { resolve: (m: Message) => void; reject: (e: Error) => void }>();
  #onRequest?: (message: Message) => Promise<Json>;
  #onNotification?: (message: Message) => void;
  readonly closed: Promise<void>;

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.#receive(chunk));
    socket.on("error", (error: Error) => {
      for (const { reject } of this.#pending.values()) reject(error);
      this.#pending.clear();
    });
    this.closed = new Promise(resolve => {
      socket.on("close", () => {
        for (const { reject } of this.#pending.values()) reject(new Error("kernel connection closed"));
        this.#pending.clear();
        resolve();
      });
    });
  }

  /** Connect and perform the MCP handshake. */
  static async connect(
    endpoint = defaultEndpoint(),
    clientName = "aphrody-os-bun",
    timeoutMs = 30_000,
  ): Promise<KernelClient> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("connect timeout must be positive");
    const socket = await new Promise<Socket>((resolve, reject) => {
      const s = connect(endpoint);
      const timer = setTimeout(() => s.destroy(new Error("kernel connection timed out")), timeoutMs);
      s.once("connect", () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once("error", error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const client = new KernelClient(socket);
    const initialize: { [key: string]: Json } = {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: clientName, version: "1.0.0" },
    };
    const authToken = process.env.APHRODY_OS_AUTH_TOKEN;
    if (authToken) initialize.authToken = authToken;
    try {
      await client.request("initialize", initialize, timeoutMs);
      client.notify("notifications/initialized", {});
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  #send(message: Message): void {
    this.#socket.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  #receive(chunk: string): void {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf("\n", offset);
      const end = newline < 0 ? chunk.length : newline + 1;
      const part = chunk.slice(offset, end);
      this.#bufferBytes += Buffer.byteLength(part, "utf8");
      if (this.#bufferBytes > MAX_MESSAGE_BYTES) {
        this.#socket.destroy(new Error("kernel message too large"));
        return;
      }
      this.#buffer += part;
      offset = end;
      if (newline < 0) continue;
      const line = this.#buffer.trim();
      this.#buffer = "";
      this.#bufferBytes = 0;
      if (!line) continue;
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        continue;
      }
      if (message.method === undefined && message.id !== undefined) {
        const waiter = this.#pending.get(String(message.id));
        this.#pending.delete(String(message.id));
        if (!waiter) continue;
        if (message.error) waiter.reject(new KernelError(message.error.message, message.error.code));
        else waiter.resolve(message);
      } else if (message.method !== undefined && message.id !== undefined && message.id !== null) {
        const id = message.id;
        const handle =
          this.#onRequest ??
          (async () => ({
            content: [{ type: "text", text: "no handler" }],
            isError: true,
          }));
        void handle(message).then(
          result => this.#send({ id, result }),
          (error: unknown) => this.#send({ id, error: { code: -32603, message: String(error) } }),
        );
      } else if (message.method !== undefined) {
        this.#onNotification?.(message);
      }
    }
  }

  /** Send a request; resolves with its `result`. */
  request(method: string, params: Json = {}, timeoutMs = 0): Promise<Json> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
      return Promise.reject(new Error("request timeout must be nonnegative"));
    if (this.#socket.destroyed) return Promise.reject(new Error("kernel connection closed"));
    const id = String(this.#nextId++);
    let timer: ReturnType<typeof setTimeout> | undefined;
    return new Promise<Message>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      if (timeoutMs > 0)
        timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(new Error(`kernel ${method} timed out`));
        }, timeoutMs);
      this.#send({ id, method, params });
    })
      .then(message => message.result ?? null)
      .finally(() => clearTimeout(timer));
  }

  notify(method: string, params: Json = {}): void {
    this.#send({ method, params });
  }

  /** Call an OS tool; resolves with its structured value, rejects when the tool failed. */
  async call(tool: string, args: Record<string, Json> = {}, timeoutMs = 0): Promise<Json> {
    const result = (await this.request("tools/call", { name: tool, arguments: args }, timeoutMs)) as Record<
      string,
      Json
    >;
    const text = ((result.content as Array<Record<string, Json>>) ?? []).map(part => part.text ?? "").join("\n");
    if (result.isError) throw new KernelError(text, -32000);
    const structured = result.structuredContent as Record<string, Json> | undefined;
    if (structured)
      return Object.keys(structured).length === 1 && "result" in structured ? structured.result : structured;
    return text;
  }

  onRequest(handler: (message: Message) => Promise<Json>): void {
    this.#onRequest = handler;
  }

  onNotification(handler: (message: Message) => void): void {
    this.#onNotification = handler;
  }

  close(): void {
    this.#socket.destroy();
  }
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema?: Json;
  readOnly?: boolean;
  handler: (args: Record<string, Json>) => unknown | Promise<unknown>;
}

export interface SubsystemSpec {
  name: string;
  description?: string;
  tools: ToolSpec[];
  skills?: Json[];
}

function toCallResult(value: unknown): Json {
  const json = (value ?? null) as Json;
  const text = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  const structured = json !== null && typeof json === "object" && !Array.isArray(json) ? json : { result: json };
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
    isError: false,
  };
}

/**
 * Join the kernel as a subsystem. The returned client stays connected; closing it (or the
 * process exiting) unregisters the subsystem.
 */
export async function registerSubsystem(spec: SubsystemSpec, endpoint = defaultEndpoint()): Promise<KernelClient> {
  const client = await KernelClient.connect(endpoint, `bun/${spec.name}`);
  const handlers = new Map(spec.tools.map(tool => [tool.name, tool.handler]));
  client.onRequest(async message => {
    if (message.method === "ping") return {};
    if (message.method !== "tools/call")
      return {
        content: [{ type: "text", text: `unsupported: ${message.method}` }],
        isError: true,
      };
    const params = (message.params ?? {}) as Record<string, Json>;
    const handler = handlers.get(String(params.name));
    if (!handler)
      return {
        content: [{ type: "text", text: `unknown tool: ${params.name}` }],
        isError: true,
      };
    try {
      return toCallResult(await handler((params.arguments ?? {}) as Record<string, Json>));
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  });
  await client.request("system/register_subsystem", {
    name: spec.name,
    description: spec.description ?? `Bun subsystem ${spec.name}.`,
    runtime: "bun",
    tools: spec.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: "object" },
      annotations: { readOnlyHint: tool.readOnly ?? false },
    })),
    skills: spec.skills ?? [],
  });
  return client;
}

export * as systemd from "./systemd.ts";
export {
  formatJournal,
  getWatchdogUsec,
  journal,
  notifyReady,
  notifyStatus,
  notifyStopping,
  notifyWatchdog,
  sdNotify,
  startWatchdogLoop,
  SyslogPriority,
  type SyslogLevel,
} from "./systemd.ts";
