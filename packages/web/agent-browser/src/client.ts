// SPDX-License-Identifier: Apache-2.0
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_OBSCURA_CDP_URL, WebCdpPage } from "./cdp.ts";
export { DEFAULT_OBSCURA_CDP_URL } from "./cdp.ts";
import type {
  ClickOptions,
  CommandResponse,
  LaunchOptions,
  PdfOptions,
  RefEntry,
  ScreenshotOptions,
  SnapshotResult,
} from "./types.ts";

// Child-process runner of AgentBrowser.exec/execAsync; the command line is `yolo browser`.
const OWN_LAUNCHER = realpathSync(join(import.meta.dir, "cli.ts"));

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function isMetaCommand(args: readonly string[]): boolean {
  return (
    args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version") ||
    ["skills", "install", "doctor", "upgrade", "help", "version"].includes(args[0] ?? "")
  );
}

/** Resolve the installed native Rust CLI, never this package's Bun launcher. */
export function resolveAgentBrowserBinary(): string {
  const override =
    process.env.APHRODY_AGENT_BROWSER_BIN ??
    process.env.AGENT_BROWSER_BIN ??
    process.env.APHRODY_BROWSER_BIN;
  if (override) {
    const path = existsSync(override) ? override : Bun.which(override);
    if (!path) throw new Error(`agent-browser binary override is unavailable: ${override}`);
    const binary = realpathSync(resolve(path));
    if (binary === OWN_LAUNCHER)
      throw new Error("agent-browser binary override points to this Bun launcher");
    return binary;
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const root = join(import.meta.dir, "../../../..");
  const names = [`aphrody-agent-browser${ext}`];
  for (const profile of ["release", "debug"]) {
    for (const name of names) {
      const candidate = join(root, "target", profile, name);
      if (existsSync(candidate)) return realpathSync(candidate);
    }
  }

  const installed = Bun.which(`aphrody-agent-browser${ext}`);
  if (installed) return realpathSync(installed);
  throw new Error(
    "native agent-browser Rust CLI is unavailable; install it or set APHRODY_AGENT_BROWSER_BIN",
  );
}

/** Build CLI arguments for the externally owned Obscura CDP server. */
export function prepareAgentBrowserArgs(
  args: readonly string[],
  options: LaunchOptions = {},
  json = true,
): string[] {
  const finalArgs = [...args];
  if (options.session && !hasFlag(finalArgs, "--session")) {
    finalArgs.push("--session", options.session);
  }

  if (!isMetaCommand(finalArgs) && !hasFlag(finalArgs, "--cdp")) {
    const cdpUrl =
      options.cdpUrl ??
      (options.port ? `ws://127.0.0.1:${options.port}/devtools/browser` : undefined) ??
      process.env.APHRODY_BROWSER_CDP_URL ??
      process.env.APHRODY_CDP_URL ??
      DEFAULT_OBSCURA_CDP_URL;
    finalArgs.push("--cdp", cdpUrl);
  }
  if (options.headless === false && !hasFlag(finalArgs, "--headed")) {
    finalArgs.push("--headed");
  }
  if (options.executablePath && !hasFlag(finalArgs, "--executable-path")) {
    finalArgs.push("--executable-path", options.executablePath);
  }
  if (options.proxy && !hasFlag(finalArgs, "--proxy")) {
    finalArgs.push("--proxy", options.proxy);
  }
  if (options.userDataDir && !hasFlag(finalArgs, "--profile")) {
    finalArgs.push("--profile", options.userDataDir);
  }
  if (options.hideScrollbars !== undefined && !hasFlag(finalArgs, "--hide-scrollbars")) {
    finalArgs.push("--hide-scrollbars", String(options.hideScrollbars));
  }
  if (json && !hasFlag(finalArgs, "--json")) finalArgs.push("--json");
  return finalArgs;
}

function parseResponse(stdout: string, stderr: string, status: number): CommandResponse {
  const output = stdout.trim();
  for (const line of output.split("\n").toReversed()) {
    const value = line.trim();
    if (!value.startsWith("{") || !value.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const success = typeof parsed.success === "boolean" ? parsed.success : status === 0;
      return {
        id: typeof parsed.id === "string" ? parsed.id : "",
        success,
        data: parsed.data ?? parsed,
        error:
          typeof parsed.error === "string"
            ? parsed.error
            : success
              ? undefined
              : stderr.trim() || `agent-browser exited ${status}`,
      };
    } catch {
      // A diagnostic line can look like JSON; inspect the preceding lines.
    }
  }
  return {
    id: "",
    success: status === 0,
    data: output,
    error: status === 0 ? undefined : stderr.trim() || `agent-browser exited ${status}`,
  };
}

// Public compatibility surface intentionally groups the static browser commands.
// oxlint-disable-next-line typescript/no-extraneous-class
export class AgentBrowser {
  static async open(url?: string, options: LaunchOptions = {}): Promise<AgentPage> {
    const session =
      options.session ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const endpoint =
      options.cdpUrl ??
      (options.port ? `ws://127.0.0.1:${options.port}/devtools/browser` : undefined) ??
      process.env.APHRODY_BROWSER_CDP_URL ??
      process.env.APHRODY_CDP_URL ??
      DEFAULT_OBSCURA_CDP_URL;
    const native = await WebCdpPage.connect(endpoint);
    const page = new AgentPage(session, options, native);
    try {
      if (url) await page.goto(url);
      return page;
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  /** Compatibility path for callers requiring a synchronous command result. */
  static exec(args: string[], options: LaunchOptions = {}): CommandResponse {
    try {
      const result = Bun.spawnSync(
        [process.execPath, OWN_LAUNCHER, ...prepareAgentBrowserArgs(args, options)],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          timeout: options.timeoutMs ?? 30_000,
          windowsHide: true,
        },
      );
      return parseResponse(
        result.stdout.toString("utf8"),
        result.stderr.toString("utf8"),
        result.exitCode ?? 1,
      );
    } catch (error) {
      return {
        id: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Browser actions use this path so a Rust CDP command cannot freeze Bun. */
  static async execAsync(args: string[], options: LaunchOptions = {}): Promise<CommandResponse> {
    try {
      const proc = Bun.spawn(
        [process.execPath, OWN_LAUNCHER, ...prepareAgentBrowserArgs(args, options)],
        {
          stdout: "pipe",
          stderr: "pipe",
          windowsHide: true,
        },
      );
      const timeoutMs = options.timeoutMs ?? 30_000;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);
      try {
        const [stdout, stderr, status] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (timedOut)
          return { id: "", success: false, error: `agent-browser timed out after ${timeoutMs} ms` };
        return parseResponse(stdout, stderr, status);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return {
        id: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class AgentPage {
  readonly session: string;
  readonly options: LaunchOptions;
  #native?: WebCdpPage;
  #connecting?: Promise<WebCdpPage>;
  readonly #refs = new Map<string, number>();

  constructor(session: string, options: LaunchOptions = {}, native?: WebCdpPage) {
    this.session = session;
    this.options = { ...options, session };
    this.#native = native;
  }

  get #page(): WebCdpPage {
    if (!this.#native) throw new Error("AgentPage is not connected");
    return this.#native;
  }

  url(): string {
    return this.#native?.url() ?? "about:blank";
  }

  async open(): Promise<void> {
    if (this.#native) return;
    const endpoint =
      this.options.cdpUrl ??
      (this.options.port ? `ws://127.0.0.1:${this.options.port}/devtools/browser` : undefined) ??
      process.env.APHRODY_BROWSER_CDP_URL ??
      process.env.APHRODY_CDP_URL ??
      DEFAULT_OBSCURA_CDP_URL;
    this.#connecting ??= WebCdpPage.connect(endpoint);
    try {
      this.#native = await this.#connecting;
    } finally {
      this.#connecting = undefined;
    }
  }

  async goto(url: string): Promise<void> {
    await this.open();
    this.#refs.clear();
    await this.#page.goto(url);
  }

  async #resolve(target: string): Promise<number> {
    const cached = this.#refs.get(target);
    if (cached !== undefined) return cached;
    if (target.startsWith("@e")) throw new Error(`Unknown snapshot reference: ${target}`);
    const document = await this.#page._send("DOM.getDocument", { depth: 0 });
    const root = document.root as { nodeId: number };
    const matches = await this.#page._send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: target,
    });
    const id = (matches.nodeIds as number[] | undefined)?.[0];
    if (id === undefined) throw new Error(`Element not found: ${target}`);
    return id;
  }

  async #outerHtml(nodeId: number): Promise<string> {
    const result = await this.#page._send("DOM.getOuterHTML", { nodeId });
    return String(result.outerHTML ?? "");
  }

  async snapshot(): Promise<SnapshotResult> {
    await this.open();
    this.#refs.clear();
    const document = await this.#page._send("DOM.getDocument", { depth: 0 });
    const root = document.root as { nodeId: number };
    const matches = await this.#page._send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "a,button,input,textarea,select,[role=button],[tabindex]",
    });
    const refs = new Map<string, RefEntry>();
    const lines: string[] = [];
    const nodes = (matches.nodeIds as number[] | undefined) ?? [];
    const entries = await Promise.all(
      nodes.map(async (nodeId) => {
        const [described, html] = await Promise.all([
          this.#page._send("DOM.describeNode", { nodeId }),
          this.#outerHtml(nodeId),
        ]);
        const node = described.node as { nodeName?: string; attributes?: string[] } | undefined;
        const attrs = node?.attributes ?? [];
        const attribute = (name: string): string | undefined => {
          for (let i = 0; i + 1 < attrs.length; i += 2) if (attrs[i] === name) return attrs[i + 1];
          return undefined;
        };
        const role = attribute("role") ?? node?.nodeName?.toLowerCase() ?? "element";
        const name =
          attribute("aria-label") ??
          attribute("placeholder") ??
          html
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        return { nodeId, role, name };
      }),
    );
    for (const [index, { nodeId, role, name }] of entries.entries()) {
      const ref = `@e${index + 1}`;
      this.#refs.set(ref, nodeId);
      refs.set(ref, { ref, role, name, backendNodeId: nodeId });
      lines.push(`- ${role} ${JSON.stringify(name)} [ref=${ref}]`);
    }
    return { raw: lines.join("\n"), refs, title: await this.#page.title(), url: this.url() };
  }

  async click(target: string, opts: ClickOptions = {}): Promise<void> {
    await this.open();
    const nodeId = await this.#resolve(target);
    await this.#page._send("DOM.focus", { nodeId });
    if (opts.button === undefined || opts.button === "left") {
      await this.#page.evaluate<void>("document.activeElement.click()");
      return;
    }
    const box = await this.#page._send("DOM.getBoxModel", { nodeId });
    const quad = (box.model as { content: number[] }).content;
    const x = ((quad[0] ?? 0) + (quad[2] ?? 0)) / 2;
    const y = ((quad[1] ?? 0) + (quad[5] ?? 0)) / 2;
    await this.#page._send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: opts.button,
      clickCount: opts.clickCount ?? 1,
    });
    await this.#page._send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: opts.button,
      clickCount: opts.clickCount ?? 1,
    });
  }

  async fill(target: string, text: string): Promise<void> {
    await this.open();
    await this.#page._send("DOM.focus", { nodeId: await this.#resolve(target) });
    await this.#page.evaluate<void>("document.activeElement.value = ''");
    await this.#page._send("Input.insertText", { text });
  }

  async type(target: string, text: string): Promise<void> {
    await this.open();
    await this.#page._send("DOM.focus", { nodeId: await this.#resolve(target) });
    await this.#page._send("Input.insertText", { text });
  }

  async press(key: string): Promise<void> {
    await this.open();
    await this.#page._send("Input.dispatchKeyEvent", { type: "keyDown", key });
    await this.#page._send("Input.dispatchKeyEvent", { type: "keyUp", key });
  }

  async hover(target: string): Promise<void> {
    await this.open();
    const box = await this.#page._send("DOM.getBoxModel", { nodeId: await this.#resolve(target) });
    const quad = (box.model as { content: number[] }).content;
    await this.#page._send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: ((quad[0] ?? 0) + (quad[2] ?? 0)) / 2,
      y: ((quad[1] ?? 0) + (quad[5] ?? 0)) / 2,
    });
  }

  async select(target: string, value: string): Promise<void> {
    await this.open();
    await this.#page._send("DOM.focus", { nodeId: await this.#resolve(target) });
    await this.#page.evaluate<void>(
      `document.activeElement.value = ${JSON.stringify(value)}; document.activeElement.dispatchEvent(new Event('change', { bubbles: true }))`,
    );
  }

  async screenshot(path?: string, opts: ScreenshotOptions = {}): Promise<string> {
    await this.open();
    const result = await this.#page._send("Page.captureScreenshot", {
      format: opts.format ?? "png",
      captureBeyondViewport: opts.fullPage ?? false,
      ...(opts.quality === undefined ? {} : { quality: opts.quality }),
    });
    const data = String(result.data ?? "");
    if (path) {
      await Bun.write(path, Buffer.from(data, "base64"));
      return path;
    }
    return data;
  }

  async pdf(path?: string, opts: PdfOptions = {}): Promise<string> {
    await this.open();
    const result = await this.#page._send("Page.printToPDF", {
      landscape: opts.landscape ?? false,
      displayHeaderFooter: opts.displayHeaderFooter ?? false,
      printBackground: opts.printBackground ?? false,
      ...(opts.scale === undefined ? {} : { scale: opts.scale }),
    });
    const data = String(result.data ?? "");
    if (path) {
      await Bun.write(path, Buffer.from(data, "base64"));
      return path;
    }
    return data;
  }

  async getText(target: string): Promise<string> {
    await this.open();
    const html = await this.#outerHtml(await this.#resolve(target));
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async getAttribute(target: string, name: string): Promise<string | null> {
    await this.open();
    const described = await this.#page._send("DOM.describeNode", {
      nodeId: await this.#resolve(target),
    });
    const attrs = (described.node as { attributes?: string[] } | undefined)?.attributes ?? [];
    for (let i = 0; i + 1 < attrs.length; i += 2)
      if (attrs[i] === name) return attrs[i + 1] ?? null;
    return null;
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    await this.open();
    return this.#page.evaluate<T>(script);
  }

  async waitFor(selectorOrMs: string | number): Promise<void> {
    await this.open();
    if (typeof selectorOrMs === "number") {
      await Bun.sleep(selectorOrMs);
      return;
    }
    const deadline = Date.now() + (this.options.timeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      try {
        await this.#resolve(selectorOrMs);
        return;
      } catch {
        await Bun.sleep(50);
      }
    }
    throw new Error(`Timeout waiting for ${selectorOrMs}`);
  }

  async close(): Promise<void> {
    const native = this.#native ?? (await this.#connecting);
    if (native) await native.close();
  }
}
