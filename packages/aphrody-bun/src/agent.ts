// SPDX-License-Identifier: Apache-2.0
// Derived from openai/codex sdk/python/src/openai_codex/{client,_message_router}.py
// Source revision: 78245b47af2a7aafcabe025828ceecca69db4df1 (Apache-2.0).
// Bun port of the upstream single-reader response routing and stdio lifecycle.
import type { Subprocess } from "bun";

export type Frame = {
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
};

export class AgentError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

class EventQueue {
  private items: (Frame | Error)[] = [];
  private wake?: () => void;
  push(item: Frame | Error) {
    this.items.push(item);
    this.wake?.();
  }
  async next(): Promise<Frame> {
    while (!this.items.length) {
      // eslint-disable-next-line no-await-in-loop -- Queue consumers wait for ordered events.
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
    this.wake = undefined;
    const item = this.items.shift()!;
    if (item instanceof Error) throw item;
    return item;
  }
}

export type AgentOptions = {
  executable?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  requestTimeoutMs?: number;
};

/** Owned app-server process; call close() in finally. Turn streams have no time cap. */
export class AgentClient {
  private readonly process: Subprocess<"pipe", "pipe", "pipe">;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private turns = new Map<string, EventQueue>();
  private failure?: Error;
  private sequence = 0;
  private readonly timeout: number;
  private readonly reader: Promise<void>;
  private readonly stderr: Promise<void>;

  constructor(options: AgentOptions = {}) {
    this.timeout = options.requestTimeoutMs ?? 30_000;
    this.process = Bun.spawn(
      [options.executable ?? "aphrody", ...(options.args ?? ["app-server"])],
      {
        windowsHide: true,
        cwd: options.cwd,
        env: { ...Bun.env, ...options.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    this.reader = this.read();
    this.stderr = this.drainStderr();
  }

  async initialize(): Promise<any> {
    const result = await this.request("initialize", {
      clientInfo: { name: "aphrody_bun_sdk", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
    return result;
  }

  startThread(params: Record<string, unknown> = {}): Promise<any> {
    return this.request("thread/start", params);
  }

  async startTurn(
    threadId: string,
    text: string,
    params: Record<string, unknown> = {},
  ): Promise<AgentTurn> {
    if (this.turns.has(threadId))
      throw new Error("A turn stream already owns this thread");
    const events = new EventQueue();
    this.turns.set(threadId, events);
    try {
      const result = await this.request("turn/start", {
        ...params,
        threadId,
        input: [{ type: "text", text }],
      });
      if (!result?.turn?.id) throw new Error("Invalid turn/start response");
      return new AgentTurn(this, threadId, result.turn, events, () =>
        this.turns.delete(threadId),
      );
    } catch (error) {
      this.turns.delete(threadId);
      throw error;
    }
  }

  request(
    method: string,
    params: Record<string, unknown> | null = null,
  ): Promise<any> {
    if (this.failure) return Promise.reject(this.failure);
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params: params ?? undefined });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>) {
    this.write({ method, params });
  }

  private write(frame: Frame) {
    if (this.failure) throw this.failure;
    this.process.stdin.write(`${JSON.stringify(frame)}\n`);
    this.process.stdin.flush();
  }

  private route(message: Frame) {
    if (message.method && message.id !== undefined) {
      this.write({
        id: message.id,
        error: { code: -32601, message: "Interactive requests unavailable" },
      });
    } else if (message.method) {
      this.turns.get(message.params?.threadId)?.push(message);
    } else {
      const waiter = this.pending.get(String(message.id));
      if (!waiter) return;
      this.pending.delete(String(message.id));
      clearTimeout(waiter.timer);
      if (message.error)
        waiter.reject(
          new AgentError(
            message.error.code,
            message.error.message,
            message.error.data,
          ),
        );
      else waiter.resolve(message.result);
    }
  }

  private async read() {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const reader = this.process.stdout.getReader();
    let buffered = "";
    try {
      while (true) {
        // eslint-disable-next-line no-await-in-loop -- Consume the sole stdout reader in wire order.
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, end);
          buffered = buffered.slice(end + 1);
          const message = JSON.parse(line);
          if (!message || typeof message !== "object" || Array.isArray(message))
            throw new Error("Invalid JSON-RPC payload");
          this.route(message);
        }
      }
      buffered += decoder.decode();
      this.fail(
        new Error(
          buffered.trim()
            ? "Truncated JSON-RPC frame"
            : "Agent process closed stdout",
        ),
      );
    } catch {
      this.fail(new Error("Agent transport failed"));
    } finally {
      reader.releaseLock();
    }
  }

  private async drainStderr() {
    try {
      for await (const _chunk of this.process.stderr) {
        /* Drain without exposing diagnostics or secrets. */
      }
    } catch {
      /* stdout reader propagates transport closure. */
    }
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(this.failure);
    }
    this.pending.clear();
    for (const events of this.turns.values()) events.push(this.failure);
  }

  async close(): Promise<void> {
    this.fail(new Error("Agent client closed"));
    this.process.stdin.end();
    const timer = setTimeout(() => this.process.kill(), 2000);
    const force = setTimeout(() => this.process.kill("SIGKILL"), 4000);
    try {
      await this.process.exited;
    } finally {
      clearTimeout(timer);
      clearTimeout(force);
    }
    await Promise.all([this.reader, this.stderr]);
  }
}

export class AgentTurn {
  readonly id: string;
  private consumed = false;
  constructor(
    private client: AgentClient,
    readonly threadId: string,
    readonly turn: Record<string, any>,
    private queue: EventQueue,
    private release: () => void,
  ) {
    this.id = turn.id;
  }
  interrupt(): Promise<any> {
    return this.client.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.id,
    });
  }
  async *events(): AsyncGenerator<Frame> {
    if (this.consumed) throw new Error("Turn events already consumed");
    this.consumed = true;
    try {
      while (true) {
        // eslint-disable-next-line no-await-in-loop -- Turn deltas must retain their wire order.
        const event = await this.queue.next();
        if ((event.params?.turnId ?? event.params?.turn?.id) !== this.id)
          continue;
        yield event;
        if (event.method === "turn/completed") return;
      }
    } finally {
      this.release();
    }
  }
}
