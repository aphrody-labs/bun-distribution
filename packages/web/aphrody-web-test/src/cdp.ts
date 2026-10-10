// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/cdp
 *
 * Adapter from `@aphrody/bun-webview-page` (Playwright-shaped `Page` over
 * `Bun.WebView`) to the Rust Obscura CDP server: one `Bun.WebView` tab per page,
 * plus the document status and raw CDP access the locators and matchers need.
 */

import { DEFAULT_OBSCURA_CDP_URL, type NavigationResponse } from "@aphrody/agent-browser/cdp";
import { browserFrom, type Page, type WebViewLike } from "@aphrody/bun-webview-page";

export type { NavigationResponse };

type CdpParams = Record<string, unknown>;

/** Navigation completion accepted by {@link ObscuraPage.goto}. */
export type WaitUntil = "load" | "domcontentloaded" | "commit" | "networkidle";

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A `@aphrody/bun-webview-page` `Page` on an Obscura tab. */
export class ObscuraPage {
  readonly page: Page;
  #documentResponse: NavigationResponse | null = null;
  #closed = false;

  private constructor(page: Page) {
    this.page = page;
    page.view.addEventListener("Network.responseReceived", (event) => {
      const data = (event as Event & { data?: CdpParams }).data;
      if (data?.type !== "Document") return;
      const response = data.response as
        | { url?: string; status?: number; statusText?: string; headers?: Record<string, string> }
        | undefined;
      if (!response) return;
      const status = response.status ?? 0;
      this.#documentResponse = {
        url: response.url ?? page.url(),
        status,
        statusText: response.statusText ?? "",
        ok: status >= 200 && status < 300,
        headers: response.headers,
      };
    });
  }

  /** Opens a tab on `endpoint` (default: `APHRODY_BROWSER_CDP_URL`, `APHRODY_CDP_URL`, then the shared server). */
  static async connect(
    endpoint = process.env.APHRODY_BROWSER_CDP_URL ??
      process.env.APHRODY_CDP_URL ??
      DEFAULT_OBSCURA_CDP_URL,
  ): Promise<ObscuraPage> {
    const browser = browserFrom(
      ({ width, height }, console) =>
        new Bun.WebView({
          width,
          height,
          backend: { type: "chrome", url: endpoint },
          console,
        }) as unknown as WebViewLike,
      "obscura",
    );
    let page: Page;
    try {
      page = await timeout(
        browser.newPage(),
        10_000,
        `Obscura CDP connection timed out: ${endpoint}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Obscura CDP")) throw error;
      throw new Error(`Obscura CDP is unavailable: ${endpoint}`, { cause: error });
    }
    return new ObscuraPage(page);
  }

  /** Raw CDP command on this tab. */
  _send(method: string, params: CdpParams = {}): Promise<CdpParams> {
    if (this.#closed) return Promise.reject(new Error("Obscura CDP page is closed"));
    return timeout(
      this.page.cdp(method, params) as Promise<CdpParams>,
      30_000,
      `Obscura CDP ${method} timed out`,
    );
  }

  url(): string {
    return this.page.url();
  }

  /** Navigates and returns the document response (status 0 when none was observed). */
  async goto(url: string, waitUntil: WaitUntil = "load"): Promise<NavigationResponse> {
    this.#documentResponse = null;
    await this.page.goto(url, { waitUntil: waitUntil === "networkidle" ? "networkidle" : "load" });
    return this.#documentResponse ?? { url: this.page.url(), status: 0, statusText: "", ok: false };
  }

  async setContent(html: string): Promise<void> {
    await this.page.evaluate(
      `(document.open(), document.write(${JSON.stringify(html)}), document.close())`,
    );
  }

  title(): Promise<string> {
    return this.page.title();
  }

  async content(): Promise<string> {
    const document = await this._send("DOM.getDocument", { depth: 0 });
    const root = document.root as { nodeId: number };
    const result = await this._send("DOM.getOuterHTML", { nodeId: root.nodeId });
    return String(result.outerHTML ?? "");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.page.close();
  }
}
