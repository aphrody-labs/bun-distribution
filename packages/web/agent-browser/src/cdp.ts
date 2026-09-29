// SPDX-License-Identifier: Apache-2.0
export const DEFAULT_OBSCURA_CDP_URL = "ws://127.0.0.1:9222/devtools/browser";

export interface NavigationResponse {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  headers?: Record<string, string>;
}

interface CdpReply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
}

interface PendingCommand {
  resolve(value: Record<string, unknown>): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function messageText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  throw new TypeError("CDP sent an unsupported message type");
}

/** One page owns one connection and one target in the Rust CDP server. */
export class WebCdpPage {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, PendingCommand>();
  readonly #listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  #nextId = 1;
  #sessionId = "";
  #targetId = "";
  #url = "about:blank";
  #documentResponse: NavigationResponse | null = null;
  #closed = false;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => this.#onMessage(event.data));
    socket.addEventListener("close", () => this.#rejectPending(new Error("Obscura CDP connection closed")));
    socket.addEventListener("error", () => this.#rejectPending(new Error("Obscura CDP connection failed")));
  }

  static async connect(endpoint = process.env.APHRODY_BROWSER_CDP_URL ??
    process.env.APHRODY_CDP_URL ?? DEFAULT_OBSCURA_CDP_URL): Promise<WebCdpPage> {
    const socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error(`Obscura CDP connection timed out: ${endpoint}`)); }, 10_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`Obscura CDP is unavailable: ${endpoint}`)); }, { once: true });
    });
    const page = new WebCdpPage(socket);
    try {
      const target = await page.#command("Target.createTarget", { url: "about:blank" }, false);
      page.#targetId = String(target.targetId ?? "");
      if (!page.#targetId) throw new Error("Obscura CDP did not return a targetId");
      const attached = await page.#command("Target.attachToTarget", {
        targetId: page.#targetId,
        flatten: true,
      }, false);
      page.#sessionId = String(attached.sessionId ?? "");
      if (!page.#sessionId) throw new Error("Obscura CDP did not return a sessionId");
      await Promise.all([
        page._send("Page.enable", {}),
        page._send("Network.enable", {}),
        page._send("Runtime.enable", {}),
      ]);
      return page;
    } catch (error) {
      socket.close();
      throw error;
    }
  }

  #onMessage(raw: unknown): void {
    let reply: CdpReply;
    try {
      reply = JSON.parse(messageText(raw)) as CdpReply;
    } catch {
      return;
    }
    if (typeof reply.id === "number") {
      const pending = this.#pending.get(reply.id);
      if (!pending) return;
      this.#pending.delete(reply.id);
      clearTimeout(pending.timer);
      if (reply.error) pending.reject(new Error(reply.error.message ?? "Obscura CDP command failed"));
      else pending.resolve(reply.result ?? {});
      return;
    }
    if (reply.sessionId !== this.#sessionId) return;
    if (reply.method) for (const listener of this.#listeners) listener(reply.method, reply.params ?? {});
    if (reply.method === "Page.frameNavigated") {
      const frame = reply.params?.frame as { url?: string } | undefined;
      if (frame?.url) this.#url = frame.url;
    }
    if (reply.method === "Network.responseReceived" && reply.params?.type === "Document") {
      const response = reply.params.response as {
        url?: string;
        status?: number;
        statusText?: string;
        headers?: Record<string, string>;
      } | undefined;
      if (response) {
        const status = response.status ?? 0;
        this.#documentResponse = {
          url: response.url ?? this.#url,
          status,
          statusText: response.statusText ?? "",
          ok: status >= 200 && status < 300,
          headers: response.headers,
        };
      }
    }
  }

  #rejectPending(error: Error): void {
    for (const [id, command] of this.#pending) {
      clearTimeout(command.timer);
      command.reject(error);
      this.#pending.delete(id);
    }
  }

  #command(method: string, params: Record<string, unknown>, inSession = true): Promise<Record<string, unknown>> {
    if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Obscura CDP page is closed"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Obscura CDP ${method} timed out`));
      }, 30_000);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#socket.send(JSON.stringify({
          id,
          method,
          params,
          ...(inSession && this.#sessionId ? { sessionId: this.#sessionId } : {}),
        }));
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  _send(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.#command(method, params);
  }

  onEvent(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  url(): string { return this.#url; }

  async goto(url: string, waitUntil: "load" | "domcontentloaded" | "commit" | "networkidle" = "load"): Promise<NavigationResponse> {
    this.#documentResponse = null;
    await this._send("Page.navigate", { url, waitUntil });
    const tree = await this._send("Page.getFrameTree", {});
    const frameTree = tree.frameTree as { frame?: { url?: string } } | undefined;
    this.#url = frameTree?.frame?.url ?? url;
    return this.#documentResponse ?? {
      url: this.#url,
      status: 0,
      statusText: "",
      ok: false,
    };
  }

  async setContent(html: string): Promise<void> {
    await this.evaluate<void>(`document.open(); document.write(${JSON.stringify(html)}); document.close()`);
  }

  async evaluate<T>(script: string): Promise<T> {
    const evaluated = await this._send("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluated.exceptionDetails) {
      throw new Error(`Obscura CDP evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`);
    }
    const result = evaluated.result as { value?: T } | undefined;
    return result?.value as T;
  }

  title(): Promise<string> { return this.evaluate<string>("document.title"); }

  async content(): Promise<string> {
    const document = await this._send("DOM.getDocument", { depth: 0 });
    const root = document.root as { nodeId: number };
    const result = await this._send("DOM.getOuterHTML", { nodeId: root.nodeId });
    return String(result.outerHTML ?? "");
  }

  async addCookies(cookies: Array<Record<string, unknown>>): Promise<void> {
    await this._send("Network.setCookies", { cookies });
  }

  async screenshot(): Promise<Uint8Array> {
    const result = await this._send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(String(result.data ?? ""), "base64");
  }

  async pdf(): Promise<Uint8Array> {
    const result = await this._send("Page.printToPDF", {});
    return Buffer.from(String(result.data ?? ""), "base64");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      if (this.#targetId) await this.#command("Target.closeTarget", { targetId: this.#targetId }, false);
    } finally {
      this.#closed = true;
      this.#socket.close();
      this.#rejectPending(new Error("Obscura CDP page closed"));
    }
  }
}
