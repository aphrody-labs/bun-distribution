// SPDX-License-Identifier: Apache-2.0
export const DEFAULT_OBSCURA_CDP_URL = "ws://127.0.0.1:9222/devtools/browser";

export interface NavigationResponse {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  headers?: Record<string, string>;
}

type CdpParams = Record<string, unknown>;

/** One page owns one `Bun.WebView` tab on the Rust CDP server (Obscura). */
export class WebCdpPage {
  readonly #view: Bun.WebView;
  readonly #console: Set<(params: CdpParams) => void>;
  #url = "about:blank";
  #documentResponse: NavigationResponse | null = null;
  #closed = false;
  // Bun.WebView accepts one cdp() in flight per view.
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(view: Bun.WebView, console: Set<(params: CdpParams) => void>) {
    this.#view = view;
    this.#console = console;
    listen(view, "Network.responseReceived", (data) => {
      if (data.type !== "Document") return;
      const response = data.response as
        | { url?: string; status?: number; statusText?: string; headers?: Record<string, string> }
        | undefined;
      if (!response) return;
      const status = response.status ?? 0;
      this.#documentResponse = {
        url: response.url ?? this.url(),
        status,
        statusText: response.statusText ?? "",
        ok: status >= 200 && status < 300,
        headers: response.headers,
      };
    });
  }

  static async connect(
    endpoint = process.env.APHRODY_BROWSER_CDP_URL ??
      process.env.APHRODY_CDP_URL ??
      DEFAULT_OBSCURA_CDP_URL,
  ): Promise<WebCdpPage> {
    // Bun.WebView keeps Runtime.consoleAPICalled for its `console` option and never dispatches it.
    const console = new Set<(params: CdpParams) => void>();
    const onConsole = (type: string, ...args: unknown[]) => {
      const params = { type, args: args.map((value) => ({ value })) };
      for (const listener of console) listener(params);
    };
    let view: Bun.WebView;
    try {
      view = new Bun.WebView({ backend: { type: "chrome", url: endpoint }, console: onConsole });
    } catch (error) {
      throw new Error(`Obscura CDP is unavailable: ${endpoint}`, { cause: error });
    }
    try {
      await timeout(
        view.navigate("about:blank"),
        10_000,
        `Obscura CDP connection timed out: ${endpoint}`,
      );
      const page = new WebCdpPage(view, console);
      await Promise.all([
        page._send("Page.enable", {}),
        page._send("Network.enable", {}),
        page._send("Runtime.enable", {}),
      ]);
      return page;
    } catch (error) {
      view.close();
      if (error instanceof Error && error.message.startsWith("Obscura CDP")) throw error;
      throw new Error(`Obscura CDP is unavailable: ${endpoint}`, { cause: error });
    }
  }

  _send(method: string, params: CdpParams): Promise<CdpParams> {
    if (this.#closed) return Promise.reject(new Error("Obscura CDP page is closed"));
    const sent = this.#queue.then(() => this.#view.cdp<CdpParams>(method, params));
    this.#queue = sent.catch(() => undefined);
    return timeout(sent, 30_000, `Obscura CDP ${method} timed out`);
  }

  /**
   * Subscribes `listener` to the CDP events named in `methods` (their domain must be enabled).
   * `Runtime.consoleAPICalled` carries `{ type, args: [{ value }] }`; `Page.frameNavigated` and
   * `Page.loadEventFired` stay internal to Bun.WebView.
   */
  onEvent(
    methods: readonly string[],
    listener: (method: string, params: CdpParams) => void,
  ): () => void {
    const stops = methods.map((method) => {
      if (method !== "Runtime.consoleAPICalled")
        return listen(this.#view, method, (params) => listener(method, params));
      const forward = (params: CdpParams) => listener(method, params);
      this.#console.add(forward);
      return () => void this.#console.delete(forward);
    });
    return () => {
      for (const stop of stops) stop();
    };
  }

  url(): string {
    return this.#view.url || this.#url;
  }

  async goto(
    url: string,
    waitUntil: "load" | "domcontentloaded" | "commit" | "networkidle" = "load",
  ): Promise<NavigationResponse> {
    this.#documentResponse = null;
    await this._send("Page.navigate", { url, waitUntil });
    const tree = await this._send("Page.getFrameTree", {});
    const frameTree = tree.frameTree as { frame?: { url?: string } } | undefined;
    this.#url = frameTree?.frame?.url ?? url;
    return this.#documentResponse ?? { url: this.#url, status: 0, statusText: "", ok: false };
  }

  async setContent(html: string): Promise<void> {
    await this.evaluate<void>(
      `document.open(); document.write(${JSON.stringify(html)}); document.close()`,
    );
  }

  async evaluate<T>(script: string): Promise<T> {
    const evaluated = await this._send("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluated.exceptionDetails)
      throw new Error(
        `Obscura CDP evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`,
      );
    return (evaluated.result as { value?: T } | undefined)?.value as T;
  }

  title(): Promise<string> {
    return this.evaluate<string>("document.title");
  }

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
    this.#closed = true;
    this.#view.close();
  }
}

function listen(
  view: Bun.WebView,
  method: string,
  handler: (params: CdpParams) => void,
): () => void {
  const listener = (event: Event) => handler((event as Event & { data?: CdpParams }).data ?? {});
  view.addEventListener(method, listener);
  return () => view.removeEventListener(method, listener);
}

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
