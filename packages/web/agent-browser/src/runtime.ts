// SPDX-License-Identifier: Apache-2.0
/**
 * Product-facing browser session over Yolo's precompiled native provider.
 * No engine source, CDP service or global authentication store is required.
 */
import {
  BrowserRuntime,
  type BrowserContext,
  type BrowserContextOptions,
  type BrowserCallOptions,
  type BrowserSnapshot,
} from "@aphrody/runtime-sdk/browser";
import type { LoadOptions } from "@aphrody/runtime-sdk";

export interface RuntimePageOptions extends Omit<BrowserContextOptions, "allowedOrigins"> {
  /** Defaults to the page's exact origin. Additional resource origins require explicit scope. */
  readonly allowedOrigins?: readonly string[];
  readonly signal?: AbortSignal;
}

/** Owns native page contexts and destroys them before unloading the precompiled provider. */
export class RuntimeWebSession implements Disposable {
  readonly #runtime: BrowserRuntime;

  private constructor(runtime: BrowserRuntime) {
    this.#runtime = runtime;
  }

  static load(options: LoadOptions = {}): RuntimeWebSession {
    return new RuntimeWebSession(BrowserRuntime.load(options));
  }

  get closed(): boolean {
    return this.#runtime.closed;
  }

  async openPage(url: string, options: RuntimePageOptions = {}): Promise<RuntimeWebPage> {
    const { signal, allowedOrigins, ...nativeOptions } = options;
    const context = this.#runtime.createContext({
      ...nativeOptions,
      allowedOrigins: allowedOrigins ?? [new URL(url).origin],
    });
    const page = new RuntimeWebPage(context);
    try {
      await page.navigate(url, signal ? { signal } : {});
      return page;
    } catch (error) {
      page.close();
      throw error;
    }
  }

  close(): void {
    this.#runtime.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/** Isolated product page; cookies stay in its own memory and remote scripts have no host binding. */
export class RuntimeWebPage implements Disposable {
  readonly #context: BrowserContext;
  #url = "";

  constructor(context: BrowserContext) {
    this.#context = context;
  }

  get closed(): boolean {
    return this.#context.closed;
  }

  url(): string {
    return this.#url;
  }

  async navigate(url: string, options?: BrowserCallOptions): Promise<void> {
    const result = await this.#context.navigate(url, options);
    this.#url = result.url;
  }

  snapshot(options?: BrowserCallOptions): Promise<BrowserSnapshot> {
    return this.#context.snapshot(options);
  }

  content(options?: BrowserCallOptions): Promise<string> {
    return this.#context.content(options);
  }

  extract(selector: string, options?: BrowserCallOptions): Promise<string[]> {
    return this.#context.extract(selector, options);
  }

  /** Returns actual native PNG bytes without writing browser artifacts into protected stores. */
  capture(options?: BrowserCallOptions): Promise<Uint8Array> {
    return this.#context.screenshot(options);
  }

  evaluate<T>(expression: string, options?: BrowserCallOptions): Promise<T> {
    return this.#context.evaluate<T>(expression, options);
  }

  setCookie(url: string, cookie: string, options?: BrowserCallOptions): Promise<null> {
    return this.#context.setCookie(url, cookie, options);
  }

  cookies(url: string, options?: BrowserCallOptions): Promise<string> {
    return this.#context.cookies(url, options);
  }

  close(): void {
    this.#context.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
