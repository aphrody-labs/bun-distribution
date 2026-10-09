// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/page
 *
 * `TestPage` owns an `@aphrody/bun-webview-page` page on the Rust Obscura CDP
 * server and exposes navigation and Playwright-shaped locator factories.
 */

import type { Page } from "@aphrody/bun-webview-page";
import { ObscuraPage, type NavigationResponse } from "./cdp.ts";
import { WebLocator, type CdpPage } from "./locator.ts";
import {
  getByAltText,
  getByLabel,
  getByPlaceholder,
  getByRole,
  getByTestId,
  getByText,
  getByTitle,
  type ByRoleOptions,
} from "./selectors.ts";

/** Options for {@link TestPage.create}. Mirrors the relevant `use` config. */
export interface TestPageOptions {
  /** Legacy profile setting accepted for configuration compatibility. */
  profile?: "static" | "http" | "fast" | "stealth" | "max";
  /** Existing Obscura CDP endpoint. Defaults to the shared local server. */
  cdpUrl?: string;
  /** Prepended to relative `goto` URLs, like Playwright's `baseURL`. */
  baseURL?: string;
  /** Attribute used by `getByTestId` (default `data-testid`). */
  testIdAttribute?: string;
}

/**
 * A page under test. Construct with {@link TestPage.create}; dispose with
 * {@link TestPage.close} (or `await using`).
 */
export class TestPage {
  readonly #page: ObscuraPage;
  readonly #baseURL?: string;
  readonly #testIdAttribute: string;
  #lastResponse: NavigationResponse | null = null;

  private constructor(page: ObscuraPage, opts: TestPageOptions) {
    this.#page = page;
    this.#baseURL = opts.baseURL;
    this.#testIdAttribute = opts.testIdAttribute ?? "data-testid";
  }

  /** Opens a fresh Obscura CDP page and wraps it. */
  static async create(opts: TestPageOptions = {}): Promise<TestPage> {
    const page = await ObscuraPage.connect(opts.cdpUrl);
    return new TestPage(page, opts);
  }

  /** @internal — the underlying Obscura CDP page (exposes CDP `_send`). */
  get _cdp(): CdpPage {
    return this.#page;
  }

  /** The `@aphrody/bun-webview-page` page, for its full Playwright-shaped API. */
  get raw(): Page {
    return this.#page.page;
  }

  // --- Navigation --------------------------------------------------------

  /** Navigates to `url` (relative URLs resolve against `baseURL`). */
  async goto(url: string): Promise<NavigationResponse> {
    const full = this.#baseURL && !/^[a-z]+:/i.test(url) ? new URL(url, this.#baseURL).href : url;
    const response = await this.#page.goto(full);
    this.#lastResponse = response;
    return response;
  }

  /**
   * The response of the last {@link TestPage.goto}: document status after
   * redirects, so a suite can assert `status < 400` without re-fetching.
   * `null` before the first `goto`.
   */
  lastResponse(): NavigationResponse | null {
    return this.#lastResponse;
  }

  /** Replaces the page document with `html` (Playwright `page.setContent`). */
  async setContent(html: string): Promise<void> {
    await this.#page.setContent(html);
  }

  /** Current document `<title>`. */
  title(): Promise<string> {
    return this.#page.title();
  }

  /** Full document `outerHTML`. */
  content(): Promise<string> {
    return this.#page.content();
  }

  /** Current page URL. */
  url(): string {
    return this.#page.url();
  }

  // --- Locator factories -------------------------------------------------

  /** Builds a CSS-selector locator (Playwright `page.locator`). */
  locator(selector: string): WebLocator {
    return new WebLocator(this._cdp, { css: selector });
  }

  /** `page.getByTestId(id)`. */
  getByTestId(testId: string): WebLocator {
    return new WebLocator(this._cdp, getByTestId(testId, this.#testIdAttribute));
  }

  /** `page.getByRole(role, opts)`. */
  getByRole(role: string, opts: ByRoleOptions = {}): WebLocator {
    return new WebLocator(this._cdp, getByRole(role, opts));
  }

  /** `page.getByText(text, { exact })`. */
  getByText(text: string | RegExp, opts: { exact?: boolean } = {}): WebLocator {
    return new WebLocator(this._cdp, getByText(text, opts));
  }

  /** `page.getByLabel(text, { exact })`. */
  getByLabel(text: string | RegExp, opts: { exact?: boolean } = {}): WebLocator {
    return new WebLocator(this._cdp, getByLabel(text, opts));
  }

  /** `page.getByPlaceholder(text)`. */
  getByPlaceholder(text: string): WebLocator {
    return new WebLocator(this._cdp, getByPlaceholder(text));
  }

  /** `page.getByAltText(text)`. */
  getByAltText(text: string): WebLocator {
    return new WebLocator(this._cdp, getByAltText(text));
  }

  /** `page.getByTitle(text)`. */
  getByTitle(text: string): WebLocator {
    return new WebLocator(this._cdp, getByTitle(text));
  }

  // --- Lifecycle ---------------------------------------------------------

  /** Closes the underlying Obscura CDP page. */
  async close(): Promise<void> {
    await this.#page.close();
  }

  /** `await using page = await TestPage.create()` support. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
