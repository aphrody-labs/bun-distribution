// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop */
import type { Policy } from "./store.ts";

export interface Turn {
  id: string;
  status: "inProgress" | "completed" | "failed" | "interrupted";
  items: { type: string; text?: string; phase?: string }[];
}
export function finalText(turn: Turn): string {
  const messages = turn.items.filter((item) => item.type === "agentMessage");
  return (
    (messages.findLast((item) => item.phase === "final_answer") ?? messages.at(-1))?.text ?? ""
  );
}
interface Wire {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number };
}

/** Own a dedicated stdio server; never replace a running turn after an observation timeout. */
export class Codex {
  private child: ReturnType<typeof Bun.spawn<"pipe", "pipe", "inherit">>;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  private freshThreads = new Set<string>();
  onEvent: (method: string, params: Record<string, unknown>) => void = () => {};
  constructor(policy: Policy) {
    this.child = Bun.spawn([policy.codex, "app-server", "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env, APHRODY_PROFILE: policy.profile },
    });
    void this.readWire().catch(() => this.fail(new Error("Invalid Codex protocol")));
    void this.child.exited.then(() => this.fail(new Error("Codex server exited")));
  }
  private async readWire() {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of this.child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 16 * 1024 * 1024) throw new Error("Codex frame budget exceeded");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim()) this.receive(JSON.parse(line) as Wire);
        newline = buffer.indexOf("\n");
      }
    }
  }
  private send(message: Wire) {
    this.child.stdin.write(JSON.stringify(message) + "\n");
    void Promise.resolve(this.child.stdin.flush()).catch(() =>
      this.fail(new Error("Codex transport write failed")),
    );
  }
  private receive(message: Wire) {
    if (typeof message.id === "number" && !message.method) {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(`Codex RPC ${message.error.code}`));
      else request.resolve(message.result);
    } else if (message.method && message.id !== undefined) {
      // Authentication and permissions are not fabricated by the bridge.
      this.send({ id: message.id, error: { code: -32601 } });
    } else if (message.method) this.onEvent(message.method, message.params ?? {});
  }
  private fail(error: Error) {
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
  request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Codex connection closed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // This is an observation deadline, not evidence that the server or turn stopped.
        // Keep the same request until its response or the owned process's exit arrives.
        console.error(JSON.stringify({ event: "codex-observation-wait", requestId: id, method }));
      }, 60000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "aphrody_omar_monitor", title: "Aphrody Omar monitor", version: "1.0.0" },
    });
    this.send({ method: "initialized", params: {} });
  }
  async thread(policy: Policy, mode: "monitor" | "worker", instructions: string): Promise<string> {
    const response = await this.request<{ thread: { id: string } }>("thread/start", {
      cwd: policy.cwd,
      approvalPolicy: "never",
      sandbox: mode === "monitor" ? "read-only" : "danger-full-access",
      developerInstructions: instructions,
      config: {
        mcp_servers: { aphrody: { command: policy.nativeMcp } },
        features: { multi_agent: true },
      },
    });
    this.freshThreads.add(response.thread.id);
    return response.thread.id;
  }
  async resume(threadId: string) {
    await this.request("thread/resume", { threadId, excludeTurns: true });
  }
  async read(threadId: string): Promise<Turn | undefined> {
    const result = await this.request<{ thread: { turns: Turn[] } }>("thread/read", {
      threadId,
      includeTurns: true,
    });
    return result.thread.turns.at(-1);
  }
  async run(
    threadId: string,
    input: string,
    schema: unknown,
    onLive: (turn: Turn) => void,
    processedTurn: string | null = null,
  ): Promise<Turn> {
    const fresh = this.freshThreads.delete(threadId);
    if (!fresh) await this.resume(threadId);
    let turn = fresh ? undefined : await this.read(threadId);
    if (
      !turn ||
      turn.status === "interrupted" ||
      (turn.id === processedTurn && turn.status !== "inProgress")
    ) {
      const response = await this.request<{ turn: Turn }>("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text:
              turn?.status === "interrupted"
                ? `Le tour précédent est confirmé interrompu. Inspecte l'état réel avant de répéter une mutation, puis poursuis les objectifs complets.\n${input}`
                : input,
          },
        ],
        outputSchema: schema,
      });
      turn = response.turn;
    }
    for (;;) {
      onLive(turn);
      if (turn.status !== "inProgress") return turn;
      await Bun.sleep(10000);
      turn = (await this.read(threadId)) ?? turn;
    }
  }
  close() {
    this.fail(new Error("Codex client closed"));
    this.child.kill();
  }
}
