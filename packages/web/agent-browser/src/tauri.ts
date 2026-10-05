// SPDX-License-Identifier: Apache-2.0
/**
 * Client of the Tauri debug bridge (`aphrody_tauri_wrap::debug`, the patched hypothesi
 * `tauri-plugin-mcp-bridge`): discovery of running debug-enabled Tauri apps and a typed
 * WebSocket client for window listing, DOM and accessibility snapshots, JavaScript evaluation,
 * console logs, IPC call traces, native screenshots and wait-for conditions.
 *
 * Discovery files live in `<APHRODY_HOME or ~/.aphrody>/web/tauri-debug/*.json` (mode 0600) and
 * carry the loopback URL and the per-process token. The token is only ever sent to the
 * loopback URL of the same file and is never logged by this module.
 *
 * Runtime support is documented in `docs/guides/web/TAURI-DEBUG.md`: the one desktop runtime is CEF; apps use
 * this bridge, or attach `WebCdpPage` to the CEF remote-debugging port (an opt-in of the launcher).
 */
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Wire contract written by the bridge: the schema keeps the name of the crate it was born in.
export const DISCOVERY_SCHEMA = "aphrody-tauri-debug/1";

export interface TauriApp {
  schema: string;
  pid: number;
  exe: string;
  ws: string;
  host: string;
  port: number;
  token: string;
  startedAtMs: number;
  tauri: string;
  bridge: string;
  /** Absolute path of the discovery file. */
  file: string;
}

/** `<APHRODY_HOME or ~/.aphrody>/web/tauri-debug`. */
export function tauriDebugDir(
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): string {
  const base =
    env.APHRODY_HOME && env.APHRODY_HOME.length > 0 ? env.APHRODY_HOME : join(home, ".aphrody");
  return join(base, "web", "tauri-debug");
}

/** Validates a parsed discovery document; returns `null` for anything that is not ours. */
export function parseDiscovery(raw: unknown, file: string): TauriApp | null {
  if (typeof raw !== "object" || raw === null) return null;
  const doc = raw as Record<string, unknown>;
  if (doc.schema !== DISCOVERY_SCHEMA) return null;
  const { pid, port, token, ws, host } = doc;
  if (
    typeof pid !== "number" ||
    typeof port !== "number" ||
    typeof token !== "string" ||
    typeof ws !== "string" ||
    typeof host !== "string"
  )
    return null;
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) return null; // never talk to a non-loopback bridge
  return {
    schema: DISCOVERY_SCHEMA,
    pid,
    exe: String(doc.exe ?? "tauri-app"),
    ws,
    host,
    port,
    token,
    startedAtMs: Number(doc.startedAtMs ?? 0),
    tauri: String(doc.tauri ?? ""),
    bridge: String(doc.bridge ?? ""),
    file,
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Running debug-enabled Tauri apps. Files of dead processes are skipped (and removed when `prune`). */
export function listTauriApps(
  options: { dir?: string; prune?: boolean; alive?: (pid: number) => boolean } = {},
): TauriApp[] {
  const dir = options.dir ?? tauriDebugDir();
  if (!existsSync(dir)) return [];
  const alive = options.alive ?? pidAlive;
  const apps: TauriApp[] = [];
  for (const name of readdirSync(dir).filter(
    (entry) => entry.endsWith(".json") && !entry.startsWith("."),
  )) {
    const file = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const app = parseDiscovery(parsed, file);
    if (!app) continue;
    if (!alive(app.pid)) {
      if (options.prune) {
        try {
          unlinkSync(file);
        } catch {
          // another process removed it first
        }
      }
      continue;
    }
    apps.push(app);
  }
  return apps.toSorted((a, b) => b.startedAtMs - a.startedAtMs);
}

export interface BridgeResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: string;
  windowContext?: { windowLabel?: string; totalWindows?: number; warning?: string | null };
}

export interface TauriWindow {
  label: string;
  title: string | null;
  url: string | null;
  focused: boolean;
  visible: boolean;
  isMain: boolean;
}

export interface IpcEvent {
  timestamp: number;
  command: string;
  args: unknown;
  result: unknown;
  error: string | null;
  duration_ms: number | null;
}

/** JavaScript run in the webview for `domSnapshot`: title, URL, visible text, roles and names. */
export const DOM_SNAPSHOT_SCRIPT = `
const roleOf = (el) => el.getAttribute("role") || ({ a: "link", button: "button", input: el.type === "checkbox" ? "checkbox" : "textbox", select: "combobox", textarea: "textbox", img: "img", h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading", nav: "navigation", main: "main", header: "banner", footer: "contentinfo", aside: "complementary", form: "form", table: "table", ul: "list", ol: "list", li: "listitem" })[el.tagName.toLowerCase()] || null;
const nameOf = (el) => (el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || (el.textContent || "")).trim().replace(/\\s+/g, " ").slice(0, 120);
const nodes = [...document.querySelectorAll("a[href],button,input,select,textarea,[role],h1,h2,h3,h4,h5,h6,nav,main,header,footer,aside,form,img[alt],table")].slice(0, 500);
return {
  title: document.title,
  url: location.href,
  lang: document.documentElement.lang || null,
  viewport: { width: innerWidth, height: innerHeight },
  text: (document.body ? document.body.innerText : "").slice(0, 30000),
  tree: nodes.map((el, index) => ({ ref: "e" + (index + 1), tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el), id: el.id || null, testId: el.getAttribute("data-testid"), href: el.getAttribute("href"), disabled: !!el.disabled })),
};`;

export class TauriBridgeError extends Error {
  constructor(
    message: string,
    readonly command: string,
  ) {
    super(message);
    this.name = "TauriBridgeError";
  }
}

export class TauriBridge {
  readonly #socket: WebSocket;
  readonly #pending = new Map<
    string,
    {
      resolve(value: BridgeResponse): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #events = new Set<(event: unknown) => void>();
  #nextId = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => this.#onMessage(String(event.data)));
    const fail = () => {
      for (const { reject, timer } of this.#pending.values()) {
        clearTimeout(timer);
        reject(new Error("Tauri bridge connection closed"));
      }
      this.#pending.clear();
    };
    socket.addEventListener("close", fail);
    socket.addEventListener("error", fail);
  }

  /** Connects to a discovered app (or a `ws://` URL that already carries `?token=`). */
  static async connect(target: TauriApp | string, timeoutMs = 10_000): Promise<TauriBridge> {
    const url =
      typeof target === "string"
        ? target
        : `${target.ws}/?token=${encodeURIComponent(target.token)}`;
    const parsed = new URL(url);
    if (!["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname))
      throw new Error("refusing to connect to a non-loopback bridge");
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Tauri bridge connection timed out: ${parsed.host}`));
      }, timeoutMs);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error(`Tauri bridge is unavailable or rejected the token: ${parsed.host}`));
        },
        { once: true },
      );
    });
    return new TauriBridge(socket);
  }

  /** Connects to the newest running debug-enabled app, optionally filtered by executable name. */
  static async connectToRunning(exe?: string): Promise<{ app: TauriApp; bridge: TauriBridge }> {
    const app = listTauriApps({ prune: true }).find((candidate) => !exe || candidate.exe === exe);
    if (!app)
      throw new Error(
        `no running Tauri app with the debug bridge${exe ? ` named ${exe}` : ""}; start it with APHRODY_TAURI_DEBUG=1 and the debug-bridge feature`,
      );
    return { app, bridge: await TauriBridge.connect(app) };
  }

  #onMessage(text: string): void {
    let message: BridgeResponse & { type?: string; payload?: unknown };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    const pending = typeof message.id === "string" ? this.#pending.get(message.id) : undefined;
    if (pending && typeof message.id === "string") {
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message);
      return;
    }
    for (const listener of this.#events) listener(message);
  }

  /** Subscribes to broadcast frames (element picker events). Returns the unsubscribe function. */
  onEvent(listener: (event: unknown) => void): () => void {
    this.#events.add(listener);
    return () => this.#events.delete(listener);
  }

  /** Sends one command and resolves with its `data`; rejects with `TauriBridgeError` on failure. */
  async request<T = unknown>(
    command: string,
    args: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<T> {
    const id = `aw-${this.#nextId++}`;
    const response = await new Promise<BridgeResponse<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new TauriBridgeError(
            `bridge command ${command} timed out after ${timeoutMs} ms`,
            command,
          ),
        );
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolve as (value: BridgeResponse) => void, reject, timer });
      this.#socket.send(JSON.stringify({ id, command, args }));
    });
    if (!response.success)
      throw new TauriBridgeError(response.error ?? `bridge command ${command} failed`, command);
    return response.data as T;
  }

  listWindows(): Promise<TauriWindow[]> {
    return this.request<TauriWindow[]>("list_windows");
  }

  windowInfo(windowId?: string): Promise<Record<string, unknown>> {
    return this.request("get_window_info", windowId ? { windowId } : {});
  }

  /** Evaluates `script` (a function body; the value of a bare expression is returned). */
  evaluate<T = unknown>(script: string, windowLabel?: string): Promise<T> {
    return this.request<T>("execute_js", { script, ...(windowLabel ? { windowLabel } : {}) });
  }

  /** Title, URL, visible text and the role/name tree of interactive and landmark elements. */
  domSnapshot(windowLabel?: string): Promise<{
    title: string;
    url: string;
    lang: string | null;
    text: string;
    tree: {
      ref: string;
      tag: string;
      role: string | null;
      name: string;
      id: string | null;
      testId: string | null;
      href: string | null;
      disabled: boolean;
    }[];
  }> {
    return this.evaluate(DOM_SNAPSHOT_SCRIPT, windowLabel);
  }

  /** Console entries buffered by the bridge since the page loaded. */
  consoleLogs(
    windowLabel?: string,
  ): Promise<{ level?: string; message?: string; timestamp?: number }[]> {
    return this.evaluate("return window.__MCP_CONSOLE_LOGS__ || [];", windowLabel);
  }

  async clickSelector(selector: string, windowLabel?: string): Promise<void> {
    await this.evaluate(
      `const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("no element matches " + ${JSON.stringify(selector)}); el.click(); return true;`,
      windowLabel,
    );
  }

  async fillSelector(selector: string, text: string, windowLabel?: string): Promise<void> {
    await this.evaluate(
      `const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("no element matches " + ${JSON.stringify(selector)}); const proto = Object.getPrototypeOf(el); const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set; if (setter) setter.call(el, ${JSON.stringify(text)}); else el.textContent = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true;`,
      windowLabel,
    );
  }

  /** Polls until the selector matches or the text appears; rejects on timeout. */
  async waitFor(
    condition: { selector?: string; text?: string; timeoutMs?: number },
    windowLabel?: string,
  ): Promise<void> {
    const deadline = Date.now() + (condition.timeoutMs ?? 10_000);
    const probe = `return !!(${condition.selector ? `document.querySelector(${JSON.stringify(condition.selector)})` : "true"}) && ${condition.text ? `(document.body && document.body.innerText.includes(${JSON.stringify(condition.text)}))` : "true"};`;
    while (Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      if ((await this.evaluate<boolean>(probe, windowLabel)) === true) return;
      // oxlint-disable-next-line no-await-in-loop
      await Bun.sleep(100);
    }
    throw new TauriBridgeError(
      `waitFor timed out (${condition.selector ?? ""} ${condition.text ?? ""})`.trim(),
      "wait_for",
    );
  }

  /** Native screenshot as `{ dataUrl, imageWidth, imageHeight, cssWidth, cssHeight }` (CEF DevTools protocol, every platform). */
  screenshot(
    options: {
      format?: "png" | "jpeg";
      quality?: number;
      maxWidth?: number;
      windowLabel?: string;
    } = {},
  ): Promise<{
    dataUrl: string;
    imageWidth: number;
    imageHeight: number;
    cssWidth: number;
    cssHeight: number;
  }> {
    return this.request("capture_native_screenshot", { ...options }, 30_000);
  }

  startIpcTrace(): Promise<unknown> {
    return this.request("invoke_tauri", {
      command: "plugin:mcp-bridge|start_ipc_monitor",
      args: {},
    });
  }

  stopIpcTrace(): Promise<unknown> {
    return this.request("invoke_tauri", {
      command: "plugin:mcp-bridge|stop_ipc_monitor",
      args: {},
    });
  }

  ipcEvents(windowLabel?: string): Promise<IpcEvent[]> {
    return this.request("invoke_tauri", {
      command: "plugin:mcp-bridge|get_ipc_events",
      args: windowLabel ? { windowLabel } : {},
    });
  }

  /** Backend state: app name, identifier, versions, window list. */
  backendState(): Promise<Record<string, unknown>> {
    return this.request("invoke_tauri", {
      command: "plugin:mcp-bridge|get_backend_state",
      args: {},
    });
  }

  emit(eventName: string, payload: unknown = null): Promise<unknown> {
    return this.request("invoke_tauri", {
      command: "plugin:mcp-bridge|emit_event",
      args: { eventName, payload },
    });
  }

  close(): void {
    this.#socket.close();
  }
}
