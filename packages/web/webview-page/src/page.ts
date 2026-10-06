// SPDX-License-Identifier: Apache-2.0
// Playwright-shaped page, locators, routing and events over Bun.WebView (Chrome backend, CDP).
// Covers the subset the Aphrody capture and contract scripts use; anything beyond it is not
// implemented rather than approximated. Differences from Playwright: locators act on the first
// match (no strict-mode error), accessible names follow a simplified computation, and screenshots
// are viewport-only.

import { type Matcher, type Op, pageRuntime, type Step } from "./runtime.ts";

/** The part of Bun.WebView this package uses (also implemented by the test double). */
export interface WebViewLike extends EventTarget {
  readonly url: string;
  readonly title: string;
  navigate(url: string): Promise<void>;
  reload(): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  screenshot(options?: {
    format?: "png" | "jpeg";
    encoding?: "buffer";
  }): Promise<Uint8Array | Blob>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  click(x: number, y: number): Promise<void>;
  press(key: string, options?: { modifiers?: string[] }): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  cdp(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export type ConsoleMessage = { type(): string; text(): string };
export type PageResponse = { status(): number; url(): string };
export type RouteRequest = { url(): string; method(): string };
export type Route = {
  request(): RouteRequest;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
};

export type PageOptions = {
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  colorScheme?: "light" | "dark" | "no-preference";
  reducedMotion?: "reduce" | "no-preference";
  locale?: string;
  timezoneId?: string;
};

export type WaitState = "attached" | "detached" | "visible" | "hidden";
export type WaitUntil = "load" | "networkidle";

const POLL_MS = 25;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `**` and `*` globs as Playwright URL patterns. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped
      .replace(/\*\*/g, "\uE000")
      .replace(/\*/g, "[^/]*")
      .replace(/\uE000/g, ".*")}$`,
  );
}

function matcherOf(value: string | RegExp, exact = false): Matcher {
  return value instanceof RegExp
    ? { source: value.source, flags: value.flags }
    : { text: value, exact };
}

/** Serialise a function plus JSON argument into a page expression. */
export function expressionOf(fn: string | ((arg: never) => unknown), arg?: unknown): string {
  if (typeof fn === "string") return fn;
  return `(${fn.toString()})(${arg === undefined ? "" : JSON.stringify(arg)})`;
}

export class Locator {
  constructor(
    private readonly page: Page,
    private readonly steps: Step[],
  ) {}

  private chain(step: Step) {
    return new Locator(this.page, [...this.steps, step]);
  }

  locator(selector: string) {
    return this.chain({ css: selector });
  }
  getByTestId(testId: string) {
    return this.chain({ testId, attribute: this.page.testIdAttribute });
  }
  getByRole(
    role: string,
    options: { name?: string | RegExp; exact?: boolean; checked?: boolean } = {},
  ) {
    return this.chain({
      role,
      ...(options.name !== undefined ? { name: matcherOf(options.name, options.exact) } : {}),
      ...(options.checked !== undefined ? { checked: options.checked } : {}),
    });
  }
  getByText(text: string | RegExp, options: { exact?: boolean } = {}) {
    return this.chain({ text: matcherOf(text, options.exact) });
  }
  getByLabel(text: string | RegExp, options: { exact?: boolean } = {}) {
    return this.chain({ label: matcherOf(text, options.exact) });
  }
  filter(options: { hasText?: string | RegExp }) {
    return options.hasText === undefined
      ? this
      : this.chain({ hasText: matcherOf(options.hasText) });
  }
  first() {
    return this.chain({ nth: 0 });
  }
  last() {
    return this.chain({ nth: -1 });
  }
  nth(index: number) {
    return this.chain({ nth: index });
  }

  private run<T>(op: Op): Promise<T> {
    return this.page.evaluate(pageRuntime as unknown as (arg: unknown) => T, [
      this.steps,
      op,
    ]) as Promise<T>;
  }

  /** Poll until the element exists, then run `op`. */
  private async acting<T>(op: Op, timeout = this.page.timeout): Promise<T> {
    const deadline = Date.now() + timeout;
    for (;;) {
      if ((await this.run<number>({ type: "count" })) > 0) return this.run<T>(op);
      if (Date.now() > deadline)
        throw new Error(`Timeout ${timeout}ms waiting for locator ${JSON.stringify(this.steps)}`);
      await sleep(POLL_MS);
    }
  }

  count() {
    return this.run<number>({ type: "count" });
  }
  async innerText() {
    return (await this.acting<string>({ type: "text", mode: "inner" })) ?? "";
  }
  textContent() {
    return this.acting<string | null>({ type: "text", mode: "content" });
  }
  getAttribute(name: string) {
    return this.acting<string | null>({ type: "attr", name });
  }
  inputValue() {
    return this.acting<string>({ type: "value" });
  }
  isChecked() {
    return this.acting<boolean>({ type: "checked" });
  }
  async isEnabled() {
    return (await this.acting<boolean>({ type: "enabled" })) === true;
  }
  isVisible() {
    return this.run<boolean>({ type: "visible" });
  }
  async focus() {
    await this.acting({ type: "focus" });
  }
  async fill(value: string) {
    await this.acting({ type: "fill", value });
  }
  async selectOption(values: string | string[]) {
    await this.acting({ type: "select", values: Array.isArray(values) ? values : [values] });
  }
  /** Evaluate `fn(element)` in the page against the first match. */
  evaluate<T, A = undefined>(fn: (element: Element, arg: A) => T, arg?: A): Promise<T> {
    return this.acting<T>({ type: "eval", source: fn.toString(), arg });
  }

  async click(options: { force?: boolean; timeout?: number } = {}) {
    const timeout = options.timeout ?? this.page.timeout;
    await this.acting({ type: "count" }, timeout);
    if (options.force) {
      // No actionability wait (headless Chrome without a display never schedules animation frames).
      const point = await this.run<{ x: number; y: number } | null>({ type: "center" });
      if (!point) throw new Error("locator resolved to no element");
      await this.page.view.click(point.x, point.y);
      return;
    }
    const id = crypto.randomUUID();
    await this.run({ type: "mark", id });
    try {
      await this.page.view.click(`[data-wvp-target="${id}"]`, { timeout });
    } finally {
      await this.run({ type: "unmark", id }).catch(() => undefined);
    }
  }

  async check() {
    if (!(await this.isChecked())) await this.click();
  }
  async uncheck() {
    if (await this.isChecked()) await this.click();
  }

  async waitFor(options: { state?: WaitState; timeout?: number } = {}) {
    const state = options.state ?? "visible";
    const timeout = options.timeout ?? this.page.timeout;
    const deadline = Date.now() + timeout;
    for (;;) {
      const count = await this.count();
      const visible = count > 0 && (await this.isVisible());
      if (
        (state === "attached" && count > 0) ||
        (state === "detached" && count === 0) ||
        (state === "visible" && visible) ||
        (state === "hidden" && !visible)
      ) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timeout ${timeout}ms waiting for locator to be ${state}: ${JSON.stringify(this.steps)}`,
        );
      }
      await sleep(POLL_MS);
    }
  }
}

export class Page {
  timeout = 30_000;
  navigationTimeout = 30_000;
  testIdAttribute = "data-testid";
  private currentUrl: string | undefined;
  private inflight = new Set<string>();
  private lastNetworkActivity = Date.now();
  private cdpQueue: Promise<unknown> = Promise.resolve();
  private evalQueue: Promise<unknown> = Promise.resolve();
  private listeners = {
    console: [] as ((message: ConsoleMessage) => void)[],
    pageerror: [] as ((error: Error) => void)[],
    response: [] as ((response: PageResponse) => void)[],
  };
  private routes: { pattern: RegExp; handler: (route: Route) => Promise<void> | void }[] = [];

  constructor(
    readonly view: WebViewLike,
    private readonly options: PageOptions = {},
  ) {}

  /** Connects events and emulation; must run before the first navigation is awaited by callers. */
  async init() {
    await this.view.navigate("about:blank");
    await this.cdp("Network.enable");
    await this.cdp("Runtime.enable");
    await this.cdp("Page.enable");
    const { colorScheme, reducedMotion, locale, timezoneId, deviceScaleFactor, viewport } =
      this.options;
    const features: { name: string; value: string }[] = [];
    if (colorScheme) features.push({ name: "prefers-color-scheme", value: colorScheme });
    if (reducedMotion) features.push({ name: "prefers-reduced-motion", value: reducedMotion });
    if (features.length) await this.cdp("Emulation.setEmulatedMedia", { features });
    if (locale) await this.cdp("Emulation.setLocaleOverride", { locale });
    if (timezoneId) await this.cdp("Emulation.setTimezoneOverride", { timezoneId });
    if (deviceScaleFactor && viewport) {
      await this.cdp("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor,
        mobile: false,
      });
    }

    const listen = (type: string, handler: (data: never) => void) =>
      this.view.addEventListener(type, (event) =>
        handler((event as unknown as { data: never }).data),
      );
    listen("Network.requestWillBeSent", (data: { requestId: string }) => {
      this.inflight.add(data.requestId);
      this.lastNetworkActivity = Date.now();
    });
    for (const done of ["Network.loadingFinished", "Network.loadingFailed"]) {
      listen(done, (data: { requestId: string }) => {
        this.inflight.delete(data.requestId);
        this.lastNetworkActivity = Date.now();
      });
    }
    listen("Page.frameNavigated", (data: { frame: { parentId?: string; url: string } }) => {
      if (!data.frame.parentId) this.currentUrl = data.frame.url;
    });
    listen("Page.navigatedWithinDocument", (data: { url: string }) => {
      this.currentUrl = data.url;
    });
    listen("Network.responseReceived", (data: { response: { status: number; url: string } }) => {
      const response: PageResponse = {
        status: () => data.response.status,
        url: () => data.response.url,
      };
      for (const handler of this.listeners.response) handler(response);
    });
    listen(
      "Runtime.exceptionThrown",
      (data: { exceptionDetails: { text: string; exception?: { description?: string } } }) => {
        const detail = data.exceptionDetails;
        const error = new Error(detail.exception?.description?.split("\n")[0] ?? detail.text);
        for (const handler of this.listeners.pageerror) handler(error);
      },
    );
    listen(
      "Fetch.requestPaused",
      (data: { requestId: string; request: { url: string; method: string } }) => {
        void this.dispatchRoute(data);
      },
    );
  }

  /** Console messages come from the view's `console` option; the launcher forwards them here. */
  emitConsole(type: string, text: string) {
    const message: ConsoleMessage = { type: () => type, text: () => text };
    for (const handler of this.listeners.console) handler(message);
  }

  private async dispatchRoute(data: {
    requestId: string;
    request: { url: string; method: string };
  }) {
    const route = this.routes.find((entry) => entry.pattern.test(data.request.url));
    let settled = false;
    const handle: Route = {
      request: () => ({ url: () => data.request.url, method: () => data.request.method }),
      continue: async () => {
        settled = true;
        await this.cdp("Fetch.continueRequest", { requestId: data.requestId });
      },
      abort: async (errorReason = "BlockedByClient") => {
        settled = true;
        await this.cdp("Fetch.failRequest", { requestId: data.requestId, errorReason });
      },
    };
    try {
      if (route) await route.handler(handle);
    } finally {
      if (!settled) await handle.continue().catch(() => undefined);
    }
  }

  /** CDP calls are serialised: Bun.WebView allows one in flight per view. */
  cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const run = this.cdpQueue.then(() => this.view.cdp(method, params));
    this.cdpQueue = run.catch(() => undefined);
    return run;
  }

  on(event: "console", handler: (message: ConsoleMessage) => void): void;
  on(event: "pageerror", handler: (error: Error) => void): void;
  on(event: "response", handler: (response: PageResponse) => void): void;
  on(event: "console" | "pageerror" | "response", handler: never): void {
    (this.listeners[event] as unknown[]).push(handler);
  }

  async route(glob: string, handler: (route: Route) => Promise<void> | void) {
    this.routes.push({ pattern: globToRegExp(glob), handler });
    await this.cdp("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  }

  setDefaultTimeout(ms: number) {
    this.timeout = ms;
  }
  setDefaultNavigationTimeout(ms: number) {
    this.navigationTimeout = ms;
  }

  url() {
    return this.currentUrl ?? this.view.url;
  }
  async title() {
    return (await this.evaluate(() => document.title)) as string;
  }

  private async settle(waitUntil: WaitUntil, timeout: number) {
    if (waitUntil !== "networkidle") return;
    const deadline = Date.now() + timeout;
    this.lastNetworkActivity = Date.now();
    while (this.inflight.size > 0 || Date.now() - this.lastNetworkActivity < 500) {
      if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms waiting for network idle`);
      await sleep(POLL_MS);
    }
  }

  async goto(url: string, options: { waitUntil?: WaitUntil; timeout?: number } = {}) {
    const timeout = options.timeout ?? this.navigationTimeout;
    await withTimeout(this.view.navigate(url), timeout, `navigation to ${url}`);
    await this.settle(options.waitUntil ?? "load", timeout);
  }

  async reload(options: { waitUntil?: WaitUntil; timeout?: number } = {}) {
    const timeout = options.timeout ?? this.navigationTimeout;
    await withTimeout(this.view.reload(), timeout, "reload");
    await this.settle(options.waitUntil ?? "load", timeout);
  }

  /** Evaluate a function (or expression) in the page; the optional argument must be JSON. */
  evaluate<T, A = undefined>(fn: string | ((arg: A) => T | Promise<T>), arg?: A): Promise<T> {
    const args =
      Array.isArray(arg) && fn === (pageRuntime as unknown) ? arg : arg === undefined ? [] : [arg];
    const expression =
      typeof fn === "string"
        ? fn
        : `(${fn.toString()})(${args.map((value) => JSON.stringify(value)).join(",")})`;
    // Bun.WebView allows one evaluate in flight per view.
    const run = this.evalQueue.then(() => this.view.evaluate(expression));
    this.evalQueue = run.catch(() => undefined);
    return run as Promise<T>;
  }

  async waitForFunction<A = undefined>(
    fn: string | ((arg: A) => unknown),
    arg?: A,
    options: { timeout?: number } = {},
  ) {
    const timeout = options.timeout ?? this.timeout;
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await this.evaluate(fn, arg)) return;
      if (Date.now() > deadline) throw new Error(`Timeout ${timeout}ms waiting for function`);
      await sleep(POLL_MS);
    }
  }

  waitForTimeout(ms: number) {
    return sleep(ms);
  }

  async setViewportSize(size: { width: number; height: number }) {
    await this.view.resize(size.width, size.height);
  }

  readonly keyboard = {
    press: (key: string) => this.view.press(key === " " ? "Space" : key),
  };

  async cookies(): Promise<{ name: string; value: string }[]> {
    const { cookies } = (await this.cdp("Network.getCookies")) as {
      cookies: { name: string; value: string }[];
    };
    return cookies;
  }
  context() {
    return { cookies: () => this.cookies() };
  }

  async screenshot(
    options: { path?: string; animations?: "disabled" | "allow"; caret?: "hide" | "initial" } = {},
  ) {
    if (options.animations === "disabled" || options.caret === "hide") {
      const css = [
        options.animations === "disabled"
          ? "*,*::before,*::after{animation:none!important;transition:none!important}"
          : "",
        options.caret === "hide" ? "*{caret-color:transparent!important}" : "",
      ].join("");
      await this.evaluate((style: string) => {
        const el = document.createElement("style");
        el.setAttribute("data-wvp-screenshot", "");
        el.textContent = style;
        document.head.append(el);
      }, css);
    }
    const raw = await this.view.screenshot({ format: "png", encoding: "buffer" });
    const bytes =
      raw instanceof Blob ? new Uint8Array(await raw.arrayBuffer()) : new Uint8Array(raw);
    if (options.path) await Bun.write(options.path, bytes);
    return bytes;
  }

  locator(selector: string) {
    return new Locator(this, [{ css: selector }]);
  }
  getByTestId(testId: string) {
    return new Locator(this, [{ testId, attribute: this.testIdAttribute }]);
  }
  getByRole(
    role: string,
    options: { name?: string | RegExp; exact?: boolean; checked?: boolean } = {},
  ) {
    return new Locator(this, []).getByRole(role, options);
  }
  getByText(text: string | RegExp, options: { exact?: boolean } = {}) {
    return new Locator(this, []).getByText(text, options);
  }
  getByLabel(text: string | RegExp, options: { exact?: boolean } = {}) {
    return new Locator(this, []).getByLabel(text, options);
  }

  close() {
    this.view.close();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout ${ms}ms waiting for ${what}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
