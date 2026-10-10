// SPDX-License-Identifier: Apache-2.0
/**
 * `WebService`: the Bun client of the Aphrody web service contract.
 *
 * Product code (Shenron, RG, Achillea, kernel tooling) imports this module instead of spawning
 * `aphrody-web`, puppeteer or playwright itself. One-shot operations (fetch, scrape, crawl) run
 * the `aphrody-web` CLI as a child process with a hard timeout; interactive operations
 * (`session`, `screenshot`, `query`) attach to a CDP engine, starting a private one when no
 * endpoint is configured.
 *
 * The contract is documented in `docs/apis/web/WEB-SERVICE-CONTRACT.md`.
 */
import { RuntimeError, Status } from "@aphrody/runtime-sdk";
import { processes } from "@aphrody/runtime-sdk/modules";
import { WebCdpPage } from "./cdp.ts";
import { AgentBrowser, AgentPage } from "./client.ts";
import { loadWebConfig, resolveEngineBinary, type WebConfig } from "./config.ts";
import { installEngineCleanup, startEngine, type Engine, type EngineOptions } from "./engine.ts";

export type FetchDump = "html" | "text" | "links" | "markdown" | "artifact" | "original";

export interface FetchOptions {
  dump?: FetchDump;
  /** CSS selector to wait for before dumping. */
  selector?: string;
  /** JavaScript evaluated in the page; its result replaces the dump. */
  eval?: string;
  timeoutSecs?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | string;
  userAgent?: string;
  stealth?: boolean;
  proxy?: string;
  /** Allow loopback/private targets (local fixtures). */
  allowPrivateNetwork?: boolean;
}

export interface PageArtifact {
  url: string;
  html: string;
  extracted: {
    title: string;
    lang: string | null;
    canonical: string | null;
    description: string | null;
    text: string;
    markdown: string;
    wordCount?: number;
    word_count?: number;
    blocks: unknown[];
  };
  scripts: {
    url: string | null;
    source: string | null;
    media_type: string | null;
    module: boolean;
  }[];
}

export interface NativeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  bytes: number;
  truncated: boolean;
  body: string;
}

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  concurrency?: number;
  allowedDomains?: string[];
  signal?: AbortSignal;
  /** Existing private Cookie-Editor/Obscura JSON paths; native owner imports values. */
  cookieFiles?: string[];
  includeUrlRegex?: string[];
  excludeUrlRegex?: string[];
  /** Discover links after native V8 page rendering. */
  render?: boolean;
  obeyRobots?: boolean;
  sitemaps?: boolean;
  delayMs?: number;
  timeoutSecs?: number;
  userAgent?: string;
  allowPrivateNetwork?: boolean;
  includeHtml?: boolean;
  includeMarkdown?: boolean;
  includeLinks?: boolean;
  proxy?: string;
}

export interface CrawlPageReport {
  url: string;
  depth: number;
  status: number;
  contentType: string | null;
  title: string;
  lang: string | null;
  canonical: string | null;
  description: string | null;
  wordCount: number;
  textChars: number;
  markdownChars: number;
  bytes: number | null;
  duplicate: boolean;
  discoveredLinks: number;
  links?: string[];
  markdown?: string;
  html?: string;
}

export interface CrawlReport {
  schema: "aphrody-web.crawl/1";
  seeds: string[];
  allowedDomains: string[];
  maxDepth: number;
  maxPages: number;
  pages: CrawlPageReport[];
  errors: { url: string; error: string }[];
  stats: {
    attempts: number;
    pages: number;
    exactDuplicates: number;
    nearDuplicates: number;
    robotsFetched: number;
    robotsBlocked: number;
    sitemapsFetched: number;
    sitemapUrlsEnqueued: number;
    frontierPending: number;
    frontierDone: number;
    frontierFailed: number;
    elapsedMs: number;
  };
}

export interface ScrapeOptions {
  concurrency?: number;
  eval?: string;
  timeoutSecs?: number;
  proxy?: string;
}

export class WebServiceError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "WebServiceError";
  }
}

/** Builds the `aphrody-web fetch` argument list. Pure, covered by unit tests. */
export function fetchArgs(url: string, options: FetchOptions = {}, config?: WebConfig): string[] {
  const args: string[] = [];
  const proxy = options.proxy;
  if (proxy) args.push("--proxy", proxy);
  args.push("fetch", url, "--quiet");
  args.push("--dump", options.dump ?? config?.fetch.dump ?? "markdown");
  args.push("--timeout", String(options.timeoutSecs ?? config?.fetch.timeoutSecs ?? 30));
  args.push("--wait-until", options.waitUntil ?? config?.fetch.waitUntil ?? "load");
  const userAgent = options.userAgent ?? config?.fetch.userAgent ?? undefined;
  if (userAgent) args.push("--user-agent", userAgent);
  if (options.selector) args.push("--selector", options.selector);
  if (options.eval) args.push("--eval", options.eval);
  if (options.stealth ?? config?.engine.stealth) args.push("--stealth");
  return args;
}

/** Builds the `aphrody-web crawl` argument list. Pure, covered by unit tests. */
export function crawlArgs(
  seeds: readonly string[],
  options: CrawlOptions = {},
  config?: WebConfig,
): string[] {
  if (seeds.length === 0) throw new TypeError("crawl requires at least one seed URL");
  const crawl = config?.crawl;
  const args: string[] = [];
  if (options.proxy) args.push("--proxy", options.proxy);
  args.push("crawl", ...seeds, "--quiet", "--format", "json");
  args.push("--max-depth", String(options.maxDepth ?? crawl?.maxDepth ?? 2));
  args.push("--max-pages", String(options.maxPages ?? crawl?.maxPages ?? 25));
  args.push("--concurrency", String(options.concurrency ?? crawl?.concurrency ?? 4));
  args.push("--delay-ms", String(options.delayMs ?? crawl?.delayMs ?? 0));
  args.push("--timeout", String(options.timeoutSecs ?? crawl?.timeoutSecs ?? 300));
  args.push("--user-agent", options.userAgent ?? crawl?.userAgent ?? "AphrodyWeb/1.0");
  for (const host of options.allowedDomains ?? crawl?.allowedHosts ?? [])
    args.push("--allowed-domain", host);
  for (const pattern of options.includeUrlRegex ?? []) args.push("--include-url-regex", pattern);
  for (const pattern of options.excludeUrlRegex ?? []) args.push("--exclude-url-regex", pattern);
  if (options.obeyRobots ?? crawl?.obeyRobots ?? true) args.push("--obey-robots");
  if (options.sitemaps ?? crawl?.sitemaps) args.push("--sitemaps");
  if (options.allowPrivateNetwork) args.push("--allow-private-network");
  for (const path of options.cookieFiles ?? []) args.push("--cookie-file", path);
  if (options.render) args.push("--render");
  if (options.includeHtml) args.push("--include-html");
  if (options.includeMarkdown) args.push("--include-markdown");
  if (options.includeLinks) args.push("--include-links");
  return args;
}

export interface WebServiceOptions {
  config?: WebConfig;
  /** Absolute path of the `aphrody-web` binary; defaults to the configured resolution. */
  binary?: string;
  /** Lifetime output budget per CLI stream (1..64 MiB, default 64 MiB). Overflow is an error. */
  maxOutputBytes?: number;
}

export class WebService {
  readonly config: WebConfig;
  #binary: string | undefined;
  readonly #maxOutputBytes: number;
  #engine: Engine | undefined;
  #engineStart: Promise<Engine> | undefined;

  constructor(options: WebServiceOptions = {}) {
    this.config = options.config ?? loadWebConfig();
    this.#binary = options.binary;
    this.#maxOutputBytes = options.maxOutputBytes ?? 64 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.#maxOutputBytes) ||
      this.#maxOutputBytes < 1 ||
      this.#maxOutputBytes > 64 * 1024 * 1024
    ) {
      throw new RangeError("maxOutputBytes must be an integer between 1 and 64 MiB");
    }
  }

  /** Absolute path of the engine binary in use. */
  get binary(): string {
    this.#binary ??= resolveEngineBinary(this.config);
    return this.#binary;
  }

  async #runBytes(
    args: string[],
    timeoutMs: number,
    env: Record<string, string | undefined> = {},
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    signal?.throwIfAborted();
    using child = processes.spawn({
      program: this.binary,
      args,
      env,
      stdio: "capture-lossless",
      maxOutputBytes: this.#maxOutputBytes,
    });
    const command = args[0] === "--proxy" ? args[2] : args[0];
    const decoder = new TextDecoder();
    let diagnostics = "";
    try {
      const output = await child.collectOutput({
        timeoutMs,
        signal,
        onStderr(bytes) {
          diagnostics = (diagnostics + decoder.decode(bytes, { stream: true })).slice(-2000);
        },
      });
      signal?.throwIfAborted();
      const stderr = new TextDecoder().decode(output.stderr);
      const code = output.status.signal > 0 ? 128 + output.status.signal : output.status.exitCode;
      if (code !== 0) {
        throw new WebServiceError(
          `aphrody-web exited with ${code}: ${(stderr.trim().split("\n").at(-1) ?? "").slice(0, 300)}`,
          code,
          stderr.slice(-2000),
        );
      }
      return output.stdout;
    } catch (error) {
      signal?.throwIfAborted();
      diagnostics = (diagnostics + decoder.decode()).slice(-2000);
      if (error instanceof RuntimeError && error.status === Status.Timeout) {
        throw new WebServiceError(
          `aphrody-web ${command} timed out after ${timeoutMs} ms`,
          null,
          diagnostics,
        );
      }
      if (error instanceof RuntimeError && error.status === Status.OutputLimit) {
        throw new WebServiceError(
          `aphrody-web ${command} exceeded its ${this.#maxOutputBytes} byte output budget`,
          null,
          diagnostics,
        );
      }
      throw error;
    }
  }

  async #run(
    args: string[],
    timeoutMs: number,
    env: Record<string, string | undefined> = {},
    signal?: AbortSignal,
  ): Promise<string> {
    return new TextDecoder().decode(await this.#runBytes(args, timeoutMs, env, signal));
  }

  /** `aphrody-web --version`. */
  async version(): Promise<string> {
    return (await this.#run(["--version"], 15_000)).trim();
  }

  /** True when the installed binary exposes a subcommand (`fetch`, `scrape`, `crawl`, `launch`). */
  async supports(subcommand: string): Promise<boolean> {
    const help = await this.#run(["--help"], 15_000);
    return new RegExp(`^\\s{2}${subcommand}\\s`, "m").test(help);
  }

  /** One-shot page fetch rendered by the V8 browser; returns the requested dump as text. */
  async fetch(url: string, options: FetchOptions = {}): Promise<string> {
    const timeoutSecs = options.timeoutSecs ?? this.config.fetch.timeoutSecs;
    return await this.#run(
      fetchArgs(url, options, this.config),
      (timeoutSecs + 15) * 1000,
      options.allowPrivateNetwork ? { OBSCURA_ALLOW_PRIVATE_NETWORK: "1" } : {},
    );
  }

  /** Original response bytes from the native fetch owner, without text decoding. */
  async bytes(url: string, options: Omit<FetchOptions, "dump" | "eval"> = {}): Promise<Uint8Array> {
    const timeoutSecs = options.timeoutSecs ?? this.config.fetch.timeoutSecs;
    return this.#runBytes(
      [...fetchArgs(url, { ...options, dump: "original" }, this.config), "--fail-on-http-error"],
      (timeoutSecs + 15) * 1000,
      options.allowPrivateNetwork ? { OBSCURA_ALLOW_PRIVATE_NETWORK: "1" } : {},
    );
  }

  /** Original textual response bounded before transfer; binary bodies are skipped. */
  async response(
    url: string,
    options: { maxBytes?: number; timeoutSecs?: number; allowPrivateNetwork?: boolean } = {},
  ): Promise<NativeResponse> {
    const timeoutSecs = options.timeoutSecs ?? 30;
    const maxBytes = options.maxBytes ?? 2_000_000;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64_000_000) {
      throw new RangeError("maxBytes must be an integer between 1 and 64000000");
    }
    const args = [
      "response",
      url,
      "--max-bytes",
      String(maxBytes),
      "--timeout",
      String(timeoutSecs),
    ];
    if (options.allowPrivateNetwork) args.push("--allow-private-network");
    return JSON.parse(await this.#run(args, (timeoutSecs + 15) * 1000)) as NativeResponse;
  }

  /** Page converted to GitHub-flavoured Markdown. */
  async markdown(url: string, options: Omit<FetchOptions, "dump"> = {}): Promise<string> {
    return await this.fetch(url, { ...options, dump: "markdown" });
  }

  /** Stable crawler-to-N2B artifact: HTML, extracted content and discovered scripts. */
  async artifact(url: string, options: Omit<FetchOptions, "dump"> = {}): Promise<PageArtifact> {
    return JSON.parse(await this.fetch(url, { ...options, dump: "artifact" })) as PageArtifact;
  }

  /** Parallel scrape through worker processes; the format is the engine's JSON array. */
  async scrape(urls: readonly string[], options: ScrapeOptions = {}): Promise<unknown[]> {
    if (urls.length === 0) throw new TypeError("scrape requires at least one URL");
    const timeoutSecs = options.timeoutSecs ?? 60;
    const args = options.proxy ? ["--proxy", options.proxy] : [];
    args.push("scrape", ...urls, "--quiet", "--format", "json", "--timeout", String(timeoutSecs));
    args.push("--concurrency", String(options.concurrency ?? 4));
    if (options.eval) args.push("--eval", options.eval);
    const out = await this.#run(
      args,
      (timeoutSecs + 30) * 1000 * Math.ceil(urls.length / (options.concurrency ?? 4)),
    );
    return JSON.parse(out) as unknown[];
  }

  /** Bounded, robots-aware crawl over the static HTTP stack. */
  async crawl(seeds: readonly string[], options: CrawlOptions = {}): Promise<CrawlReport> {
    const timeoutSecs = options.timeoutSecs ?? this.config.crawl.timeoutSecs;
    const out = await this.#run(
      crawlArgs(seeds, options, this.config),
      (timeoutSecs + 15) * 1000,
      {},
      options.signal,
    );
    return JSON.parse(out) as CrawlReport;
  }

  /**
   * The CDP engine this service talks to. A configured endpoint
   * (`APHRODY_BROWSER_CDP_URL`) is used as is; otherwise a private engine is started once and
   * stopped by `close()`.
   */
  async engine(options: EngineOptions = {}): Promise<{ endpoint: string; owned: boolean }> {
    const configured = process.env.APHRODY_BROWSER_CDP_URL ?? process.env.APHRODY_CDP_URL;
    if (configured) return { endpoint: configured, owned: false };
    this.#engineStart ??= (async () => {
      installEngineCleanup();
      return (this.#engine = await startEngine({
        config: this.config,
        binary: this.binary,
        ...options,
      }));
    })();
    return { endpoint: (await this.#engineStart).endpoint, owned: true };
  }

  /** Interactive page (snapshot refs, click, fill, evaluate, screenshot) on the CDP engine. */
  async session(url?: string, options: EngineOptions = {}): Promise<AgentPage> {
    const { endpoint } = await this.engine(options);
    return await AgentBrowser.open(url, { cdpUrl: endpoint });
  }

  /** Raw CDP page for protocol-level work (used by `@aphrody/web-test`). */
  async cdp(options: EngineOptions = {}): Promise<WebCdpPage> {
    const { endpoint } = await this.engine(options);
    return await WebCdpPage.connect(endpoint);
  }

  /** PNG screenshot (base64) of a URL. */
  async screenshot(url: string, options: EngineOptions = {}): Promise<string> {
    const page = await this.session(url, options);
    try {
      return await page.screenshot();
    } finally {
      await page.close();
    }
  }

  /** Text, `id`, `href` of the elements matching `selector`, evaluated in the rendered DOM. */
  async query(
    url: string,
    selector: string,
    options: EngineOptions = {},
  ): Promise<{ tag: string; text: string; href: string | null }[]> {
    const page = await this.session(url, options);
    try {
      const expression = `JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, 500).map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.textContent || "").trim().slice(0, 500), href: e.getAttribute("href") })))`;
      return JSON.parse(await page.evaluate<string>(expression)) as {
        tag: string;
        text: string;
        href: string | null;
      }[];
    } finally {
      await page.close();
    }
  }

  /** Stops the private engine, if one was started. Safe to call repeatedly. */
  async close(): Promise<void> {
    const engine = this.#engine;
    this.#engine = undefined;
    this.#engineStart = undefined;
    await engine?.stop();
  }
}
